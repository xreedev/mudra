# MUDRA+ — Implementation Plan

## Context

MUDRA+ is an on-device communication assistant that lets Deaf and hard-of-hearing users independently make and take **voice phone calls**. The user signs into the phone camera → the app recognizes the sign as text → the user **confirms** the text → the app speaks it into a live call via text-to-speech, and transcribes the other party's speech back onto the screen. The flagship flows are a pharmacy call ("I need Metformin, one strip") and an emergency call ("I'm Deaf, I need an ambulance at [address]"), where an **explicit confirmation gate** must exist before any call is placed so a misrecognized sign can never trigger an emergency.

We are building from an empty repo (`D:\GitHub\PersonalGitHub\Mudra`). This plan covers an MVP that demos the full pipeline end-to-end.

### Key decisions (confirmed with user)
- **Platform:** React Native (bare workflow / RN CLI — *not* Expo Go, native modules required). Android-first (iOS can't do the call bridge as cleanly).
- **Call transport:** **Server telephony bridge.** A hard reality — stock/unrooted phones **cannot** inject TTS into a normal carrier (PSTN) call; the modem audio path is sealed from apps. So the app opens a **WebRTC** leg to our backend, and the backend (Twilio Programmable Voice, or self-hosted Asterisk/FreeSWITCH) places the real PSTN call to the callee. The backend bridges: app TTS audio → PSTN, and PSTN callee audio → STT → text back to the app. This reaches any real phone number.
- **Sign recognition:** Open-source stack — **MediaPipe Hands/Holistic** (on-device landmark extraction) → **TFLite sequence classifier** emitting **ASL glosses/tokens** (not whole English sentences). We target **American Sign Language (ASL)** because the off-the-shelf ecosystem is larger and, crucially, the **Google/Kaggle "asl-signs" dataset (250 signs) ships as MediaPipe landmark sequences already** — the exact input shape our pipeline wants — with community repos that train it straight to a mobile **TFLite** model. That lets us skip raw-video landmark extraction and start from landmarks. See **Recognition strategy** below for the phrase-tier decision (we train a small custom gloss set for the demo rather than the full 2000-word vocabulary).
- **LLM layer — two interchangeable providers behind one interface.** All AI features go through a single `LlmProvider` interface, and a **Settings screen** picks which one is active:
  1. **Cloud API provider (built FIRST).** OpenAI / Anthropic / Gemini / any OpenAI-compatible base URL. User enters provider, model, base URL, and API key (stored in the device keychain via `react-native-keychain`, never bundled or logged). This is fastest to wire up, so the AI features work end-to-end early in the build.
  2. **On-device local provider (built SECOND — the bonus).** A **free, open-weight LLM running locally on the iQOO** via **`llama.rn`** (llama.cpp) with a small quantized **GGUF** model (**Qwen2.5-1.5B-Instruct Q4_K_M** default; Gemma-2-2B / Llama-3.2-3B if RAM allows). Fully offline, no API cost, and **sensitive medical/emergency text never leaves the device**.
  - The LLM (either provider) does: (1) **gloss → fluent spoken sentence**, (2) **smart replies** to the callee's transcript, (3) **intent/slot extraction + STT cleanup**, (4) **emergency message structuring + call summary**. Because both implement the same interface, switching provider needs no changes to feature code. Output always passes through the confirmation gate, so the user verifies (and the gate also guards against LLM hallucination). Enabling cloud mode shows a **privacy warning** (text leaves the device); on-device is the privacy-first default once shipped.

---

## Architecture

```
┌──────────────────────── DEVICE (React Native) ────────────────────────┐
│                                                                        │
│  Camera (vision-camera)                                                │
│      │ frames                                                          │
│      ▼                                                                 │
│  Frame Processor (worklet)                                             │
│      │ → MediaPipe Hands/Holistic → 21x3 (x2) + pose landmarks         │
│      ▼                                                                 │
│  Landmark buffer (sliding window ~30–45 frames)                        │
│      │                                                                 │
│      ▼                                                                 │
│  Sign Classifier (react-native-fast-tflite)  → gloss tokens + conf.    │
│      │  e.g. ["METFORMIN","ONE","STRIP","NEED"]                        │
│      ▼                                                                 │
│  ┌──────────── LLM LAYER  (LlmProvider interface) ───────────┐        │
│  │  Settings picks provider:                                 │        │
│  │   [1] Cloud API   (OpenAI/Anthropic/Gemini) — built 1st  │        │
│  │   [2] On-device   (llama.rn, Qwen2.5-1.5B GGUF) — 2nd    │        │
│  │  Same calls for both:                                     │        │
│  │   • gloss → "I need one strip of Metformin."             │        │
│  │   • smart replies to callee transcript                   │        │
│  │   • intent/slot extraction + STT cleanup                 │        │
│  │   • emergency message structuring + call summary         │        │
│  └───────────────────────────────────────────────────────────┘        │
│      │ candidate sentence                                              │
│      ▼                                                                 │
│  ┌─────────────── CONFIRMATION GATE (UI) ───────────────┐             │
│  │  Show LLM-generated text. User must tap Confirm.     │             │
│  │  (also guards against LLM hallucination)             │             │
│  │  Emergency calls require a 2nd explicit confirm.     │             │
│  └──────────────────────────────────────────────────────┘             │
│      │ confirmed text                                                  │
│      ▼                                                                 │
│  Call Session Manager  ──WebRTC (react-native-webrtc)──┐              │
│      ▲            TTS (react-native-tts) → mic track    │              │
│      │  incoming transcript (data channel)              │              │
│      └────────────────────────────────────────────────┐│              │
└────────────────────────────────────────────────────────┼┼────────────┘
                                                          ││ WebRTC (SRTP + DTLS)
┌──────────────────────── BACKEND (bridge) ──────────────▼▼────────────┐
│  Signaling server (Node + ws)   ──   media server / SFU               │
│  Call Orchestrator:                                                    │
│    - Accept WebRTC leg from app                                        │
│    - Place PSTN call via Twilio Programmable Voice (or Asterisk)       │
│    - Pipe app audio (TTS) → PSTN callee                                │
│    - Pipe PSTN callee audio → STT (Google/Whisper) → text             │
│    - Push transcript to app over WebRTC data channel                   │
│  Emergency policy service (verified numbers, address handling)         │
└───────────────────────────────────────────────────────────────────────┘
```

**Data flow (pharmacy example):** sign → landmarks → classifier → "I need Metformin, one strip" → confirm → select pharmacy contact → start call → backend dials pharmacy → app plays intro TTS + the phrase → pharmacist speaks → backend STT → transcript on screen → user signs "Thank you, I'm coming" → confirm → TTS → call.

---

## Tech stack

| Concern | Choice | Package |
|---|---|---|
| App framework | React Native 0.74+ (bare) | `react-native` |
| Camera + frames | Frame processors | `react-native-vision-camera` |
| Landmarks | MediaPipe Hands/Holistic | `react-native-mediapipe` (or JSI plugin) |
| On-device inference | TFLite | `react-native-fast-tflite` |
| **LLM — cloud provider (built 1st)** | HTTP to OpenAI/Anthropic/Gemini or any OpenAI-compatible endpoint | `fetch` + `react-native-keychain` (API key storage) |
| **LLM — on-device provider (built 2nd, bonus)** | **llama.cpp for RN** | **`llama.rn`** + `Qwen2.5-1.5B-Instruct-Q4_K_M.gguf` (Gemma-2-2B / Llama-3.2-3B optional) |
| Real-time media | WebRTC | `react-native-webrtc` |
| TTS (outgoing) | Device TTS | `react-native-tts` |
| STT (incoming) | Server-side | Google Speech / faster-whisper on backend |
| State | Zustand | `zustand` |
| Backend | Node + TypeScript | `express`, `ws`, `twilio` |
| Media/telephony | Twilio Programmable Voice (MVP) → Asterisk (self-host later) | `twilio` |

> STT runs **server-side** in the bridge model because the callee's PSTN audio arrives at the backend; this is simpler and more accurate than on-device STT. On-device STT (`@react-native-voice`) is only needed if we later support the callee also being on-device.

---

## Repository layout

```
Mudra/
├─ app/                          # React Native app
│  ├─ src/
│  │  ├─ features/
│  │  │  ├─ signing/             # camera + recognition
│  │  │  │  ├─ SignCameraScreen.tsx
│  │  │  │  ├─ useSignRecognition.ts
│  │  │  │  ├─ landmarkFrameProcessor.ts
│  │  │  │  └─ classifier.ts        # → gloss tokens
│  │  │  ├─ llm/                     # LLM layer (provider-agnostic)
│  │  │  │  ├─ LlmProvider.ts        # interface: complete(system,user)
│  │  │  │  ├─ CloudLlmProvider.ts   # built 1st: OpenAI/Anthropic/Gemini
│  │  │  │  ├─ LocalLlmProvider.ts   # built 2nd: llama.rn (on-device)
│  │  │  │  ├─ llmClient.ts          # picks provider from settings
│  │  │  │  ├─ glossToText.ts        # gloss → fluent sentence
│  │  │  │  ├─ smartReplies.ts       # callee transcript → reply options
│  │  │  │  └─ prompts.ts            # system prompts + few-shot
│  │  │  ├─ settings/                # AI provider config
│  │  │  │  ├─ SettingsScreen.tsx    # provider/model/key + privacy note
│  │  │  │  └─ settingsStore.ts      # persisted; key in keychain
│  │  │  ├─ confirm/
│  │  │  │  └─ ConfirmPhraseScreen.tsx
│  │  │  ├─ call/
│  │  │  │  ├─ CallScreen.tsx
│  │  │  │  ├─ CallSessionManager.ts   # WebRTC + TTS + transcript
│  │  │  │  └─ signaling.ts
│  │  │  └─ emergency/
│  │  │     └─ EmergencyConfirmGate.tsx
│  │  ├─ data/
│  │  │  ├─ phrases.ts           # phrase set ↔ label map
│  │  │  └─ contacts.ts
│  │  ├─ store/callStore.ts
│  │  └─ App.tsx
│  ├─ assets/models/sign_asl.tflite
│  ├─ assets/models/qwen2.5-1.5b-instruct-q4_k_m.gguf   # local LLM weights
│  └─ android/ …
├─ backend/                      # bridge server
│  ├─ src/
│  │  ├─ server.ts               # express + ws signaling
│  │  ├─ orchestrator.ts         # WebRTC ↔ PSTN bridge
│  │  ├─ telephony/twilio.ts
│  │  ├─ stt/googleStt.ts
│  │  └─ policy/emergency.ts
│  └─ package.json
└─ ml/                           # training pipeline (run once, offline)
   ├─ prepare_asl_dataset.py
   ├─ extract_landmarks.py       # MediaPipe → npy sequences
   ├─ train_classifier.py        # Keras seq model → TFLite
   └─ phrases.json
```

---

## Module breakdown & key code

### 1. Sign recognition (on-device)

**Landmark frame processor** — vision-camera worklet runs MediaPipe per frame, emits normalized landmarks; JS keeps a sliding window and runs the classifier every N frames.

```ts
// features/signing/useSignRecognition.ts (shape)
const window: number[][] = [];        // ring buffer of landmark vectors
const WINDOW = 40;                    // frames per phrase inference

function onLandmarks(vec: number[]) {   // 2*21*3 hands + pose subset
  window.push(vec);
  if (window.length > WINDOW) window.shift();
  if (window.length === WINDOW) {
    const { phraseId, confidence } = classify(window);   // TFLite
    if (confidence > THRESHOLD) emitCandidate(phraseId, confidence);
  }
}
```

**Classifier** — `react-native-fast-tflite` loads `sign_asl.tflite`; input is the flattened landmark sequence, output is softmax over the phrase set. Map `argmax` → `phrases.ts`.

**Model (trained offline in `ml/`):** landmark sequences → a small **LSTM/1D-CNN** (or Transformer-lite) in Keras → export to TFLite (`int8` quantized for mobile). Two viable landmark sources: (a) the **Google/Kaggle asl-signs** dataset, which is *already* MediaPipe landmarks (no video-extraction step), or (b) our own **custom-recorded demo signs**, where MediaPipe Holistic extracts landmarks from a handful of self-recorded clips. This is the only piece requiring a one-time training run; everything else is open-source components wired together.

### 1a. Recognition strategy (ASL) — which phrase tier to train

There are three tiers of ASL recognition, trading realism against on-stage reliability. The vocabulary size is **not** where the demo's impact comes from — the "wow" is the **glosses → LLM → fluent sentence → confirm → call** pipeline. So we deliberately keep the recognition surface small and reliable, and let the LLM do the linguistic lifting.

- **Tier 1 — Fingerspelling (A–Z).** Rock-solid; existing TFLite weights exist, near-zero training. But spelling `M-E-T-F-O-R-M-I-N` letter by letter is slow and unimpressive on stage. **Role: safety-net fallback only.**
- **Tier 2 — Full word-level (WLASL ~2000 signs).** Matches the long-term vision, but live accuracy is shaky, and our actual demo words (*Metformin*, *ambulance*) aren't in its vocabulary anyway. **Role: not used for the MVP demo.**
- **Tier 3 — Small custom gloss set (CHOSEN for the demo).** Record ourselves signing the ~10–15 signs the two scripted flows need (pharmacy + emergency), 20–30 samples each, extract MediaPipe landmarks, train the small classifier. Because it's tuned to our signer and to the exact signs we'll perform, it's the most reliable option under stage conditions.

**Decision:** ship **Tier 3 as the real demo**, with **Tier 1 fingerspelling as a fallback** for any word the custom set doesn't cover. The **mock classifier (Phase 2) covers everything until the Tier-3 model is trained**, so this remains a Phase-8 task that never blocks the end-to-end demo.

**Reuse, don't rebuild:** fork a Kaggle *asl-signs* training repo (they already do landmark-sequence → TFLite) and retrain its head on our custom gloss set — this is fine-tuning an existing pipeline, not building one from scratch. Note licences and whether weights are included when picking the repo to fork.

### 1b. LLM layer (provider-agnostic — cloud first, on-device second)

Every AI feature calls a single interface. Two providers implement it; the Settings screen decides which is live. **Build order: `CloudLlmProvider` first** (quickest path to working AI), **`LocalLlmProvider` second** (the offline/free bonus). Feature code (`glossToText`, `smartReplies`) never changes between them.

```ts
// features/llm/LlmProvider.ts — the common interface
export interface LlmProvider {
  ready(): Promise<boolean>;
  complete(system: string, user: string, opts?: { maxTokens?: number }): Promise<string>;
}

// features/llm/llmClient.ts — resolves the active provider from settings
export function getLlm(): LlmProvider {
  return settings.aiProvider === 'local' ? localProvider : cloudProvider;
}
```

```ts
// features/llm/CloudLlmProvider.ts — BUILT FIRST
// OpenAI/Anthropic/Gemini or any OpenAI-compatible base URL.
export const cloudProvider: LlmProvider = {
  async ready() { return !!(await getApiKey()); },   // key from react-native-keychain
  async complete(system, user, opts) {
    const res = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json',
                 authorization: `Bearer ${await getApiKey()}` },
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.2, max_tokens: opts?.maxTokens ?? 64,
      }),
    });
    return (await res.json()).choices[0].message.content.trim();
  },
};
```

```ts
// features/llm/LocalLlmProvider.ts — BUILT SECOND (bonus, offline/free)
import { initLlama } from 'llama.rn';
let ctx;
export const localProvider: LlmProvider = {
  async ready() {
    if (!ctx) ctx = await initLlama({
      model: `${DocumentDir}/qwen2.5-1.5b-instruct-q4_k_m.gguf`,
      n_ctx: 1024, n_gpu_layers: 99,
    });
    return !!ctx;
  },
  async complete(system, user, opts) {
    const { text } = await ctx.completion({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.2, n_predict: opts?.maxTokens ?? 64, stop: ['\n\n'],
    });
    return text.trim();
  },
};
```

```ts
// features/llm/glossToText.ts — same for BOTH providers
export const glossToText = (gloss: string[]) => getLlm().complete(
  'You convert American Sign Language glosses into ONE natural, polite spoken English sentence. Output only the sentence.',
  `Glosses: ${gloss.join(' ')}`
);   // ["METFORMIN","ONE","STRIP","NEED"] -> "I need one strip of Metformin."

// features/llm/smartReplies.ts — callee transcript → 3 tappable replies
export const smartReplies = (context: string, lastTranscript: string) => getLlm().complete(
  'Suggest exactly 3 short replies the Deaf caller could send next. Return a JSON array of strings.',
  `Conversation so far: ${context}\nThey just said: "${lastTranscript}"`
);
```

**Settings screen** (`features/settings/`): pick provider (`cloud` | `local`), model name, base URL, and API key. Key is written to `react-native-keychain`, never to plain storage or logs. Enabling cloud shows a **privacy warning** (medical/emergency text leaves the device). Default ships as `local` once the on-device provider lands.

**Design guarantees:**
- LLM output is a *candidate* — it always flows into the confirmation gate; nothing is spoken until the user confirms. This is also the hallucination safeguard.
- For emergency phrases, the LLM only *structures* the message; the emergency number and address come from validated fields, never invented by the model.
- Fallback chain: if the active provider isn't `ready()` (no API key / cloud offline / low-RAM local load fail), fall back to the other provider, and finally to the raw classifier phrase so core calling always works.
- On-device model choice by RAM: Qwen2.5-1.5B (≥6 GB), Gemma-2-2B / Llama-3.2-3B (≥8 GB). iQOO flagships comfortably run the 1.5B at interactive speed.

### 2. Confirmation gate (safety-critical)

`ConfirmPhraseScreen` shows the recognized text large, with **Edit**, **Confirm**, **Discard**. For emergency phrases, `EmergencyConfirmGate` forces a **second** distinct confirmation and shows the exact number/address that will be dialed. No call is placed without a confirmed-text event in the store.

```ts
// store/callStore.ts (shape)
type CallState = 'idle'|'confirming'|'emergency_double_confirm'|'dialing'|'connected'|'ended';
// placeCall() asserts state === 'confirmed' && (!isEmergency || emergencyConfirmed)
```

### 3. Call session (WebRTC ↔ TTS ↔ transcript)

```ts
// features/call/CallSessionManager.ts (shape)
const pc = new RTCPeerConnection(config);
const localStream = ...;                    // synthetic audio track fed by TTS
pc.addTrack(localAudioTrack, localStream);
const dc = pc.createDataChannel('transcript');
dc.onmessage = e => store.pushTranscript(JSON.parse(e.data));  // callee text

async function speak(text: string) {
  await Tts.speak(text);                     // routed into the WebRTC audio track
}
// signaling.ts exchanges SDP/ICE with backend over ws
```

TTS-into-WebRTC: capture the device TTS output as the local audio track (Android `AudioRecord`/loopback via a small native module, or `react-native-tts` synth-to-file → play into a mixed track). This is the one native detail to nail during implementation; the plan reserves a spike for it.

### 4. Backend bridge

- **Signaling** (`ws`): SDP/ICE exchange with the app.
- **Orchestrator:** on `startCall`, create the app WebRTC leg, then place the PSTN call via **Twilio Programmable Voice** (TwiML `<Stream>` for media, or a SIP trunk). Bridge audio both directions.
- **STT:** callee PSTN audio → Google Speech-to-Text (streaming) → push interim + final transcripts to the app over the data channel.
- **Emergency policy** (`policy/emergency.ts`): allow-list of emergency numbers, structured address capture, audit log of every emergency call.

### 5. Phrase & contact data

`phrases.ts` maps classifier labels → display text + spoken text + category (`pharmacy | emergency | greeting | general`) + `isEmergency`. `contacts.ts` holds pharmacy/emergency numbers.

---

## Build phases

1. **Scaffold** — RN bare app + backend + `ml/` skeleton; wire navigation and `callStore`.
2. **Recognition pipeline** — vision-camera + MediaPipe landmarks + a **mock classifier** (returns canned **gloss tokens**) so the whole UX works before the model is trained. Build `SignCameraScreen`.
3. **LLM layer — cloud provider first.** Define the `LlmProvider` interface, build `CloudLlmProvider` (OpenAI/Anthropic/Gemini), the **Settings screen** (provider/model/base URL/API key → keychain), and `glossToText` + `smartReplies`. Testable immediately against mock glosses. Build `ConfirmPhraseScreen` on top of the LLM output. AI features work end-to-end here.
4. **Confirmation & emergency gates** — the safety-critical flows, fully testable with the mock classifier + cloud LLM.
5. **Call bridge (mockable)** — `CallSessionManager` + backend signaling + a **loopback/mock telephony** that echoes canned transcripts, so the call UX demos with no Twilio account. Wire `smartReplies` to the incoming transcript.
6. **On-device LLM provider (bonus).** Add `LocalLlmProvider` via `llama.rn` + the GGUF model, wire it into the Settings toggle, verify offline operation, make it the default. No feature-code changes — same interface as the cloud provider.
7. **Real telephony + STT** — plug in Twilio + Google STT behind the same interface.
8. **Train the ASL model** (`ml/`) — landmark sequences (Kaggle asl-signs, or custom-recorded demo signs) → TFLite; swap out the mock classifier. See **Recognition strategy** for which phrase tier to train.
9. **Accessibility & polish** — large-touch UI, haptics, high-contrast, no audio-dependent affordances.

Phases 2–5 are intentionally mockable so the app **demos end-to-end before** the trained model and the paid telephony backend exist. The **LLM is real from Phase 3 via the cloud provider**; the **on-device provider is swapped in at Phase 6** with zero changes to feature code, so it's a low-risk upgrade rather than a blocker.

---

## Verification

- **Recognition:** unit-test `classify()` with recorded landmark fixtures; on-device, sign each phrase 10× and check confidence/accuracy; verify the confirmation screen always shows before any action.
- **Emergency gate:** automated test asserting `placeCall(emergency)` is impossible without the double-confirm event; manual test that a misrecognized emergency sign never dials.
- **Call bridge:** run backend in mock mode, place a call from the app, confirm TTS is heard on the (mock) callee leg and canned transcripts render on screen. Then repeat against a real number via Twilio, calling your own second phone.
- **Full flow demo:** reproduce the deck's pharmacy scenario (sign → confirm → call → transcript → reply) and the emergency scenario end-to-end.
- **LLM layer:** unit-test `glossToText` against a fixture set of gloss→sentence pairs, running the **same tests against both providers** to prove interface parity. Cloud: verify Settings stores the key in keychain (not plain storage/logs) and the privacy warning shows before enabling. On-device: verify it runs **fully offline** (airplane mode) on the iQOO, measure tokens/sec and latency. Confirm the fallback chain (active provider not ready → other provider → raw classifier phrase).
- **Latency budget:** sign→gloss (<1s), gloss→sentence via local LLM (<1.5s on iQOO), text→spoken (<1s), callee-speech→transcript (<2s).

## Open items to decide during build
- MediaPipe RN binding: `react-native-mediapipe` community package vs a thin custom JSI plugin over MediaPipe Tasks (decide in Phase 2 based on stability).
- TTS→WebRTC audio-track capture on Android (the one native spike; fallback is a small Kotlin module using `AudioRecord`).
- Twilio vs self-hosted Asterisk for GA (Twilio for MVP speed; revisit for cost/data-residency).
- LLM weights delivery: bundle in the APK (bigger download, works offline day-1) vs first-run download to app storage (smaller APK). Decide in Phase 3 based on the ~1 GB model size.
- Exact on-device model per iQOO RAM tier (benchmark Qwen2.5-1.5B vs Gemma-2-2B for gloss→text quality/speed on the target device).
