# MUDRA+

**An on-device ASL-to-speech assistant that lets Deaf and hard-of-hearing users make and take
phone calls without a human interpreter — and gets faster every time they use it.**

Sign into the camera → the signs become glosses → a local language model composes the sentence →
**you confirm it** → the phone speaks it into the call. The other party's speech is transcribed
back onto the screen.

Built for **iQOO City Battles, Chennai**, and tuned for the **iQOO 15 (Snapdragon 8 Elite Gen 5)**.

Everything in the live path runs on the phone: hand tracking, sign matching, sentence generation,
speech-to-text and text-to-speech. No API keys, no server, no account, and nothing about your
medical or personal life leaves the device.

---

## The problem

A Deaf person cannot independently do the single most mundane thing in adult life: **make a phone
call.**

- The pharmacy that only takes orders by phone. The clinic that "will call you back". The
  delivery driver standing outside your building.
- Relay and interpreter services exist, but they require scheduling, a third human on the line,
  and telling a stranger your prescription and your address.
- In an emergency, that gap is not an inconvenience. It is the difference between getting an
  ambulance and not.

Existing sign-language tech doesn't close it either:

| What's out there | Why it doesn't solve the call |
|---|---|
| Cloud sign-recognition APIs | Round-trip latency in a live call; your medical speech on someone's server |
| Big word-level models (WLASL ~2 000 signs) | Accuracy collapses in the wild, and the words you actually need (*Metformin*, your street name) aren't in the vocabulary |
| Fingerspelling keyboards | Correct, but far too slow to hold a conversation |
| Text-to-speech apps | Assume you can already type the sentence — which is not how a signer thinks or communicates |

MUDRA+ targets the gap directly: **the recurring, high-stakes call**, done alone, in seconds,
privately.

---

## The core idea: lean on the detection model as little as possible

Most sign-language systems try to make one big model do everything — recognize a huge vocabulary
*and* produce fluent English. That model is then the single point of failure, needs retraining to
learn anything new, and is exactly what falls apart under bad lighting on a real phone.

MUDRA+ inverts that. **Recognition is the smallest, dumbest part of the system.**

```
Traditional                          MUDRA+
───────────                          ──────
Big trained classifier               MediaPipe landmarks + geometric template match
   ↓ must be right about             (no neural classifier in the live path)
   the whole sentence                   ↓ only has to be right about ONE sign
                                     Local LLM composes the sentence
                                        ↓ only runs when the phrase is new
                                     Memory returns what you confirmed before
                                        ↓ O(1), no model at all
                                     You confirm. Then it speaks.
```

Three deliberate moves make that work:

**1. No trained sign classifier in the live path.** Google's MediaPipe Hand Landmarker gives 21
3-D landmarks per hand. We normalize those around the wrist, derive a 72-dimension feature vector,
and match it against stored templates by RMS Euclidean distance. That's geometry, not inference.
It means a user can **teach the app a brand-new sign by holding it for one second** — no training
run, no new model file, no app update. A trained classifier physically cannot do that: its output
layer is hard-wired to the vocabulary it was trained on.

**2. The LLM does the linguistic lifting, not the recognition.** Glosses are not English. `ME NEED
METFORMIN ONE STRIP` has no articles, no tense, no politeness. Asking a vision model to jump
straight to *"I need one strip of Metformin, please"* is asking it to do a language task with a
camera. So recognition only has to answer "which sign is this?" — a much easier question — and a
local Qwen2.5-3B turns the gloss sequence into a sentence. **Recognition accuracy requirements
drop dramatically**, which is precisely why a five-template vocabulary can drive a real
conversation.

**3. Memory removes the model from the loop entirely.** People repeat themselves. The same person
orders the same medicine from the same pharmacy every month. Once you have confirmed
`ME|TEA|HOT → "I want hot tea"`, that sequence never needs a model again — it is a hash lookup
that returns in about a microsecond. The translation memory layer makes the app **faster and more
reliable the more you use it**, which is the opposite of how an ML product usually ages.

The safety net across all three: **nothing is ever spoken until you confirm it.** The LLM's output
is a candidate, not an action. That gate is the hallucination guard and the misrecognition guard
at the same time.

---

## Why this is a productivity tool, not a demo

The framing matters. MUDRA+ is not "a translator you marvel at once" — it is **autofill for your
own voice**.

- **Your phrases, not a phrasebook.** The memory holds what *you* confirmed, in your wording.
- **It compounds.** First pharmacy call: sign, wait for the model, confirm. Fifth pharmacy call:
  sign, it's already filled in, speak. The slow path is a one-time cost per phrase.
- **Pin what matters.** Emergency phrases are pinned so eviction can never reclaim them, and they
  are there instantly, offline, at 2 a.m.
- **Your own vocabulary.** Add `METFORMIN`, your landlord's name, your street — signs no public
  dataset will ever contain.
- **It works with no signal.** On a train, in a basement clinic, on a dead data plan.

---

## Architecture

```
┌──────────────────────── PHONE (React Native 0.76 + native modules) ────────────────────┐
│                                                                                         │
│  Camera (react-native-vision-camera)                                                    │
│      │ frames                                                                           │
│      ▼                                                                                  │
│  MediaPipe Hand Landmarker  (frame-processor plugin, hand_landmarker.task)              │
│      │ 21 × {x,y,z} landmarks per frame                                                 │
│      ▼                                                                                  │
│  Capture gate  (assessCapture: hand present? close enough? steady?)                     │
│      │                                                                                  │
│      ▼                                                                                  │
│  Template matcher  (gestureRecognizer: 72 features → RMS distance → nearest template)   │
│      │ gloss token, or UNKNOWN above threshold 0.42                                     │
│      ▼                                                                                  │
│  Gloss sequence:  ["ME","NEED","METFORMIN","ONE","STRIP"]                               │
│      │                                                                                  │
│      ├─────────────►  Translation memory  ──── hit ────►  sentence, ~1 µs, no model     │
│      │                (memory-layer / memory-layer-rn)                                  │
│      │                                                                                  │
│      └── miss ──────►  Local LLM  (llama.rn + Qwen2.5-3B-Instruct Q4_K_M)                │
│                            │ 2–3 candidate sentences                                    │
│                            ▼                                                            │
│                     ┌──────────────────────────────────┐                                │
│                     │  CONFIRMATION GATE               │  ← nothing is spoken until     │
│                     │  pick / edit / discard           │     the user confirms          │
│                     └──────────────────────────────────┘                                │
│                            │ confirmed sentence                                         │
│                            ├──────────►  remembered for next time                       │
│                            ▼                                                            │
│                     TTS (react-native-tts) → speaker → the live call                    │
│                                                                                         │
│  Incoming: call audio → mic → whisper.rn (ggml-tiny) → transcript on screen             │
│  Relay:    LAN peer discovery (zeroconf) + TCP socket between two phones                │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Getting the voice into the call

Android gives third-party apps **no public API to inject audio into a cellular call**. Two
approaches are implemented/documented rather than one, because this is the hardest constraint in
the product:

1. **Acoustic coupling** (`asl-call-relay.md`) — put the call on speakerphone and let the phone's
   own microphone, already open for the call, pick up the TTS output. Simple, needs no server,
   works on any carrier call. Cost: audio quality, and echo cancellation can fight it.
2. **Local relay** (`app/src/relay/`) — two phones on the same network discover each other over
   zeroconf/mDNS and hold a TCP socket. The signer's phone sends text; the receiving phone speaks
   it and streams back a transcript. No cloud telephony, no Twilio bill, no third party hearing
   the conversation.

---

## Repository map

| Path | What it is | State |
|---|---|---|
| `app/` | The React Native app — camera, recognition, LLM, memory, relay, all five screens | **Working** |
| `app/src/recognition/` | MediaPipe landmarks → 72 features → template match; capture quality gate; user gesture store | **Working, unit-tested** |
| `app/src/llm/` | `LlmProvider`, `LocalLlmProvider` (llama.rn), prompts, `sentenceMemory` | **Working** |
| `app/src/relay/` | zeroconf discovery + TCP sender/receiver | **Working** |
| `memory-layer/` | Kotlin/Android translation memory (Room + ADPF), standalone Gradle build | **Working, 23 tests** |
| `memory-layer-rn/` | TypeScript port of the same engine for RN, zero runtime deps | **Working, 23 tests** |
| `sign-embeddings/` | Alternative custom-sign path: reuse an internal layer of a trained TFLite model as an embedding extractor, match by cosine similarity | Module built + tested, not wired into the app |
| `llm-testbed/` | Standalone RN app to benchmark on-device GGUF models before integration | Tooling |
| `PLAN.md` | Original full-system implementation plan | Reference |
| `TRAINING.md` | Plan for training a TFLite gloss classifier (the path we deliberately did **not** need) | Reference |
| `FEATURE.md` | Writeup of the custom-gesture recognition work | Reference |
| `asl-call-relay.md` | Call-audio architecture notes and the Android constraint | Reference |

---

## Every model used

| Model / artifact | File | Runtime | Role |
|---|---|---|---|
| **MediaPipe Hand Landmarker** | `hand_landmarker.task` | MediaPipe Tasks (native, GPU-delegated) via a VisionCamera frame-processor plugin | 21 3-D hand landmarks per frame. The only vision model in the live path. |
| **Qwen2.5-3B-Instruct** | `qwen2.5-3b-instruct-q4_k_m.gguf` (~2.0 GB, Q4_K_M) | `llama.rn` (llama.cpp) on CPU/GPU | Gloss sequence → candidate English sentences; conversation-aware replies |
| **Whisper tiny** | `ggml-tiny.bin` (~75 MB) | `whisper.rn` (whisper.cpp) | On-device speech-to-text for the other party's voice |
| **Android TTS** | system voices | `react-native-tts` | Speaks the confirmed sentence into the call |
| **Gesture templates** | `custom_gestures.json` + user file | Pure TypeScript, no model | 21 landmarks + 72 features per sign, matched by RMS distance. 5 bundled; users add their own at runtime. |
| *(not in the live path)* | `sign_embed.tflite` | TFLite | `sign-embeddings/`: embedding extractor for cosine-similarity custom signs — the fallback design if template matching ever needs more power |

Alternative GGUF choices are documented per RAM tier in `llm-testbed/README.md`
(Qwen2.5-1.5B at 6 GB, 3B at 8 GB, 7B at 12 GB+).

**Nothing here calls a cloud API.** There is no OpenAI/Anthropic/Gemini key anywhere in the live
app, and no network dependency outside the optional LAN relay between two phones you own.

---

## Technical notes

### Recognition (`app/src/recognition/`)

- **Landmarks.** A VisionCamera frame processor runs the native MediaPipe hand landmarker and
  returns 21 `{x, y, z}` points per detected hand.
- **Features.** Landmarks are normalized around the wrist (translation- and scale-invariant), then
  expanded into a **72-dimension feature vector** — the identical transform the snapshot trainer
  used to produce the bundled templates, so recorded and bundled signs are directly comparable.
- **Matching.** Rank every template by RMS Euclidean distance; emit `UNKNOWN` when the nearest is
  above the configurable threshold (default **0.42**). An honest `UNKNOWN` is worth far more than a
  confident wrong gloss on an emergency call.
- **Capture quality gate.** Before a capture is accepted: is a hand present, is it close enough
  (`handSpread`), did it hold still (`maxJitter`)? Failures return plain-language reasons — "Move
  your hand closer", "Hold your hand steady" — instead of silently storing a bad template.
- **Hold-to-confirm.** `SignGuideCircle` fills over ~1 s; a cooldown forces a sign to visibly
  re-form before it can fire again, so one held hand can't spam the same gloss.
- **Detection zone.** On the call screen, only a hand held at sign height near the guide circle
  counts — a hand reaching for the phone isn't a sign.
- **User signs live alongside bundled ones.** Persisted to an app-private JSON file with atomic
  temp-file-then-swap writes, a pub-sub so other mounted screens reload instantly, and a serialized
  save queue so concurrent captures can't corrupt the store. A user label overrides a bundled one
  of the same name.

### Sentence generation (`app/src/llm/`)

- `LlmProvider` is a one-method interface (`complete(system, user)`); `LocalLlmProvider` implements
  it over `llama.rn`. The app ships with the local provider — a cloud provider is possible but
  deliberately not wired in.
- Prompts ask for **multiple candidate sentences**, because a gloss sequence is genuinely
  ambiguous: `ARRIVED HOME` means different things from the customer and the driver. The user
  picks; the app doesn't guess on their behalf.
- The live call's conversation history is fed back as context, so replies fit what was just said.
- `sentenceMemory.ts` remembers **which candidate the user picked** for each exact gloss sequence
  and resurfaces it ahead of fresh LLM guesses. Picking a different sentence later *adds* an option
  rather than replacing the old one — same ambiguity, remembered instead of re-derived. Once a
  sequence has enough remembered options, the LLM is never called for it again.

### Translation memory (`memory-layer/`, `memory-layer-rn/`)

The same engine in two languages: Kotlin/Android (Room + SQLite) and TypeScript (any RN SQLite
binding, via a six-line adapter). Both are standalone, dependency-free, and independently tested.

- **Exact hits are O(1).** Kotlin hashes the token characters in place (FNV-1a, no joined key
  string, zero allocation) into an open-addressing table; collisions are resolved by *verifying
  tokens*, never by trusting the hash. Measured **~1 µs/lookup, flat from a 1 000-memory corpus to
  a 50 000-memory one** (the TS port measures ~2.1 µs using a `Map`, the idiomatic O(1) in JS).
- **Near hits are cheap.** A two-stage fuzzy search: an IDF-weighted inverted index narrows the
  corpus to 48 candidates, then those are scored precisely with
  `0.45·weightedJaccard + 0.25·queryCoverage + 0.30·lcsRatio`. The LCS term makes sign *order*
  count; IDF makes a rare gloss (`METFORMIN`) outweigh a ubiquitous one (`ME`). Unknown glosses get
  single-edit repair (`METFORMIM → METFORMIN`) against a length-bucketed vocabulary.
- **Writes never block a read.** Ids are assigned in RAM, so a confirmed phrase is queryable before
  SQLite has heard of it; persistence is write-behind on a background thread (Kotlin) or a
  serialized promise chain (TS).
- **It degrades instead of failing.** A corrupt or full database flips the layer to memory-only,
  counts the failure and notifies the app — retrieval keeps working for the rest of the session.
  Warm-up skips corrupt rows rather than failing start-up. Bad input from a glitching recognizer is
  a returned value, never an exception.
- **Bounded.** 20 000 memories max, then the least-used/least-recent **unpinned** entry is evicted.
  Pinned emergency phrases are never evicted; a fully pinned corpus refuses a new write instead of
  dropping one.

### Call and audio

- **Outgoing:** confirmed text → `react-native-tts` → speaker → the live call (acoustic coupling),
  or → TCP relay → the receiving phone speaks it.
- **Incoming:** mic → `@fugood/react-native-audio-pcm-stream` → `whisper.rn` (ggml-tiny) →
  transcript on screen. The receive mic is paused while the phone is speaking, so the app doesn't
  transcribe its own voice back into the conversation.
- **Discovery:** `react-native-zeroconf` advertises/browses on the LAN; `react-native-tcp-socket`
  carries the session. Connection status shown in the UI is the real socket state.

### App (`app/`)

React Native 0.76 (bare), TypeScript strict, React Navigation native stack. A tokenised design
system (`src/theme`) — screens never hard-code a colour or a spacing value, so dark mode follows
the system setting for free. Icons are a hand-written 24 px SVG set rather than an icon font.
Icon-only controls always carry an `accessibilityLabel`; nothing interactive is under 44 pt.

Screens: **Home** (one hero action), **Call**, **Receive**, **Memory**, **Add custom sign**.

---

## Running on Snapdragon (iQOO 15 / 8 Elite Gen 5)

The target device is not incidental — several choices exist because of it.

- **A 3B model fits comfortably.** Q4_K_M at ~2.0 GB sits well inside the iQOO 15's RAM, which is
  why the app bundles a 3B rather than the 1.5B the original plan assumed. `llama.rn` runs it on
  CPU/GPU via llama.cpp's ARM NEON/dotprod kernels with `n_gpu_layers` offload. (It does **not**
  use the Hexagon NPU — llama.cpp has no QNN backend in this configuration, and we'd rather state
  that than imply an acceleration path we didn't take.)
- **ADPF performance hints.** The memory layer's `AdpfPerformanceGovernor` opens a
  `PerformanceHintManager` session per lookup thread (Android 12+), declaring a ~2 ms target and
  reporting the actual duration. This matters specifically on a big.LITTLE flagship: a
  microsecond-scale burst finishes on an efficiency core *before* a reactive governor notices it
  should have ramped. Declaring intent up front puts the work on the right core in the first place.
  Every part of it degrades to a no-op on unsupported devices.
- **Core-aware threading.** The memory layer's write-behind thread runs at
  `THREAD_PRIORITY_BACKGROUND` so SQLite never competes with the camera pipeline for prime cores.
  Room opens in WAL with `synchronous = NORMAL` on its own single-threaded executor.
- **GPU-delegated hand tracking** keeps the per-frame landmark cost off the CPU that llama.cpp is
  using.
- **Thermals are the real budget.** Continuous camera + continuous LLM is what heats a phone, so
  the architecture minimises *how often* the LLM runs at all — which is exactly what the memory
  layer and `sentenceMemory` are for. A repeated phrase costs a hash lookup, not a 3B forward pass.
- OriginOS "performance mode" toggles are not app-accessible APIs; ADPF is the supported route to
  the same scheduler, and the code doesn't pretend otherwise.

---

## Privacy

- No cloud inference. No API keys. No accounts. No analytics.
- Prescriptions, addresses and emergency details never leave the phone.
- The memory layer has no network code, no permissions, and no exported components, and never logs
  translation text.
- Custom signs and remembered sentences live in app-private storage; "clear all" actually clears.
- The only network traffic the app can make is a LAN socket to another phone you pair with.

---

## Build and run

```bash
# The app
cd app
npm install
npm start                       # Metro
npm run android                 # device with USB debugging, or:
npm run ios                     # (cd ios && pod install first)

# Model assets (see app/scripts and llm-testbed/README.md for the full flow)
adb push qwen2.5-3b-instruct-q4_k_m.gguf /sdcard/Android/data/<pkg>/files/models/
```

```bash
# Kotlin memory layer — no Android SDK needed for the engine
cd memory-layer && ./gradlew :core:test

# TypeScript memory layer
cd memory-layer-rn && npm install && npm test

# Custom-sign embedding module
cd sign-embeddings && npm install && npm test

# On-device LLM benchmark harness
cd llm-testbed && npm install && npm run android
```

## Testing

| Suite | What it covers |
|---|---|
| `app` Jest | Recognition (capture gating, duplicate/collision logic, merged templates, gesture store), LLM helpers, screen smoke tests |
| `memory-layer` (Kotlin) | 20 JVM tests + 3 Robolectric: retrieval, near-miss ranking, bad input, restart, corrupt rows, failing database, capacity, concurrency, flat-scaling lookups |
| `memory-layer-rn` | 23 Jest tests, including the SQLite store exercised against a **real** engine via `node:sqlite` |
| `sign-embeddings` | Matching, priority and collision logic against synthetic embedding vectors |

Every suite runs on a laptop in seconds — no emulator, no device, no network.

---

## Honest status

**Working today:** live hand tracking, custom sign capture and matching, on-device sentence
generation, sentence memory, the translation memory layer (both ports), LAN relay with live
connection state, on-device transcription, TTS output, and the full five-screen app.

**Working with caveats:** acoustic coupling into a carrier call depends on the handset's echo
cancellation; the bundled template vocabulary is small by design and grows by user recording, not
by retraining.

**Built but not wired in:** `sign-embeddings` (the TFLite-embedding path for custom signs) is
implemented and tested as a module, but the app currently uses geometric template matching, which
needs no trained model at all.

**Not built:** cloud telephony (a deliberate non-goal), a trained multi-thousand-sign classifier
(the architecture is designed so we don't need one), two-handed and motion-based signs.

---

## Where this was built

**iQOO City Battles — Chennai.** Built and demoed on an iQOO 15 (Snapdragon 8 Elite Gen 5), fully
offline, with the phone in airplane mode for the privacy demo.

The pitch in one line: *an assistive product that gets measurably faster the more one person uses
it, because it remembers that person instead of retraining a model.*

## Credits

Built on open source: MediaPipe Tasks, llama.cpp via `llama.rn`, whisper.cpp via `whisper.rn`,
Qwen2.5 (Alibaba), React Native, Room/SQLite, VisionCamera.
