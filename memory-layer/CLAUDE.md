# CLAUDE.md — `memory-layer` build spec and contributor guide

Read this before changing anything in `memory-layer/`. It is the contract for the module: what
it is built with, how it is laid out, and the rules that keep it fast and safe.

---

## 1. What this module is

An **on-device translation memory** for MUDRA+. It maps a recognized ASL gloss sequence to the
English sentence the user already confirmed, so a repeat of the same sequence is auto-filled
instantly instead of being re-derived.

```
ME|TEA|HOT  ->  "I want hot tea"
```

**Scope — deliberately narrow:**

| In scope | Out of scope |
|---|---|
| Store a confirmed `tokens -> translation` pair | Producing translations |
| Retrieve by exact sequence in O(1) | Sign recognition, camera, landmarks |
| Retrieve by similar sequence (fuzzy) | Any language-model call, prompt, or client |
| Persist locally (Room/SQLite) | Networking, sync, telemetry, accounts |
| Usage/recency ranking, eviction, pinning | UI, navigation, the confirmation gate itself |

There is **no LLM logic in this module and none is to be added.** It is local storage and local
retrieval. A lookup that finds nothing returns `MemoryLookupResult.Miss` — a plain value. What
the app does next is the app's business.

Equally: **no network code, no permissions, no exported components, no logging of translation
text.** What the user signs is medical and personal; it stays on the phone.

---

## 2. Toolchain

| Thing | Version | Where it is pinned |
|---|---|---|
| Kotlin | **2.0.21** (K2 compiler) | `gradle/libs.versions.toml` |
| Gradle | **8.14.x** (8.5+ works) | `gradle/wrapper` / system Gradle |
| JDK | **17** target, build on 17 or 21 | `core/build.gradle.kts`, `android/build.gradle.kts` |
| Android Gradle Plugin | **8.7.3** | `libs.versions.toml` |
| KSP | **2.0.21-1.0.28** (must track Kotlin) | `libs.versions.toml` |
| Room | **2.6.1** (via KSP, not kapt) | `libs.versions.toml` |
| compileSdk / minSdk | **35 / 26** | `android/build.gradle.kts` |
| Tests | JUnit 4 (`:core`), Robolectric 4.13 (`:android`) | `libs.versions.toml` |

Rules:

- **All versions live in `gradle/libs.versions.toml`.** No version literals in a module's
  `build.gradle.kts`.
- `:core` targets JVM 17 bytecode via `compilerOptions.jvmTarget` — **not** `jvmToolchain(17)`,
  which forces a toolchain download on machines that only have 21. Keep it that way.
- **Kotlin 2.0 / K2 only.** No `kotlin-kapt` anywhere; Room code generation is KSP.
- When bumping Kotlin, bump KSP in the same commit — a mismatched pair fails at configuration
  time with a confusing message.

### Two modules, one reason

```
:core     pure Kotlin/JVM   — all retrieval logic, zero Android imports
:android  Android library   — Room store, ADPF hints, coroutine facade; depends on :core
```

`:core` has **no `android.*` import**, and that is not an accident: it means the entire engine is
testable in milliseconds on any JVM, with no emulator and no Android SDK. Anything that needs an
Android type goes in `:android`, behind a socket interface declared in `:core`
(`MemoryStore`, `PerformanceGovernor`, `Clock`, `WriteScheduler`, `MemoryErrorListener`).

**If you are about to add an Android import to `:core`, you are in the wrong module.**

`settings.gradle.kts` includes `:android` only when an Android SDK is visible (`ANDROID_HOME`,
`ANDROID_SDK_ROOT`, or `local.properties` with `sdk.dir`), so `:core` stays buildable on a bare
container. Force inclusion with `-PforceAndroidModule=true`.

---

## 3. Commands

```bash
cd memory-layer

gradle :core:test                    # the main suite — fast, no SDK needed
gradle :core:test --tests '*near misses*'   # a single test
gradle :android:testDebugUnitTest    # Robolectric Room tests (needs the SDK)
gradle :android:assembleDebug        # AAR
gradle build                         # everything configured on this machine
```

In Android Studio: open `memory-layer/` directly (it is a standalone Gradle build), or add
`includeBuild("memory-layer")` / `include(":memory-layer:core")` from the app's settings file.

---

## 4. Architecture, and the invariants behind it

```
lookup(tokens)
   │
   ├─ TokenNormalizer      raw recognizer output -> canonical glosses      (allocates once)
   ├─ SequenceIndex        hash(tokens) -> slot                            O(1), zero-alloc
   │     └─ hit -> MemoryLookupResult.Exact, score 1.0             <- the common case
   └─ MemoryIndex.search   inverted index -> top-48 candidates -> precise scoring
         └─ >= threshold -> Fuzzy,  else Miss(BELOW_THRESHOLD)
```

Invariants. Breaking one of these is what "slow" looks like later:

1. **The read path does no I/O and takes no write lock.** Lookups take the read lock of a
   `ReentrantReadWriteLock` and touch RAM only.
2. **The exact path allocates nothing per call** beyond the normalized token list. Do not
   introduce a joined key `String`, a boxed `Long` key, or a `HashMap<String, …>` on that path.
3. **Per-lookup scratch state is `ThreadLocal`.** Several threads look up at once (camera
   thread, coroutine workers, main thread). Shared mutable scratch = silently wrong results.
4. **Ids are assigned in RAM, never by SQLite.** A confirmed memory must be usable before the
   write reaches disk; the Room primary key is explicit.
5. **Persistence failures degrade, never throw to the caller.** Catch, count
   (`stats().storeFailures`), flip `degraded`, notify `MemoryErrorListener`, keep serving.
6. **Bad input is a value, not an exception.** `lookup` returns `Miss`, `remember` returns
   `Rejected(reason)`. Nothing a glitching classifier emits may crash the app.
7. **Every limit is in `MemoryConfig`.** No magic numbers in the engine.
8. **Results are deterministic.** Ranking ties break by use count, then recency, then id — the
   tests depend on it and so does a reproducible demo.

### Fuzzy scoring

```
score = (0.45 · weightedJaccard + 0.25 · queryCoverage + 0.30 · lcsRatio) / weightSum
```

IDF weighting makes a rare gloss (`METFORMIN`) count for more than a ubiquitous one (`ME`); the
LCS term makes sign *order* count. If you change a weight or a threshold, change it in
`MemoryConfig` defaults and re-run `MemoryLayerTest` — several tests assert the *relative*
behaviour those numbers produce (ordered beats shuffled, one common gloss is not enough).

---

## 5. Testing rules

`:core` tests are the safety net for everything above. This is a hackathon build, so the suite is
deliberately compact — one file per module, covering behaviour rather than every internal:

- `core/src/test/.../MemoryLayerTest.kt` — **20 tests**: store/retrieve, near-miss retrieval and
  ranking, bad input, a closed layer, restart + corrupt rows, a failing database, capacity and
  pinning, concurrent readers/writers, and a flat-scaling lookup check.
- `android/src/test/.../RoomMemoryStoreTest.kt` — **3 Robolectric tests**: a record round trip
  through SQLite, touch/update/delete semantics, and a full persist-and-restore cycle.

Both suites run in seconds. Keep them that way: no emulator, no sleeps, no network.

When you add behaviour:

- Add a test **in `:core`** if it can live there. Only Room-specific behaviour belongs in
  `:android`.
- Use `TestClock` for anything time-dependent; never `Thread.sleep` to advance time.
- Use `WriteScheduler.DIRECT` for deterministic persistence, `BackgroundWriteScheduler` when
  the point *is* the asynchrony (then `flush()` before asserting).
- Performance assertions stay **loose** and print their numbers. They exist to catch an
  accidental O(n) scan, not to benchmark a container. Never tighten one to the point where a
  busy CI machine fails it.
- New `MemoryConfig` field → give it a default that preserves current behaviour, and a test
  that exercises a non-default value.

---

## 6. Code style

- Kotlin official style (`kotlin.code.style=official`), 4-space indent, ~100-column lines.
- Public API gets KDoc that says **why**, not what. The "what" is readable from the signature.
- Comments explain trade-offs and non-obvious decisions (why an open-addressing table instead of
  `HashMap`, why `Locale.ROOT`). Do not narrate the obvious.
- Prefer primitive arrays (`IntArray`, `DoubleArray`, `IntList`) over boxed collections on any
  path that runs per lookup.
- `internal` for engine internals, `public` only for the API surface in `MemoryLayer`,
  `MemoryModel`, `MemoryConfig`, the socket interfaces, and `MudraMemory`.
- No new dependencies in `:core`. It stays pure stdlib. `:android` adds only Room, coroutines,
  and `androidx.core`.

---

## 7. Things that will be sent back in review

- An LLM call, prompt, HTTP client, or any network dependency anywhere in this module.
- An `android.*` import in `:core`.
- Logging translation text or gloss sequences at `Log.i`/`Log.d` (personal medical content).
- A blocking database call on the lookup path.
- Allocation added to the exact-match path.
- `kapt`, a version literal outside `libs.versions.toml`, or a Kotlin/KSP version mismatch.
- A new public API without tests, or a behaviour change without a test that would have caught it.
- Silently swallowing a store failure without counting it and flipping `degraded`.
