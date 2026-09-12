# `memory-layer` — on-device translation memory for MUDRA+

A fast, local, personal memory that maps recognized ASL gloss sequences to the English
sentences the user already confirmed.

```
ME|TEA|HOT   ->   "I want hot tea"
```

Sign it once, confirm the sentence once, and every later repetition of that sequence is
auto-filled straight from the phone — no network, no model, no wait.

- **Exact hits are O(1)** — the token characters are hashed in place (no joined key string, no
  allocation) and probed in an open-addressing table. Measured ~1 µs/lookup on a shared CI
  container, and *flat* from a 1 000-memory corpus to a 50 000-memory one.
- **Near hits are cheap** — an IDF-weighted inverted index narrows the corpus to a few dozen
  candidates before anything order-aware runs.
- **Writes never block a read** — persistence is write-behind on a background thread; a
  confirmed phrase is usable the instant it is confirmed.
- **Nothing leaves the device.** No permissions, no network code, no exported components.

Everything here is local storage and retrieval. The module does not call, embed, or know about
any language model; when a lookup misses, that is simply a value the caller acts on.

---

## Module layout

```
memory-layer/
├── core/      Pure Kotlin/JVM. All retrieval logic. Builds and tests without an Android SDK.
│   └── src/main/kotlin/com/mudra/memory/
│       ├── MemoryLayer.kt        facade: lookup / remember / accept / forget / stats
│       ├── MemoryIndex.kt        record table + exact index + inverted index + fuzzy search
│       ├── SequenceIndex.kt      open-addressing hash(tokens) -> slot  (the O(1) path)
│       ├── SequenceHasher.kt     allocation-free FNV-1a over token characters
│       ├── TokenNormalizer.kt    raw recognizer output -> canonical glosses
│       ├── TokenSimilarity.kt    LCS + bounded Levenshtein
│       ├── MemoryStore.kt        persistence socket (+ in-memory reference implementation)
│       ├── WriteScheduler.kt     write-behind executor (+ inline scheduler for tests)
│       ├── PerformanceGovernor.kt  platform CPU-hint socket
│       └── MemoryConfig.kt       every threshold and limit, in one place
└── android/   Android library. Room/SQLite store, ADPF hints, coroutine facade.
    └── src/main/kotlin/com/mudra/memory/android/
        ├── MudraMemory.kt              entry point: MudraMemory.create(context)
        ├── RoomMemoryStore.kt          MemoryStore over Room
        ├── AdpfPerformanceGovernor.kt  PerformanceHintManager session per lookup thread
        └── room/                       entity, DAO, database
```

## Using it

```kotlin
val memory = MudraMemory.create(context)
lifecycleScope.launch { memory.warmUp() }        // once, at start-up, off the main thread

// on the recognition path — microseconds, safe from the main thread:
when (val hit = memory.lookup(glossTokens)) {
    is MemoryLookupResult.Exact -> prefill(hit.match.translation)     // seen this exact sequence
    is MemoryLookupResult.Fuzzy -> suggest(hit.matches)               // seen something close
    is MemoryLookupResult.Miss  -> Unit                               // nothing stored yet
}

// after the user confirms a sentence:
memory.remember(glossTokens, confirmedSentence)

// when the user taps a suggestion, so ranking and eviction learn from it:
memory.accept(match.id)
```

`autoFill(tokens)` collapses that to one call: it returns the stored sentence when the layer is
confident (an exact hit, or a fuzzy score ≥ 0.92) and `null` otherwise.

The `:core` module is usable on its own — `MemoryLayer(store = InMemoryMemoryStore())` — in unit
tests, on the desktop, or anywhere an Android context is not available.

## How retrieval works

**Normalization.** Raw tokens are trimmed, upper-cased with `Locale.ROOT` (never the device
locale — Turkish `i` would otherwise split one gloss into two keys), internal whitespace becomes
`_`, and anything that is not a letter, digit, `_`, `'`, `-` or `+` is dropped. `null` and blank
tokens are skipped rather than throwing: the recognizer is allowed to be messy.

**Exact path.** The canonical tokens are hashed with FNV-1a straight from their characters and
probed in a parallel-array open-addressing table. Hash collisions are resolved by *verifying the
tokens*, never by trusting the hash: two sequences that hash alike still resolve correctly.

**Fuzzy path** (two stages, so the expensive part only ever sees a few dozen records):

1. *Candidate generation.* Walk the inverted index for each query token, accumulating
   IDF-weighted overlap per record. A token present in more than 60 % of memories (`ME`) is
   skipped unless the query has nothing else — with a fallback scan so a one-gloss query still
   retrieves. A query token that is not in the vocabulary at all is repaired by a single edit
   against a length-bucketed vocabulary (`METFORMIM` → `METFORMIN`).
2. *Scoring.* Only the top `rescoreCandidates` (48) are scored precisely:

   ```
   score = 0.45 · weightedJaccard + 0.25 · queryCoverage + 0.30 · lcsRatio
   ```

   The LCS term is what makes gloss *order* count, so `ME TEA HOT` prefers `ME TEA HOT PLEASE`
   over `PLEASE HOT TEA ME`. Ties break by use count, then recency, then id — fully
   deterministic.

Matches below `fuzzyThreshold` (0.55) are not returned at all; a `Miss` says why
(`EMPTY_INPUT`, `INVALID_INPUT`, `EMPTY_CORPUS`, `BELOW_THRESHOLD`).

## Durability and failure behaviour

- Ids are assigned **in RAM**, so a memory is usable before SQLite has heard of it. The Room
  entity's primary key is explicit, never auto-generated.
- Writes go through a single background thread with a bounded queue. On overflow the write runs
  on the caller's thread — a full queue may slow the app down, but never drops a confirmed
  memory.
- If the database fails (corrupt, full, unopenable) the layer **degrades to in-memory only**:
  `stats().degraded` flips, the error listener fires, and retrieval keeps working for the rest
  of the session.
- Warm-up skips corrupt rows (empty tokens, blank translation, over-long fields, non-positive
  id) instead of failing start-up, and de-duplicates sequences by keeping the more-used row.
- The corpus is capped at `maxRecords` (20 000); past that the least-used, least-recent
  **unpinned** memory is evicted. Pinned memories — emergency phrases — are never evicted.

## iQOO 15 / Snapdragon 8 Elite Gen 5 notes

The retrieval work is microseconds, which is exactly the regime where a *reactive* CPU governor
hurts: the burst finishes on an efficiency core before the scheduler notices it should have
ramped. `AdpfPerformanceGovernor` uses `PerformanceHintManager` (Android 12+, well supported on
current Snapdragon flagships) to declare a ~2 ms target duration per lookup thread and report
the actual duration afterwards, so the platform places and clocks the thread ahead of the work
rather than after it. Sessions are per-thread (the camera thread, a coroutine worker and the
main thread each get their own) and every part of it degrades to a no-op — old API level, OEM
without support, or a throwing session — because a CPU hint must never be the reason a
translation fails to appear.

Also tuned for the device class: Room opens in WAL mode with `synchronous = NORMAL` on a
dedicated single-threaded executor, and the write-behind thread runs at
`THREAD_PRIORITY_BACKGROUND` so persistence never competes with the camera pipeline for the
prime cores.

Vendor-specific "performance mode" toggles in OriginOS are not app-accessible APIs, so the
module does not pretend to use them; ADPF is the supported route to the same scheduler.

## Building and testing

```bash
cd memory-layer

gradle :core:test                   # 20 JVM tests — no Android SDK required
gradle :android:testDebugUnitTest   # 3 Robolectric tests for the Room store (needs the SDK)
gradle build                 # everything available on this machine
```

`settings.gradle.kts` only includes `:android` when an Android SDK is present (`ANDROID_HOME`,
`ANDROID_SDK_ROOT`, or `local.properties`), so `:core` stays buildable on a bare CI container.
Force it with `-PforceAndroidModule=true`.

See [`CLAUDE.md`](CLAUDE.md) for the build/toolchain spec and the conventions to follow when
changing this module.
