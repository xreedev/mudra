# MUDRA+

**A demo of an on-device ASL input accelerator: a small, high-accuracy sign vocabulary plus
autocomplete, so a short spoken sentence costs a few signs instead of a whole sentence of them.**

Built and completed during **iQOO City Battles, Chennai**, on an **iQOO 15 (Snapdragon 8 Elite
Gen 5)**. Everything in the live path runs on the phone — hand tracking, sentence composition,
transcription and memory. No server, no API key, no account.

```
sign 2–3 glosses  →  ME NEED METFORMIN  →  candidate sentences  →  you pick one  →  spoken
                                            ↑                        ↑
                            memory (~1 µs) or local 3B LLM      nothing is spoken
                                                                 before this point
```

---

## Scope

This is a **prototype**, and the scope is deliberately narrow:

- It is an **autocomplete for a signer's own recurring phrases**, not a translation system. The
  system has no opinion about grammar it has not been shown; it proposes candidate sentences and
  the user chooses one.
- **Interpretation is a human skill and this does not attempt it.** The design assumes a person
  driving the tool for their own phrases, in their own words, with a confirmation step they
  control — not a machine speaking on anyone's behalf.
- The demo vocabulary is **small on purpose** (five bundled single-hand static poses, plus
  whatever the user records). The interesting question here is not vocabulary size — it is how
  far a *small, reliable* vocabulary gets you when autocomplete and memory carry the rest.
- **Detection for the demo is MediaPipe hand landmarks + geometric template matching**, not a
  trained sign classifier. See [Why no classifier](#why-no-trained-classifier-in-the-live-path).
- The natural next step is evaluation **with signers**, on the ergonomics of the capture gate,
  the hold duration, and whether the candidate sentences are worth choosing between. Nothing here
  has been through that yet, so the numbers in this README are engineering measurements, not
  user-study results.

---

## Design rationale

### Why autocomplete instead of sign-every-word

Signing a full English sentence is expensive twice over: physically, and statistically.

If per-sign recognition accuracy is `p`, the probability that an `n`-sign sentence is recognised
end to end is roughly `p^n`. The exponent is the problem:

| Signs needed | p = 0.95 | p = 0.90 |
|---|---|---|
| 8 (full sentence) | 0.66 | 0.43 |
| 5 | 0.77 | 0.59 |
| **3 (gloss key + autocomplete)** | **0.86** | **0.73** |

*(A model of the failure mode, not a measurement — but it is the reason the architecture is
shaped this way.)*

Two levers follow directly:

1. **Reduce `n`** — don't sign the sentence, sign the *key*. `ME NEED METFORMIN` is enough to
   retrieve or generate "I need one strip of Metformin, please."
2. **Raise `p`** — a small vocabulary of distinct, well-separated poses is far easier to get right
   than a large one with near-collisions, and a rejection threshold means the system answers
   `UNKNOWN` instead of guessing.

Both levers point away from a big classifier and toward a small matcher plus a strong
autocomplete. That is the whole architecture in one sentence.

### Why no trained classifier in the live path

A trained classifier's output layer is fixed to the vocabulary it was trained on. Adding one sign
means collecting data, retraining, re-exporting and shipping a new model file — which is
incompatible with the thing this demo most wants to test: **a user adding their own sign in a
second and using it on the next frame.**

So the live path uses geometry instead:

```
21 landmarks → normalise around wrist → 72-dim feature vector → RMS distance to templates
                                                              → nearest, or UNKNOWN above τ
```

`sign-embeddings/` implements the fallback design (reuse an internal layer of a trained TFLite
model as an embedding extractor, match by cosine similarity) for when template matching runs out
of headroom. It is built and tested but not wired in, because the demo does not need it.

### Why the LLM is small and rarely called

Glosses are not English — no articles, no tense, no register. That is a language task, so a
language model does it rather than the vision path. But the LLM is the slowest and hottest
component, so the architecture minimises **how often** it runs:

- an exact gloss sequence already confirmed → **memory, O(1), no model**;
- a sequence whose candidates the user has chosen from before → **sentence memory, no model**;
- only a genuinely new sequence reaches the 3B.

That ordering is also why the demo stays interactive on a phone under sustained camera load.

---

## System architecture

```
┌──────────────── PHONE (React Native 0.76 + native modules) ─────────────────────┐
│                                                                                  │
│  react-native-vision-camera                                                      │
│      │ frames                                                                    │
│      ▼                                                                           │
│  MediaPipe Hand Landmarker  (frame-processor plugin, hand_landmarker.task)       │
│      │ 21 × {x,y,z}                                                              │
│      ▼                                                                           │
│  assessCapture      hand present? close enough (handSpread)? steady (maxJitter)? │
│      ▼                                                                           │
│  gestureRecognizer  normalise → 72 features → RMS distance → nearest | UNKNOWN   │
│      │ gloss token (hold-to-confirm, ~1 s, with cooldown)                        │
│      ▼                                                                           │
│  Gloss sequence  ["ME","NEED","METFORMIN"]                                       │
│      │                                                                           │
│      ├── exact hit ──► translation memory        ~1 µs, no model                 │
│      ├── seen before ─► sentenceMemory.json      previously chosen candidates    │
│      └── new ────────► llama.rn + Qwen2.5-3B     2–3 candidate sentences         │
│                              │                                                   │
│                              ▼                                                   │
│                   ┌────────────────────────┐                                     │
│                   │  CONFIRMATION GATE     │  pick · edit · discard              │
│                   └────────────────────────┘                                     │
│                              │ confirmed                                         │
│                              ├──► remembered (gloss sequence → sentence)         │
│                              ▼                                                   │
│                   react-native-tts → speaker  ── or ──► LAN relay → peer phone   │
│                                                                                  │
│  Inbound: mic → PCM stream → whisper.rn (ggml-tiny) → transcript on screen       │
│           (mic pauses while the phone is speaking, to avoid self-transcription)  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Getting audio into a call

Android exposes **no public API for injecting audio into a cellular call**, which constrains the
whole output stage. Two routes are implemented:

| Route | How | Trade-off |
|---|---|---|
| **Acoustic coupling** (`asl-call-relay.md`) | Speakerphone; the call's own open mic picks up the TTS output | Works on any carrier call, no infrastructure; quality is lower and handset echo cancellation can suppress it |
| **LAN relay** (`app/src/relay/`) | zeroconf/mDNS discovery + TCP socket between two phones; sender transmits text, receiver speaks it and streams a transcript back | Clean audio, no cloud telephony; both phones must be on the same network |

---

## Repository layout

| Path | Contents |
|---|---|
| `app/` | React Native app: camera, recognition, LLM, memory, relay, five screens |
| `app/src/recognition/` | `gestureRecognizer`, `captureQuality`, `duplicateDetection`, `userGestureStore`, `useAllGestureTemplates`, `useLiveHandGestures` |
| `app/src/llm/` | `LlmProvider`, `LocalLlmProvider` (llama.rn), `prompts`, `sentenceMemory` |
| `app/src/relay/` | `AslRelaySender`, `AslRelayReceiver`, zeroconf hooks |
| `app/src/theme/`, `app/src/components/` | Design tokens and UI primitives |
| `memory-layer/` | Kotlin/Android translation memory — standalone Gradle build, Room + ADPF |
| `memory-layer-rn/` | TypeScript port of the same engine, zero runtime dependencies |
| `sign-embeddings/` | TFLite-embedding custom-sign path (built, tested, not wired in) |
| `llm-testbed/` | Standalone RN app for benchmarking GGUF models on the device |
| `PLAN.md`, `TRAINING.md` | Original plan and classifier-training plan — the path the build moved away from |
| `FEATURE.md`, `asl-call-relay.md` | Recognition writeup; call-audio architecture notes |

---

## Recognition pipeline

**Landmarks.** A VisionCamera frame processor runs the native MediaPipe hand landmarker and
returns 21 `{x, y, z}` points per detected hand.

**Features.** Points are normalised around the wrist — translation- and scale-invariant — then
expanded into a **72-dimension vector** using the same transform the snapshot trainer used, so
bundled and user-recorded templates are directly comparable.

**Matching.** Templates ranked by RMS Euclidean distance; `UNKNOWN` above threshold **0.42**
(configurable). Rejection is a feature: an honest `UNKNOWN` is recoverable, a confident wrong
gloss is not.

**Capture quality gate** (`assessCapture`) before any capture is accepted:

| Check | Failure returned |
|---|---|
| Landmark shape valid | `no-hand` |
| Hand-to-camera distance (`handSpread`) | `too-far` |
| Steadiness across the hold window (`maxJitter`) | `unstable` |

Surfaced as plain language — "Move your hand closer", "Hold your hand steady" — rather than
silently storing a bad template.

**Hold-to-confirm.** A progress ring fills over ~1 s; a cooldown forces the hand to visibly
re-form before the same gloss can fire again. On the call screen a *detection zone* restricts
matching to a hand held at sign height near the guide ring.

**User templates.** Recorded signs persist to an app-private JSON file via atomic
temp-file-then-swap writes, with a pub-sub so other mounted screens reload live and a serialised
save queue so concurrent captures cannot corrupt the store. A user label shadows a bundled one of
the same name; saving over an existing label requires confirmation.

**Demo limits:** single hand, static poses, one sign per hold. Two-handed and motion-based signs
are not implemented.

---

## Autocomplete

Two stores, different jobs.

### Translation memory (`memory-layer/`, `memory-layer-rn/`)

The same engine in Kotlin (Room/SQLite) and TypeScript (any SQLite binding via a six-line
adapter). Standalone, dependency-free, independently tested.

**Exact path — O(1).** Kotlin hashes the token characters in place (FNV-1a, no joined key string,
zero allocation) into an open-addressing table; collisions resolve by *verifying tokens*, never by
trusting the hash. The TS port uses a `Map` on the joined key, which is the idiomatic O(1) in JS.

**Fuzzy path — two stages**, so order-aware scoring only ever sees a few dozen records:

1. Inverted index walk, accumulating IDF-weighted token overlap into a reused `Float64Array`
   (generation-stamped, so nothing is cleared between lookups). Tokens appearing in >60 % of
   memories are skipped unless the query has nothing else, with a fallback scan. Unknown glosses
   get single-edit repair against a length-bucketed vocabulary (`METFORMIM → METFORMIN`).
2. The top 48 candidates are scored
   `0.45·weightedJaccard + 0.25·queryCoverage + 0.30·lcsRatio`; the LCS term makes sign *order*
   count. Ties break by use count, then recency, then id — fully deterministic.

**Measured** (shared CI container, not the phone):

| | Kotlin | TypeScript |
|---|---|---|
| Exact lookup | ~1 µs | ~2.1 µs |
| Scaling, 1 k → 50 k memories | flat | flat |
| Tests | 20 JVM + 3 Robolectric | 23 Jest (SQLite against a real engine via `node:sqlite`) |

**Failure behaviour.** Ids are assigned in RAM, so a confirmed phrase is queryable before SQLite
has heard of it; persistence is write-behind. A corrupt or full database flips the layer to
memory-only, counts the failure and notifies the app. Warm-up skips corrupt rows instead of
failing start-up. Malformed recogniser output is a returned value, never an exception. Capacity is
bounded at 20 000 with least-used/least-recent eviction; pinned entries are never evicted.

### Sentence memory (`app/src/llm/sentenceMemory.ts`)

Records **which candidate the user picked** per exact gloss sequence, and resurfaces it ahead of
fresh generation. A sequence can legitimately mean different things on different occasions, so
picking a different sentence later *adds* an option rather than replacing the earlier one. Once a
sequence has enough remembered options, the LLM is not called for it again. Stored as
app-private JSON with the same atomic-write approach as the gesture store.

---

## LLM layer

`LlmProvider` is a one-method interface (`complete(system, user)`); `LocalLlmProvider` implements
it over `llama.rn`. The app ships local-only — there is no cloud provider wired in and no API key
anywhere in the live path.

- Prompts request **multiple candidates**, because a gloss sequence is genuinely ambiguous
  (`ARRIVED HOME` differs between a customer and a driver). The user chooses; the app does not
  guess on their behalf.
- Call conversation history is fed back as context so replies fit what was just said.
- Output is a candidate, never an action — it reaches speech only through the confirmation gate,
  which is also the guard against a hallucinated or misrecognised sentence.

---

## Models

| Model | Artifact | Runtime | Role |
|---|---|---|---|
| MediaPipe Hand Landmarker | `hand_landmarker.task` | MediaPipe Tasks, native, GPU-delegated | 21 3-D landmarks per frame — the only vision model in the live path |
| Qwen2.5-3B-Instruct | `qwen2.5-3b-instruct-q4_k_m.gguf`, ~2.0 GB | `llama.rn` (llama.cpp), CPU/GPU | Gloss sequence → candidate sentences; contextual replies |
| Whisper tiny | `ggml-tiny.bin`, ~75 MB | `whisper.rn` (whisper.cpp) | On-device transcription of the other party |
| Android TTS | system voices | `react-native-tts` | Speaks the confirmed sentence |
| Gesture templates | `custom_gestures.json` + user file | pure TypeScript — **no model** | 21 landmarks + 72 features per sign; 5 bundled, user-extensible |
| *(not wired in)* | `sign_embed.tflite` | TFLite | Embedding extractor for the cosine-similarity custom-sign path |

GGUF choice per RAM tier (1.5B at 6 GB, 3B at 8 GB, 7B at 12 GB+) is documented in
`llm-testbed/README.md`, the harness used to benchmark candidates on the actual device.

---

## On-device notes — Snapdragon 8 Elite Gen 5

- **Model size.** Q4_K_M at ~2.0 GB fits comfortably in the iQOO 15's RAM, which is why the demo
  bundles a 3B rather than the 1.5B originally planned. llama.cpp runs it on ARM NEON/dotprod
  kernels with GPU layer offload. It does **not** use the Hexagon NPU — llama.cpp has no QNN
  backend in this configuration.
- **ADPF hints.** `AdpfPerformanceGovernor` opens a `PerformanceHintManager` session per lookup
  thread (API 31+), declaring a ~2 ms target and reporting actual duration. On a big.LITTLE
  flagship a microsecond-scale burst otherwise completes on an efficiency core *before* a reactive
  governor reacts. Degrades to a no-op where unsupported.
- **Thread placement.** The memory layer's write-behind thread runs at
  `THREAD_PRIORITY_BACKGROUND` so SQLite never contends with the camera pipeline for prime cores.
  Room opens WAL with `synchronous = NORMAL` on its own single-threaded executor.
- **Thermals set the budget.** Continuous camera plus continuous LLM is what heats the phone, so
  the design optimises for *fewer LLM invocations* rather than faster ones — which is what both
  memory stores are for.
- OriginOS performance-mode toggles are not app-accessible APIs; ADPF is the supported route to
  the same scheduler.

---

## Build and test

```bash
# app
cd app && npm install && npm run android      # or: npm run ios (cd ios && pod install first)

# model assets — see llm-testbed/README.md for the full flow
adb push qwen2.5-3b-instruct-q4_k_m.gguf /sdcard/Android/data/<pkg>/files/models/
```

```bash
cd memory-layer     && ./gradlew :core:test    # engine needs no Android SDK
cd memory-layer-rn  && npm install && npm test
cd sign-embeddings  && npm install && npm test
cd llm-testbed      && npm install && npm run android
```

| Suite | Covers |
|---|---|
| `app` Jest | Capture gating, duplicate/collision logic, merged templates, gesture store, LLM helpers, screen smoke tests |
| `memory-layer` | Retrieval, near-miss ranking, malformed input, restart, corrupt rows, failing database, capacity, concurrency, flat-scaling lookups |
| `memory-layer-rn` | Same behaviours, plus the SQLite store against a real engine |
| `sign-embeddings` | Matching, priority and collision logic on synthetic vectors |

Everything runs on a laptop in seconds — no emulator, no device, no network.

---

## Status

Completed at the end of the hackathon. Demo-quality, and specific about which parts are which.

| Area | State |
|---|---|
| Live hand tracking, template matching, runtime sign capture | Working on device |
| On-device candidate generation (Qwen2.5-3B) | Working, bundled |
| Translation memory, both ports | Working, 46 tests, measured |
| Sentence memory | Working |
| LAN relay, transcription, TTS | Working, real connection state |
| Acoustic coupling into a carrier call | Works, subject to handset echo cancellation |
| Vocabulary | 5 bundled static single-hand poses + user recordings, by design |
| Two-handed / motion signs | Not implemented |
| `sign-embeddings` path | Built and tested, not wired in |
| Cloud telephony | Deliberate non-goal |

**Known limitations:** static single-hand poses only; recognition quality depends on lighting and
framing; the capture gate is tuned by hand rather than from data; the relay assumes a shared
network; all timing figures here are engineering benchmarks, and none of the ergonomics have been
evaluated with signers yet.

**Next, in order:** ergonomic evaluation of the hold/confirm loop with signers; motion and
two-handed signs; measured per-sign accuracy on the bundled set; wiring `sign-embeddings` if
template matching saturates.

---

## Credits

MediaPipe Tasks, llama.cpp via `llama.rn`, whisper.cpp via `whisper.rn`, Qwen2.5 (Alibaba),
React Native, Room/SQLite, VisionCamera.

Built at **iQOO City Battles, Chennai**, on an iQOO 15.
