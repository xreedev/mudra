# CLAUDE.md — `@mudra/memory` (React Native) spec and contributor guide

Read this before changing anything in `memory-layer-rn/`. It is the contract for the package:
what it is built with, how it is laid out, and the rules that keep it fast and safe.

The Kotlin sibling in `memory-layer/` follows the same contract; `memory-layer/CLAUDE.md` is its
version of this file. **Behaviour changes belong in both**, or the two ports drift apart.

---

## 1. What this package is

An **on-device translation memory** for MUDRA+, in TypeScript so the React Native app can call
it directly. It maps a recognized ASL gloss sequence to the English sentence the user already
confirmed, so a repeat of that sequence is auto-filled instantly.

```
ME|TEA|HOT  ->  "I want hot tea"
```

**Scope — deliberately narrow:**

| In scope | Out of scope |
|---|---|
| Store a confirmed `tokens -> translation` pair | Producing translations |
| Retrieve by exact sequence in O(1) | Sign recognition, camera, landmarks |
| Retrieve by similar sequence (fuzzy) | Any language-model call, prompt, or client |
| Persist locally through a SQLite adapter | Networking, sync, telemetry, accounts |
| Usage/recency ranking, eviction, pinning | UI, navigation, the confirmation gate itself |

There is **no LLM logic in this package and none is to be added.** It is local storage and local
retrieval. A lookup that finds nothing returns `{ kind: 'miss' }` — a plain value. What the app
does next is the app's business.

Equally: **no network calls, no permissions, no analytics, and never log translation text or
gloss sequences.** What the user signs is medical and personal; it stays on the device.

---

## 2. Toolchain

| Thing | Version | Where it is pinned |
|---|---|---|
| TypeScript | **5.6**, `strict: true` | `package.json`, `tsconfig.json` |
| Target / module | **ES2020 / CommonJS** (Hermes-safe) | `tsconfig.json` |
| Tests | **Jest 29 + ts-jest**, `node` environment | `jest.config.js` |
| React | **18**, an *optional* peer dependency | `package.json` |
| Node (dev only) | **22+** — the SQLite tests use `node:sqlite` | — |
| Runtime dependencies | **none** | `package.json` |

Rules:

- **Zero runtime dependencies. Keep it that way.** No SQLite binding, no lodash, no polyfills.
  The only thing the package needs from a platform is the `SqliteAdapter` the app hands it.
- **React is optional.** Only `useMemoryLayer.ts` imports it. Nothing else may, so the engine
  stays usable from a plain module, a worklet, or a test.
- **No React Native imports either.** Not `react-native`, not `AsyncStorage`, nothing from the
  platform. That is what lets `npm test` run in plain Node in ~3 seconds.
- Metro consumes `src/` directly via the `react-native` field in `package.json`; `dist/` exists
  for consumers that want plain JS. Do not remove either entry point.
- `strict` stays on. No `any` in exported signatures — the app's type safety at the pipeline
  boundary is the point of having types here.

### Layout

```
src/
├── index.ts            the public surface — if it is not exported here, it is internal
├── types.ts            MemoryRecord, LookupResult, RememberOutcome, MemoryStore, ...
├── config.ts           every threshold and limit, plus validation
├── normalize.ts        raw recognizer output -> canonical glosses
├── similarity.ts       LCS + bounded Levenshtein
├── memoryIndex.ts      record table + exact Map + inverted index + fuzzy search
├── memoryLayer.ts      the facade: lookup / remember / accept / forget / stats
├── writeScheduler.ts   write-behind promise chain (+ an immediate one for tests)
├── stores/             InMemoryStore, SqliteMemoryStore (adapter-based)
└── useMemoryLayer.ts   optional React hook
```

---

## 3. Commands

```bash
npm test                      # the suite — plain Node, no emulator
npm test -- -t 'near misses'  # one test
npm run typecheck             # tsc --noEmit, strict
npm run build                 # emits dist/
```

---

## 4. Architecture, and the invariants behind it

```
lookup(tokens)
   │
   ├─ normalizeTokens     raw recognizer output -> canonical glosses     (allocates once)
   ├─ Map.get(key)        'ME|TEA|HOT' -> slot                           O(1)
   │     └─ hit -> { kind: 'exact', score: 1 }                   <- the common case
   └─ MemoryIndex.search  inverted index -> top-48 candidates -> precise scoring
         └─ >= threshold -> { kind: 'fuzzy' },  else { kind: 'miss' }
```

Invariants. Breaking one of these is what "slow" or "flaky" looks like later:

1. **`lookup`, `autoFill`, `remember`, `accept` and `forget` are synchronous.** They must never
   become `async` — the whole point is that the recognition callback can call them inline. Only
   `warmUp`, `flush` and `close` await anything.
2. **The read path never touches storage.** The corpus lives in memory; SQLite is the durability
   layer, not the query engine.
3. **Scratch buffers are reused and generation-stamped.** Do not allocate a `Map` or an object
   per candidate inside `search`, and do not clear the weight array between lookups.
4. **Ids are assigned in memory, never by SQLite.** A confirmed phrase must be queryable before
   the write lands; the `id` column is an explicit primary key.
5. **Persistence failures degrade, never throw to the caller.** Catch, count
   (`stats().storeFailures`), set `degraded`, call `onStoreError`, keep serving.
6. **Bad input is a value, not an exception.** `lookup` returns a miss, `remember` returns
   `{ status: 'rejected', reason }`. `null`, `undefined`, non-strings and a 1 MB token must all
   be survivable — the classifier is allowed to be messy.
7. **Every limit is in `config.ts`.** No magic numbers in the engine.
8. **Results are deterministic.** Ties break by use count, then recency, then id.
9. **SQL identifiers are never interpolated from user input.** `tableName` is validated against
   `/^[A-Za-z_][A-Za-z0-9_]*$/`; every value goes through a `?` parameter.

### Fuzzy scoring

```
score = (0.45 · weightedJaccard + 0.25 · queryCoverage + 0.30 · lcsRatio) / weightSum
```

IDF weighting makes a rare gloss (`METFORMIN`) count for more than a ubiquitous one (`ME`); the
LCS term makes sign *order* count. If you change a weight or a threshold, change it in
`DEFAULT_CONFIG` **and in the Kotlin module's `MemoryConfig`**, then re-run both suites — several
tests assert the relative behaviour those numbers produce (ordered beats shuffled, one common
gloss is not enough).

---

## 5. Testing rules

This is a hackathon build, so the suite is deliberately compact — one file, behaviour over
internals: `__tests__/memoryLayer.test.ts`, **23 tests** covering store/retrieve, near-miss
retrieval and ranking, bad input, a closed layer, restart and corrupt rows, a failing store,
capacity and pinning, the SQLite store, and a flat-scaling lookup check.

- The SQLite tests run against **real SQLite** (`node:sqlite`) through the same `SqliteAdapter`
  interface an RN binding uses — so the SQL is exercised, not mocked. Keep it that way; a
  hand-rolled fake would let broken SQL through.
- Use the local `testClock()` for anything time-dependent. Never `setTimeout` to advance time.
- Use `createImmediateWriteScheduler()` when a write must be observable without an extra tick,
  and the default queued scheduler when the asynchrony *is* the thing under test (then `await
  memory.flush()`).
- Performance assertions stay **loose** and print their numbers. They exist to catch an
  accidental O(n) scan, not to benchmark a machine.
- New config field → give it a default that preserves current behaviour, and a test that
  exercises a non-default value.

---

## 6. Code style

- 2-space indent, single quotes, semicolons, ~100-column lines, trailing commas.
- Exported API gets a doc comment that says **why**, not what.
- Comments explain trade-offs (why a `Map` here but an open-addressing table in Kotlin, why
  `toUpperCase` and not `toLocaleUpperCase`). Do not narrate the obvious.
- Prefer typed arrays (`Int32Array`, `Float64Array`) on anything that runs per lookup.
- Discriminated unions over boolean flags for results (`kind: 'exact' | 'fuzzy' | 'miss'`), so
  the app gets exhaustiveness checking in a `switch`.

---

## 7. Things that will be sent back in review

- An LLM call, `fetch`, or any network dependency.
- A runtime dependency added to `package.json`.
- An import of `react-native` or a specific SQLite binding outside a README snippet.
- Making a read path `async`, or awaiting storage inside `lookup`.
- Logging translation text or gloss sequences.
- `any` in an exported signature, or turning off `strict`.
- A behaviour change made here but not in `memory-layer/` (Kotlin), or vice versa.
- A new public API without a test, or a behaviour change without a test that would have caught
  the regression.
- Swallowing a store failure without counting it and setting `degraded`.
