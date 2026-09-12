# On-device LLM — integration notes

This doc is for whoever wires the on-device LLM into the main app
(`PLAN.md` Phase 3 build-out + Phase 6 `LocalLlmProvider`). It explains what
was built here, why, and exactly how to port it. It assumes you've read
`PLAN.md` and `TRAINING.md`.

## TL;DR

- Everything under `llm-testbed/src/llm/` is written to be **copied verbatim**
  into `app/src/features/llm/`. No interface changes needed — it already
  implements the `LlmProvider` shape from `PLAN.md` §1b.
- Chosen model: **Qwen2.5-7B-Instruct, Q4_K_M quantization** (~4.7GB), run via
  `llama.rn` v0.12.9, **CPU-only**.
- Measured on a vivo iQOO I2501 (SM8850, 16GB RAM): **avg 850ms per
  gloss→sentence call, 12.1–12.5 tok/s**, all 6 scripted pharmacy/emergency/
  greeting test cases clear the `PLAN.md` <1.5s latency budget.
- GPU/NPU offload was investigated and is **intentionally disabled** — see
  "Why no GPU" below before re-attempting it.

## Files to port

| File | Copies to | Notes |
|---|---|---|
| `src/llm/LlmProvider.ts` | `app/src/features/llm/LlmProvider.ts` | The shared interface. Copy as-is. |
| `src/llm/LocalLlmProvider.ts` | `app/src/features/llm/LocalLlmProvider.ts` | llama.rn wrapper. Copy as-is; see "Load config" below for the tuned params to keep. |
| `src/llm/prompts.ts` | `app/src/features/llm/prompts.ts` | System prompts + few-shot. Copy as-is. |
| `src/llm/features.ts` | `app/src/features/llm/glossToText.ts` + `smartReplies.ts` | Currently one file for testbed convenience; split per `PLAN.md`'s repo layout when integrating (see "Conversation memory" below for what stays where). |
| `src/llm/testCases.ts` | test fixtures | Useful as unit-test fixtures for `PLAN.md`'s verification step ("unit-test glossToText against a fixture set"). |

`CloudLlmProvider.ts` and `llmClient.ts` (the provider switch) don't exist yet
— they're Phase 3 scope, not built here. This testbed only proves the
`LocalLlmProvider` half of the interface.

## Model & load configuration (copy these exact values)

```ts
const res = await load({
  modelPath: path,       // wherever the GGUF ends up on-device — see below
  nCtx: 1024,
  nGpuLayers: 0,          // see "Why no GPU"
  nThreads: 6,            // device has 8 cores; llama.rn's own default (4) left speed on the table
  nThreadsBatch: 8,
  nBatch: 512,
  flashAttn: 'auto',
});
await warmup(glossSystemWithFewShot());   // ALWAYS call this once, right after load
```

**Do not skip `warmup()`.** Without it, the *first* real inference after
load pays a ~4–6s one-time cost (llama.cpp building its compute graph +
first prompt eval). Calling `warmup()` with the same long system-prompt
shape used by real calls moves that cost into the loading screen, where
it's expected, instead of the user's first sign.

## Model delivery — decide this before shipping

The testbed pushes the GGUF via `adb push` for fast iteration. The real app
needs one of the two options `PLAN.md` already flags as an open item:
- **Bundle in the APK** (~4.7GB — big download, works offline day 1), or
- **First-run download** to app storage (smaller APK, needs connectivity once).

Either way, **do not use `adb shell mkdir` to create the models directory** —
see the storage gotcha below.

## Why no GPU (read before re-attempting)

We tried enabling GPU offload and reverted it. Full story, for whoever
revisits this:

1. `llama.rn`'s only GPU-capable Android library for this build
   (`librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so`) bundles **Adreno OpenCL
   together with Hexagon NPU support in one file** — there is no OpenCL-only
   variant shipped.
2. Loading that file requires two `<uses-native-library>` manifest
   declarations: `libOpenCL.so` **and** `libcdsprpc.so` (confirmed via
   `llvm-readelf -d` — the file hard-depends on both; without `libcdsprpc.so`
   declared, Android refuses to even `dlopen` it, and it just look like GPU
   isn't available).
3. With both declared, the file *does* load, and it *does* attempt real
   Hexagon DSP access (confirmed via logcat — it opens a genuine FastRPC
   session to the DSP). But the DSP refuses it:
   `remote_session_control failed ... user err 0x73` — Qualcomm's DSP
   requires the calling code to run in a **signed process domain**, and our
   app isn't (and can't be, on a retail/locked device — this requires either
   an OEM-signed system app, or a Qualcomm "testsig" tied to an *unlocked*
   device, which retail phones don't have).
4. That NPU refusal throws a **non-`std::exception`** across the JSI
   boundary, which gets reported as a generic, undebuggable `"Unknown
   error"` — and it kills the *entire* context load, GPU included, since
   llama.cpp registers all backends unconditionally at startup. Once that
   broken library is loaded into the process, **every subsequent load
   attempt in that same process fails identically**, even with
   `n_gpu_layers: 0` — you need a full app restart to recover.
5. **GPU itself (Adreno/OpenCL) has no such signing requirement** — this is
   purely a packaging problem in the prebuilt library, not a hardware or
   security limitation on the GPU. If GPU speed becomes a real requirement
   later, two real paths exist:
   - Build `llama.cpp`'s Android library from source with Hexagon compiled
     out, OpenCL compiled in (a CMake flag) — real work, ~half a day.
   - Try **MediaPipe's own LLM Inference API** instead of `llama.cpp` — its
     GPU path goes through OpenGL/Vulkan compute shaders via a
     Google-signed delegate, not raw FastRPC, so it likely sidesteps this
     exact wall. Also a clean architectural fit since `PLAN.md` already uses
     MediaPipe for hand-landmark tracking.
   - Neither is needed right now: **CPU-only already clears the 1.5s
     budget** with real margin (850ms avg).

If you do touch the manifest to try GPU again, the comment block in
`android/app/src/main/AndroidManifest.xml` documents exactly what was tried.

## Conversation memory (for `smartReplies` / `CallSessionManager`)

`smartReplies(llm, context, lastTranscript)` takes a plain `context: string`
— that's unchanged and matches `PLAN.md`'s original signature. What's new is
`appendTurn()` / `buildRecentContext()` in `features.ts`, which **produce**
that context string from an actual call history:

```ts
export interface ConversationTurn {
  speaker: 'caller' | 'callee';
  text: string;
  ts: number;
}
```

**Two layers, deliberately separate:**
1. **The full turn log** — every confirmed caller sentence + every callee
   transcript line, for the whole call. This should live in `callStore.ts`
   (Zustand), not in the LLM layer. It can also double as the source data
   for `PLAN.md`'s emergency-call audit log — don't build that log twice.
2. **The bounded context fed to the LLM** — `buildRecentContext(turns, {
   maxTurns: 6, maxChars: 500 })` takes the tail of that log and formats it
   as `Caller: …` / `Callee: …` lines, trimmed to fit the 1024-token context
   window alongside the system prompt.

**No explicit topic-change detection was built, on purpose.** For the short,
linear pharmacy/emergency flows this app targets, a recency window handles
drift on its own — stale turns simply age out of the last-6 window. And per
`PLAN.md`'s own design guarantee, every LLM output (including smart replies)
already passes through user confirmation before anything is spoken, so
imperfect context doesn't need to be perfect — it needs to not block the
user from correcting it. If real multi-topic, long-running calls become a
requirement later, the next step up is LLM-generated summarization of older
turns once the log passes some length — treat that as a stretch goal, not
a blocker.

Wire it into `CallSessionManager.ts` roughly like:
```ts
// on confirmed caller sentence:
callStore.turns = appendTurn(callStore.turns, 'caller', confirmedText);
// on incoming callee transcript (data channel):
callStore.turns = appendTurn(callStore.turns, 'callee', transcriptText);
// when generating suggestions:
const context = buildRecentContext(callStore.turns);
const replies = await smartReplies(getLlm(), context, lastTranscript);
```

## Storage gotcha (if you hit "readDir NPE" or "stat permission denied")

**Never create the model's directory with `adb shell mkdir`.** A directory
created by `adb`/`shell` inside `Android/data/<pkg>/files/...` is not
recognized as belonging to the app by Android's storage layer, even though
`ls -la` shows plausible-looking permissions — the app's own process can't
`stat()` or `readDir()` it (confirmed: both fail, one with a native NPE
inside `react-native-fs`, an unrelated but easy-to-hit library bug). Fix:
have the **app itself** create the directory (`RNFS.mkdir(...)`), then push
files into it. This only matters if you build a bundled/downloaded-model
flow that creates its own directories — irrelevant if the GGUF ships
inside the APK's assets.

## GPU/CPU/RAM live monitoring

`scripts/monitor.sh` reads GPU busy % (`/sys/class/kgsl/kgsl-3d0/gpubusy`),
CPU %, and RSS (`top -b -n1 -p <pid>`) once per second — no root needed.
Useful during integration to check the LLM inference burst doesn't fight
the camera/MediaPipe recognition loop for CPU. Run via
`adb shell < scripts/monitor.sh` (git-bash; PowerShell needs
`Get-Content scripts/monitor.sh | adb shell` instead, since PowerShell
doesn't support `<`).

**Recommendation for `CallSessionManager`:** gate/pause the camera frame
processor while the LLM is generating (≤2s bursts) — nothing needs
recognizing during that window anyway, and it avoids any CPU contention
between MediaPipe and the 6 threads `llama.rn` uses. Not required by
today's numbers (llama.rn already limits itself to 6 of 8 cores), but cheap
insurance against thermal throttling over a longer demo call.

## React Native native modules — a note for the TTS→WebRTC spike

`PLAN.md` flags the TTS-into-WebRTC audio track as "the one native detail
to nail" and reserves a spike for it. Confirmed during this work: **this is
not an RN limitation** — bare RN (what this project uses, not Expo Go)
supports writing real Kotlin/Swift native modules exactly for cases like
this, the same pattern `llama.rn` and `react-native-tts` themselves use.
The module only needs to cross the JS↔native bridge for control calls
(`startCapture()`/`stopCapture()`); the actual audio streaming loop runs
entirely in native code (`AudioPlaybackCapture` → WebRTC's native audio
pipeline), so there's no framework-level performance concern either.

## What's NOT done here (Phase 3/6 remaining scope)

- `CloudLlmProvider.ts` (OpenAI/Anthropic/Gemini) — not built.
- `llmClient.ts` provider switch + Settings screen — not built.
- Wiring `glossToText`/`smartReplies` into real `ConfirmPhraseScreen`/
  `CallSessionManager` — not built (this repo only proves the LLM layer in
  isolation).
- Fallback chain (provider not ready → other provider → raw classifier
  phrase) — not built; `LocalLlmProvider.ready()` exists and works, just
  isn't wired to a fallback yet.
