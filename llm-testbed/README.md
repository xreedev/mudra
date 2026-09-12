# MUDRA+ · On-device LLM testbed

Standalone React Native app to prove the **on-device LLM** (PLAN.md Phase 6) runs
on the phone via [`llama.rn`](https://github.com/mybigday/llama.rn) (llama.cpp),
benchmark it, and eyeball the two real tasks — **gloss → sentence** and
**smart replies** — before integrating into the main app.

The LLM modules under `src/llm/` (`LlmProvider.ts`, `LocalLlmProvider.ts`,
`prompts.ts`, `features.ts`) are written to copy verbatim into
`app/src/features/llm/` later.

## 0. Prerequisites (already verified on this machine)

- Node 22, JDK 21, Android SDK + `adb` on PATH.
- Phone with **USB debugging** enabled and authorized (`adb devices` lists it,
  not `unauthorized`). Screen mirroring alone is **not** enough.

## 1. Pick + fetch a model (top model the phone can run)

Choose by the phone's RAM (`adb shell cat /proc/meminfo | head -1`):

| Device RAM | Recommended GGUF (Q4_K_M) | Approx size | Notes |
|---|---|---|---|
| 6 GB | Qwen2.5-1.5B-Instruct | ~1.1 GB | PLAN.md default; snappy |
| 8 GB | Qwen2.5-3B-Instruct / Llama-3.2-3B-Instruct | ~2.0 GB | better sentences |
| 12 GB | Qwen2.5-7B-Instruct | ~4.7 GB | best quality, still interactive |
| 16 GB+ | Qwen2.5-7B (Q5_K_M) | ~5.4 GB | headroom to spare |

Download the `.gguf` on the laptop (e.g. from `bartowski/Qwen2.5-*-Instruct-GGUF`
or `Qwen/Qwen2.5-*-Instruct-GGUF` on Hugging Face) into `models/` here.

## 2. Push the model to the phone

The app reads from its own external files dir (no storage permission needed).
`adb push` writes there directly:

```bash
adb shell mkdir -p /sdcard/Android/data/com.llmtestbed/files/models
adb push models/<your-model>.gguf /sdcard/Android/data/com.llmtestbed/files/models/
```

> The app must be installed once first (step 3) so its data dir exists.

## 3. Build + run on the phone

```bash
npm install            # once
npx react-native run-android
```

Leave Metro running. On the phone: **Rescan models → Load → Run gloss→text suite**.

## 4. What to check (PLAN.md verification)

- **Runs fully offline** — put the phone in airplane mode; suites still work.
- **Latency budget** — gloss→sentence end-to-end **< 1.5 s** on device
  (shown per case with ✓ / ✗, plus tokens/sec and first-token time).
- **Quality** — sentences are natural, first-person, and never invent a drug
  name / number / address not present in the glosses.
- **Load time + tok/s** — reported on load and per run, to compare model sizes.

## Layout

```
src/llm/
  LlmProvider.ts        # shared interface (copies into the app)
  LocalLlmProvider.ts   # llama.rn wrapper + benchmark stats
  prompts.ts            # system prompts + few-shot
  features.ts           # glossToText, smartReplies (provider-agnostic)
  testCases.ts          # pharmacy + emergency fixtures
App.tsx                 # the test harness UI
```
