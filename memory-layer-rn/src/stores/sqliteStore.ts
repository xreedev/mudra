import type { MemoryRecord, MemoryStore } from '../types';

export type SqlParam = string | number | null;

export interface SqlRow {
  [column: string]: unknown;
}

/**
 * The one thing this package needs from a SQLite library: run a statement, get rows back.
 *
 * Deliberately not tied to a specific package — every RN SQLite binding (`op-sqlite`,
 * `react-native-sqlite-storage`, `expo-sqlite`, `react-native-nitro-sqlite`) exposes a slightly
 * different shape, and shipping a hard dependency on one of them would force it on the whole
 * app. Write the six-line adapter for whichever you use; the README has snippets.
 */
export interface SqliteAdapter {
  /** Runs `sql` with `params`. Returns the result rows for a SELECT, an empty array otherwise. */
  execute(sql: string, params?: readonly SqlParam[]): Promise<SqlRow[]>;
  close?(): Promise<void>;
}

export interface SqliteStoreOptions {
  /** Table name, in case the app already owns a table called `memories`. */
  tableName?: string;
  /**
   * Apply `journal_mode = WAL` and `synchronous = NORMAL` on first use.
   *
   * WAL means a queued write never blocks the warm-up read; `NORMAL` trades an fsync per commit
   * for throughput, which is the right call here — a memory lost to a kernel panic is simply
   * re-learnable, the user confirms the phrase once more.
   */
  tuneForWriteBehind?: boolean;
}

const SEPARATOR = '|';

/**
 * `MemoryStore` over SQLite.
 *
 * The token sequence is stored as a single `|`-joined string rather than a child table: it is
 * only ever read back whole (warm-up loads the corpus into memory), so one row per memory keeps
 * start-up to a single sequential scan. Normalization strips `|` from tokens, so the join is
 * unambiguous.
 *
 * Ids come from the layer, never from `AUTOINCREMENT` — a confirmed phrase has to be usable
 * before the write reaches SQLite.
 */
export class SqliteMemoryStore implements MemoryStore {
  private readonly table: string;
  private readonly tune: boolean;
  private ready: Promise<void> | null = null;

  constructor(
    private readonly db: SqliteAdapter,
    options: SqliteStoreOptions = {},
  ) {
    this.table = sanitizeTableName(options.tableName ?? 'memories');
    this.tune = options.tuneForWriteBehind ?? true;
  }

  /** Creates the table and index if needed. Safe to call repeatedly; runs once. */
  init(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        if (this.tune) {
          // Best-effort: a binding that disallows PRAGMA must not break persistence.
          try {
            await this.db.execute('PRAGMA journal_mode = WAL');
            await this.db.execute('PRAGMA synchronous = NORMAL');
          } catch {
            /* ignored on purpose */
          }
        }
        await this.db.execute(
          `CREATE TABLE IF NOT EXISTS ${this.table} (
             id INTEGER PRIMARY KEY,
             sequence TEXT NOT NULL,
             translation TEXT NOT NULL,
             use_count INTEGER NOT NULL DEFAULT 0,
             created_at INTEGER NOT NULL DEFAULT 0,
             last_used_at INTEGER NOT NULL DEFAULT 0,
             pinned INTEGER NOT NULL DEFAULT 0
           )`,
        );
        await this.db.execute(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_${this.table}_sequence
             ON ${this.table} (sequence)`,
        );
      })();
    }
    return this.ready;
  }

  async loadAll(): Promise<MemoryRecord[]> {
    await this.init();
    const rows = await this.db.execute(
      `SELECT id, sequence, translation, use_count, created_at, last_used_at, pinned
         FROM ${this.table}`,
    );
    return (rows ?? []).map(toRecord);
  }

  async insert(record: MemoryRecord): Promise<void> {
    await this.init();
    // REPLACE keeps the table single-valued per sequence even if the same phrase arrives
    // under a new id (for instance after a restore from backup).
    await this.db.execute(
      `INSERT OR REPLACE INTO ${this.table}
         (id, sequence, translation, use_count, created_at, last_used_at, pinned)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.tokens.join(SEPARATOR),
        record.translation,
        record.useCount,
        record.createdAt,
        record.lastUsedAt,
        record.pinned ? 1 : 0,
      ],
    );
  }

  update(record: MemoryRecord): Promise<void> {
    return this.insert(record);
  }

  async touch(id: number, useCount: number, lastUsedAt: number): Promise<void> {
    await this.init();
    await this.db.execute(
      `UPDATE ${this.table} SET use_count = ?, last_used_at = ? WHERE id = ?`,
      [useCount, lastUsedAt, id],
    );
  }

  async remove(id: number): Promise<void> {
    await this.init();
    await this.db.execute(`DELETE FROM ${this.table} WHERE id = ?`, [id]);
  }

  async removeAll(): Promise<void> {
    await this.init();
    await this.db.execute(`DELETE FROM ${this.table}`);
  }

  async close(): Promise<void> {
    await this.db.close?.();
  }

  /** Row count straight from SQLite — diagnostics only, never on the lookup path. */
  async count(): Promise<number> {
    await this.init();
    const rows = await this.db.execute(`SELECT COUNT(*) AS n FROM ${this.table}`);
    return Number(rows?.[0]?.n ?? 0);
  }
}

function toRecord(row: SqlRow): MemoryRecord {
  const sequence = String(row.sequence ?? '');
  return {
    id: Number(row.id),
    tokens: sequence.length === 0 ? [] : sequence.split(SEPARATOR),
    translation: String(row.translation ?? ''),
    useCount: Number(row.use_count ?? 0),
    createdAt: Number(row.created_at ?? 0),
    lastUsedAt: Number(row.last_used_at ?? 0),
    pinned: Number(row.pinned ?? 0) !== 0,
  };
}

/** Table names are interpolated into SQL, so they are restricted to a safe identifier. */
function sanitizeTableName(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`sqlite store: unsafe table name '${name}'`);
  }
  return name;
}
