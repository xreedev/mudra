import { resolveConfig, type MemoryConfig } from './config';
import { MemoryIndex } from './memoryIndex';
import { normalizeTokens } from './normalize';
import { createQueuedWriteScheduler, type WriteScheduler } from './writeScheduler';
import {
  CONFIDENT_SCORE,
  type Clock,
  type LookupResult,
  type MemoryErrorListener,
  type MemoryMatch,
  type MemoryRecord,
  type MemoryStats,
  type MemoryStore,
  type MissReason,
  type RememberOutcome,
  type WarmUpResult,
} from './types';

const NOT_FOUND = -1;

export interface MemoryLayerOptions {
  /** Where memories are persisted. Omit for a session-only, in-RAM layer. */
  store?: MemoryStore;
  config?: Partial<MemoryConfig>;
  /** Injectable clock — tests pass a controllable one. */
  clock?: Clock;
  writeScheduler?: WriteScheduler;
  /** Called when persistence fails, so the UI can show "memory is read-only". */
  onStoreError?: MemoryErrorListener;
}

/** A store that persists nothing — a session-only or "incognito" memory. */
export const NO_STORE: MemoryStore = {
  loadAll: async () => [],
  insert: async () => {},
  update: async () => {},
  touch: async () => {},
  remove: async () => {},
  removeAll: async () => {},
};

/**
 * On-device translation memory for the MUDRA+ ASL pipeline.
 *
 * ```
 * ME|TEA|HOT  ->  "I want hot tea"
 * ```
 *
 * The contract the rest of the app relies on:
 *
 *  - **`lookup` is synchronous** — one `Map` hit for an exact match, no `await`, no bridge hop,
 *    so it can run inside the recognition callback and render in the same frame;
 *  - **a miss is a value, not a throw** — the caller decides what to do when nothing is stored;
 *  - **writes never block a read** — persistence is queued behind the current frame, and if
 *    storage fails the layer keeps serving from memory in degraded mode.
 */
export class MemoryLayer {
  readonly config: MemoryConfig;

  private readonly store: MemoryStore;
  private readonly clock: Clock;
  private readonly scheduler: WriteScheduler;
  private readonly onStoreError?: MemoryErrorListener;
  private readonly index: MemoryIndex;

  private nextId = 1;
  private exactHits = 0;
  private fuzzyHits = 0;
  private misses = 0;
  private writes = 0;
  private evictions = 0;
  private storeFailures = 0;
  private lastLookupMs = 0;
  private degraded = false;
  private closed = false;

  constructor(options: MemoryLayerOptions = {}) {
    this.config = resolveConfig(options.config);
    this.store = options.store ?? NO_STORE;
    this.clock = options.clock ?? Date.now;
    this.onStoreError = options.onStoreError;
    this.scheduler =
      options.writeScheduler ??
      createQueuedWriteScheduler({
        onError: (error) => this.noteStoreFailure('write', error),
      });
    this.index = new MemoryIndex(this.config);
  }

  /**
   * Loads the persisted corpus into memory. Call once at app start.
   *
   * A corrupt or over-long row is skipped rather than failing start-up, and a store that
   * rejects leaves the layer running in memory only.
   */
  async warmUp(): Promise<WarmUpResult> {
    if (this.closed) return { loaded: 0, skipped: 0, degraded: this.degraded };

    let persisted: MemoryRecord[];
    try {
      persisted = await this.store.loadAll();
    } catch (error) {
      this.noteStoreFailure('loadAll', error);
      return { loaded: 0, skipped: 0, degraded: true };
    }

    this.index.clear();
    let loaded = 0;
    let skipped = 0;
    let maxId = 0;

    for (const row of persisted ?? []) {
      const normalized = normalizeTokens(row?.tokens, this.config);
      if (
        !normalized.ok ||
        typeof row.translation !== 'string' ||
        row.translation.trim().length === 0 ||
        row.translation.length > this.config.maxTranslationLength ||
        !Number.isInteger(row.id) ||
        row.id <= 0
      ) {
        skipped++;
        continue;
      }

      const record: MemoryRecord = {
        id: row.id,
        tokens: normalized.tokens,
        translation: row.translation,
        useCount: Number.isFinite(row.useCount) ? row.useCount : 0,
        createdAt: Number.isFinite(row.createdAt) ? row.createdAt : 0,
        lastUsedAt: Number.isFinite(row.lastUsedAt) ? row.lastUsedAt : 0,
        pinned: Boolean(row.pinned),
      };

      const existing = this.index.findExact(record.tokens);
      if (existing) {
        // Duplicate sequence in storage: keep the more-used, then more-recent row.
        if (prefers(record, existing)) {
          const slot = this.index.slotOfId(existing.id);
          if (slot !== NOT_FOUND) this.index.removeSlot(slot);
          this.index.add(record);
        }
        skipped++;
      } else {
        this.index.add(record);
        loaded++;
      }
      if (record.id > maxId) maxId = record.id;
    }

    this.nextId = maxId + 1;
    return { loaded, skipped, degraded: this.degraded };
  }

  // ------------------------------------------------------------------ retrieval

  /**
   * Looks up a recognized gloss sequence. Synchronous, allocation-light, never throws.
   *
   * @param tokens raw recognizer output, e.g. `['me', 'tea', 'hot']`.
   * @param limit  max fuzzy matches to return (clamped to `maxResults`).
   */
  lookup(
    tokens: readonly (string | null | undefined)[] | null | undefined,
    limit: number = this.config.maxResults,
  ): LookupResult {
    if (this.closed) {
      this.misses++;
      return miss('invalid-input', 'layer is closed');
    }

    const normalized = normalizeTokens(tokens, this.config);
    if (!normalized.ok) {
      this.misses++;
      const reason: MissReason =
        normalized.reason === 'empty-tokens' ? 'empty-input' : 'invalid-input';
      return miss(reason, normalized.detail);
    }

    const startedAt = now();
    try {
      const exact = this.index.findExact(normalized.tokens);
      if (exact) {
        this.exactHits++;
        const match = toMatch(exact, 1, 'exact');
        return { kind: 'exact', match, matches: [match], isConfident: true };
      }
      if (this.index.size === 0) {
        this.misses++;
        return miss('empty-corpus');
      }

      const effectiveLimit = clamp(limit, 1, this.config.maxResults);
      const matches = this.index.search(
        normalized.tokens,
        effectiveLimit,
        this.config.fuzzyThreshold,
      );
      if (matches.length === 0) {
        this.misses++;
        return miss('below-threshold');
      }
      this.fuzzyHits++;
      return {
        kind: 'fuzzy',
        match: matches[0],
        matches,
        isConfident: matches[0].score >= CONFIDENT_SCORE,
      };
    } finally {
      this.lastLookupMs = now() - startedAt;
    }
  }

  /**
   * Convenience for the auto-fill path: the stored sentence when the layer is confident about
   * the sequence, otherwise `null`.
   */
  autoFill(tokens: readonly (string | null | undefined)[] | null | undefined): string | null {
    const result = this.lookup(tokens, 1);
    return result.isConfident ? (result.match?.translation ?? null) : null;
  }

  /** Exact-only lookup — the strict O(1) path, no fuzzy fallback. */
  lookupExact(
    tokens: readonly (string | null | undefined)[] | null | undefined,
  ): MemoryRecord | null {
    if (this.closed) return null;
    const normalized = normalizeTokens(tokens, this.config);
    return normalized.ok ? this.index.findExact(normalized.tokens) : null;
  }

  // ------------------------------------------------------------------ writes

  /**
   * Stores (or reinforces) a user-confirmed translation. Returns immediately — the record is
   * queryable at once and the write lands behind the current frame.
   *
   * This is the only way memories are created: the confirmation gate in the UI is what makes a
   * translation trustworthy enough to reuse.
   */
  remember(
    tokens: readonly (string | null | undefined)[] | null | undefined,
    translation: string | null | undefined,
    options: { pinned?: boolean } = {},
  ): RememberOutcome {
    if (this.closed) return { status: 'rejected', reason: 'closed', detail: 'layer is closed' };

    const normalized = normalizeTokens(tokens, this.config);
    if (!normalized.ok) {
      return { status: 'rejected', reason: normalized.reason, detail: normalized.detail };
    }

    const text = typeof translation === 'string' ? translation.trim() : '';
    if (text.length === 0) {
      return { status: 'rejected', reason: 'empty-translation', detail: 'translation is blank' };
    }
    if (text.length > this.config.maxTranslationLength) {
      return {
        status: 'rejected',
        reason: 'translation-too-long',
        detail: `${text.length} characters, max is ${this.config.maxTranslationLength}`,
      };
    }

    const pinned = options.pinned === true;
    const timestamp = this.clock();
    const existing = this.index.findExact(normalized.tokens);

    if (existing) {
      const record: MemoryRecord = {
        ...existing,
        translation: text,
        useCount: existing.useCount + 1,
        lastUsedAt: timestamp,
        pinned: existing.pinned || pinned,
      };
      this.index.replace(this.index.slotOfId(existing.id), record);
      this.writes++;
      this.persist('update', () => this.store.update(record));
      return { status: 'updated', record, previousTranslation: existing.translation };
    }

    if (this.index.size >= this.config.maxRecords && !this.evictOne()) {
      return {
        status: 'rejected',
        reason: 'capacity-exhausted',
        detail: `all ${this.config.maxRecords} memories are pinned`,
      };
    }

    const record: MemoryRecord = {
      id: this.nextId++,
      tokens: normalized.tokens,
      translation: text,
      useCount: 1,
      createdAt: timestamp,
      lastUsedAt: timestamp,
      pinned,
    };
    this.index.add(record);
    this.writes++;
    this.persist('insert', () => this.store.insert(record));
    return { status: 'stored', record };
  }

  /**
   * Marks a returned memory as actually used (the user accepted the auto-fill). Feeds ranking
   * and the eviction policy. Returns the updated record, or `null` if it is gone.
   */
  accept(id: number): MemoryRecord | null {
    if (this.closed) return null;
    const slot = this.index.slotOfId(id);
    if (slot === NOT_FOUND) return null;
    const existing = this.index.recordAt(slot);
    if (!existing) return null;

    const lastUsedAt = this.clock();
    const record: MemoryRecord = { ...existing, useCount: existing.useCount + 1, lastUsedAt };
    this.index.replace(slot, record);
    this.persist('touch', () => this.store.touch(id, record.useCount, lastUsedAt));
    return record;
  }

  /** Pins a memory so eviction can never reclaim it (emergency phrases). */
  setPinned(id: number, pinned: boolean): MemoryRecord | null {
    if (this.closed) return null;
    const slot = this.index.slotOfId(id);
    if (slot === NOT_FOUND) return null;
    const existing = this.index.recordAt(slot);
    if (!existing) return null;

    const record: MemoryRecord = { ...existing, pinned };
    this.index.replace(slot, record);
    this.persist('update', () => this.store.update(record));
    return record;
  }

  /** Removes the memory for an exact token sequence. */
  forget(tokens: readonly (string | null | undefined)[] | null | undefined): boolean {
    if (this.closed) return false;
    const normalized = normalizeTokens(tokens, this.config);
    if (!normalized.ok) return false;
    const existing = this.index.findExact(normalized.tokens);
    return existing ? this.forgetById(existing.id) : false;
  }

  forgetById(id: number): boolean {
    if (this.closed) return false;
    const slot = this.index.slotOfId(id);
    if (slot === NOT_FOUND) return false;
    if (!this.index.removeSlot(slot)) return false;
    this.persist('remove', () => this.store.remove(id));
    return true;
  }

  /** Wipes every memory, in RAM and in storage — the "clear my history" switch. */
  clear(): void {
    if (this.closed) return;
    this.index.clear();
    this.nextId = 1;
    this.persist('removeAll', () => this.store.removeAll());
  }

  /** Bulk seed (onboarding phrase packs, restore from backup). Returns how many were stored. */
  rememberAll(
    entries: Iterable<readonly [readonly string[], string]>,
  ): number {
    let stored = 0;
    for (const [tokens, translation] of entries) {
      if (this.remember(tokens, translation).status !== 'rejected') stored++;
    }
    return stored;
  }

  // ------------------------------------------------------------------ introspection

  get size(): number {
    return this.index.size;
  }

  /** `true` once persistence has failed; the layer then serves from memory only. */
  get isDegraded(): boolean {
    return this.degraded;
  }

  /** Snapshot of every memory — export, debugging, tests. */
  snapshot(): MemoryRecord[] {
    return this.index.allRecords();
  }

  stats(): MemoryStats {
    return {
      records: this.index.size,
      vocabulary: this.index.vocabularySize,
      exactHits: this.exactHits,
      fuzzyHits: this.fuzzyHits,
      misses: this.misses,
      writes: this.writes,
      evictions: this.evictions,
      storeFailures: this.storeFailures,
      degraded: this.degraded,
      lastLookupMs: this.lastLookupMs,
    };
  }

  /** Awaits queued writes. Call from `AppState` background so nothing is lost on a kill. */
  flush(): Promise<void> {
    return this.scheduler.flush();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.scheduler.flush();
    try {
      await this.store.close?.();
    } catch (error) {
      this.noteStoreFailure('close', error);
    }
    this.index.clear();
  }

  // ------------------------------------------------------------------ internals

  /** Returns false when everything resident is pinned. */
  private evictOne(): boolean {
    const slot = this.index.evictionCandidate();
    if (slot === NOT_FOUND) return false;
    const removed = this.index.removeSlot(slot);
    if (!removed) return false;
    this.evictions++;
    this.persist('remove', () => this.store.remove(removed.id));
    return true;
  }

  private persist(operation: string, task: () => Promise<void> | void): void {
    this.scheduler.submit(async () => {
      try {
        await task();
      } catch (error) {
        this.noteStoreFailure(operation, error);
      }
    });
  }

  private noteStoreFailure(operation: string, error: unknown): void {
    this.storeFailures++;
    this.degraded = true;
    try {
      this.onStoreError?.(operation, error);
    } catch {
      // A listener must never be able to take the memory layer down with it.
    }
  }
}

function toMatch(record: MemoryRecord, score: number, kind: 'exact' | 'fuzzy'): MemoryMatch {
  return { record, score, kind, translation: record.translation, id: record.id };
}

function miss(reason: MissReason, detail?: string): LookupResult {
  return { kind: 'miss', reason, detail, matches: [], match: null, isConfident: false };
}

function prefers(candidate: MemoryRecord, existing: MemoryRecord): boolean {
  return (
    candidate.useCount > existing.useCount ||
    (candidate.useCount === existing.useCount && candidate.lastUsedAt > existing.lastUsedAt)
  );
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** High-resolution where available (RN has `performance.now`), wall clock otherwise. */
function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
