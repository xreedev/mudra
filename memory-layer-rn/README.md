# `@mudra/memory` — on-device translation memory for React Native

The React Native / TypeScript port of `memory-layer/`. Same design, same behaviour, no native
build step: it maps recognized ASL gloss sequences to the English sentences the user already
confirmed.

```
ME|TEA|HOT   ->   "I want hot tea"
```

Sign it once, confirm the sentence once, and every later repetition of that sequence is
auto-filled straight from the phone.

- **`lookup()` is synchronous** — no `await`, no promise, no bridge hop. One `Map` hit for an
  exact match, so it can run inside the recognition callback and render in the same frame.
  Measured **~2.1 µs/lookup**, and *flat* from a 1 000-memory corpus to a 50 000-memory one.
- **Near hits are cheap** — an IDF-weighted inverted index narrows the corpus to a few dozen
  candidates before anything order-aware runs.
- **Writes never block a read** — persistence is queued behind the current frame.
- **Nothing leaves the device.** No network code, no permissions, no native modules.

Local storage and retrieval only. Nothing here calls, embeds, or knows about a language model;
a lookup that finds nothing is just a `miss` the caller acts on.

---

## Install

It is a workspace package, not published:

```bash
npm install file:../memory-layer-rn      # or add it to your workspaces
```

Metro reads TypeScript straight from `src/` (via the `react-native` field), so no build step is
needed in the app. `npm run build` emits `dist/` for anything that wants plain JS.

## Use it

```ts
import { MemoryLayer, SqliteMemoryStore } from '@mudra/memory';

const memory = new MemoryLayer({ store: new SqliteMemoryStore(adapter) });
await memory.warmUp();               // once, at app start
```

On the recognition path — synchronous, so it costs nothing to call on every candidate:

```ts
const hit = memory.lookup(glossTokens);   // ['me','tea','hot']

switch (hit.kind) {
  case 'exact': setDraft(hit.match.translation); break;   // seen this exact sequence
  case 'fuzzy': setSuggestions(hit.matches); break;       // seen something close
  case 'miss':  break;                                    // nothing stored for this sequence
}
```

After the user confirms a sentence, and when they accept a suggestion:

```ts
memory.remember(glossTokens, confirmedSentence);   // returns immediately
memory.accept(match.id);                           // feeds ranking + eviction
```

`autoFill(tokens)` collapses the read to one call — it returns the stored sentence when the
layer is confident (an exact hit, or a fuzzy score ≥ 0.92) and `null` otherwise:

```ts
const prefill = memory.autoFill(glossTokens);
if (prefill !== null) setDraft(prefill);
```

### With the hook

```tsx
import { useMemoryLayer } from '@mudra/memory';

const store = new SqliteMemoryStore(adapter);          // module-level, created once
const options = { store };

function SignScreen() {
  const { memory, ready } = useMemoryLayer(options);
  // ...
}
```

The hook warms up on mount and closes the layer on unmount. `memory` is usable before `ready`
flips — it is simply empty.

Call `memory.flush()` when the app backgrounds (`AppState` → `background`) so queued writes
reach SQLite before the process can be killed.

## Wiring a SQLite binding

`SqliteMemoryStore` needs one method — run a statement, get rows back — so it works with any
binding instead of forcing one on your app. Pick yours and write the adapter (verify the result
shape against the version you install; these libraries have changed it between majors):

```ts
// @op-engineering/op-sqlite
import { open } from '@op-engineering/op-sqlite';
const db = open({ name: 'mudra_memory.db' });
const adapter = {
  async execute(sql: string, params: readonly SqlParam[] = []) {
    const result = await db.execute(sql, params as any[]);
    return (result.rows ?? (result as any).rows?._array ?? []) as SqlRow[];
  },
};
```

```ts
// react-native-sqlite-storage
const db = await SQLite.openDatabase({ name: 'mudra_memory.db', location: 'default' });
const adapter = {
  async execute(sql: string, params: readonly SqlParam[] = []) {
    const [result] = await db.executeSql(sql, params as any[]);
    const rows: SqlRow[] = [];
    for (let i = 0; i < result.rows.length; i++) rows.push(result.rows.item(i));
    return rows;
  },
};
```

```ts
// expo-sqlite (SDK 51+)
const db = await SQLite.openDatabaseAsync('mudra_memory.db');
const adapter = {
  async execute(sql: string, params: readonly SqlParam[] = []) {
    if (/^\s*(select|pragma)/i.test(sql)) return db.getAllAsync(sql, params as any[]);
    await db.runAsync(sql, params as any[]);
    return [];
  },
};
```

No binding installed yet? `new MemoryLayer()` (or `new MemoryLayer({ store: NO_STORE })`) runs
entirely in RAM — everything works, nothing survives a restart. Useful for a demo, and for an
"incognito session" privacy mode later.

The store creates its table and unique index on first use, and applies `journal_mode = WAL` plus
`synchronous = NORMAL` (best-effort — a binding that refuses PRAGMAs still works).

## Where it sits in the pipeline

```
camera → MediaPipe landmarks → TFLite classifier → gloss tokens
                                                        │
                                              memory.lookup(tokens)
                                          ┌─────────────┴─────────────┐
                                    exact / confident              miss / weak
                                          │                            │
                                   prefill the gate          your sentence builder
                                          └─────────────┬─────────────┘
                                                confirmation gate
                                                        │
                                        memory.remember(tokens, confirmed)
```

## How retrieval works

**Normalization.** Tokens are trimmed, upper-cased with `toUpperCase` (never
`toLocaleUpperCase` — the device locale must not change the key), internal whitespace becomes
`_`, and anything that is not a letter, digit, `_`, `'`, `-` or `+` is dropped. `null`,
`undefined`, non-string and blank entries are skipped rather than throwing: the recognizer is
allowed to be messy.

**Exact path.** `Map<'ME|TEA|HOT', slot>`. One hash, one hit.

**Fuzzy path**, two stages so the expensive part only ever sees a few dozen records:

1. *Candidate generation.* Walk the inverted index per query token, accumulating IDF-weighted
   overlap into a reused `Float64Array` (generation-stamped, so nothing is cleared between
   lookups). A token in more than 60 % of memories (`ME`) is skipped unless the query has
   nothing else, with a fallback scan so a one-gloss query still retrieves. A token missing from
   the vocabulary is repaired by a single edit against a length-bucketed index
   (`METFORMIM` → `METFORMIN`).
2. *Scoring.* Only the top `rescoreCandidates` (48) are scored precisely:

   ```
   score = 0.45 · weightedJaccard + 0.25 · queryCoverage + 0.30 · lcsRatio
   ```

   The LCS term makes gloss *order* count, so `ME TEA HOT` prefers `ME TEA HOT PLEASE` over
   `PLEASE HOT TEA ME`. Ties break by use count, then recency, then id — fully deterministic.

Matches below `fuzzyThreshold` (0.55) are not returned at all, and the miss says why:
`empty-input`, `invalid-input`, `empty-corpus`, `below-threshold`.

## Durability and failure behaviour

- Ids are assigned **in memory**, so a record is queryable before SQLite has heard of it. The
  `id` column is an explicit primary key, never `AUTOINCREMENT`.
- Writes are a serialized promise chain: order preserved, caller never blocked, nothing dropped.
- If storage fails the layer **degrades to memory-only** — `stats().degraded` flips,
  `onStoreError` fires, and retrieval keeps working for the rest of the session.
- `warmUp()` skips corrupt rows (empty tokens, blank translation, over-long fields, non-positive
  id) instead of failing start-up, and de-duplicates sequences by keeping the more-used row.
- The corpus is capped at `maxRecords` (20 000); past that the least-used, least-recent
  **unpinned** memory is evicted. Pinned memories — emergency phrases — are never evicted, and a
  fully pinned corpus refuses a new write rather than dropping one.

## Differences from the Kotlin module

Same algorithm and the same thresholds, adapted to the platform:

| | `memory-layer/` (Kotlin) | `memory-layer-rn/` (TypeScript) |
|---|---|---|
| Exact index | open-addressing table, hashed in place, zero allocation | `Map` on the joined key — the idiomatic O(1) in JS |
| Threading | read/write lock, thread-local scratch | none needed: JS is single-threaded |
| Write-behind | background thread, bounded queue | serialized promise chain |
| Persistence | Room/SQLite | any SQLite binding, via a 6-line adapter |
| CPU hints | ADPF `PerformanceHintManager` | not reachable from JS (see below) |
| Exact lookup | ~1 µs | ~2.1 µs |

**On the iQOO 15 specifically:** the Kotlin module declares an ADPF performance-hint session so
the scheduler ramps *ahead* of a microsecond lookup. JavaScript has no access to that API, so
this port cannot do it — the work runs on whatever core Hermes is on. At ~2 µs per lookup it
does not matter for this module, but it is a real difference, not an omission I can paper over.
If the app later needs guaranteed frame-level latency for the whole recognition path, the hint
belongs in the native camera/classifier module, not here.

## Building and testing

```bash
npm test           # 23 Jest tests, including the SQLite store against a real engine
npm run typecheck  # tsc --noEmit, strict
npm run build      # emits dist/
```

The SQLite tests run against `node:sqlite` (Node 22+) through the same adapter interface an RN
binding uses, so the SQL is exercised for real rather than mocked.

See [`CLAUDE.md`](CLAUDE.md) for the toolchain spec and contributor conventions.
