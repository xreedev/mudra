/**
 * On-device LLM provider (MUDRA+ PLAN.md Phase 6) backed by llama.rn (llama.cpp).
 *
 * Loads a quantized GGUF from device storage and runs fully offline. Implements
 * the shared LlmProvider interface so it drops into the main app unchanged. The
 * extra load()/completeWithStats()/unload() surface is used by the testbed to
 * pick a model and read benchmark numbers; the app only needs ready()+complete().
 */
import { initLlama, releaseAllLlama, type LlamaContext } from 'llama.rn';
import type { CompletionStats, LlmProvider } from './LlmProvider';

let ctx: LlamaContext | null = null;
let loadedModelPath: string | null = null;
let loadMs = 0;

export interface LoadParams {
  modelPath: string;
  /** Context window. 1024 is plenty for gloss→sentence + short replies. */
  nCtx?: number;
  /** Layers offloaded to GPU. 99 = all; 0 = force CPU. */
  nGpuLayers?: number;
  /** Threads for token generation. Device has 8 cores; llama.rn's own
   *  default picked only 4 — bump this to use more of the SoC. */
  nThreads?: number;
  /** Threads for prompt (batch) processing — can usually go higher than
   *  generation threads since it's more parallelizable. */
  nThreadsBatch?: number;
  /** Prompt batch size — larger can speed up first-token latency on longer
   *  prompts (e.g. our few-shot system prompt) at the cost of more RAM. */
  nBatch?: number;
  /** Flash attention: 'auto' (default), 'on' to force, 'off' to disable. */
  flashAttn?: 'auto' | 'on' | 'off';
}

export interface LoadResult {
  ok: boolean;
  loadMs: number;
  error?: string;
  gpu?: boolean;
  /** When gpu is false, llama.rn's explanation for the CPU fallback. */
  reasonNoGPU?: string;
}

/** Load (or reload) a GGUF model. Safe to call again with a different path. */
export async function load(params: LoadParams): Promise<LoadResult> {
  try {
    if (ctx) {
      await ctx.release();
      ctx = null;
      loadedModelPath = null;
    }
    const t0 = Date.now();
    ctx = await initLlama({
      model: params.modelPath,
      n_ctx: params.nCtx ?? 1024,
      n_gpu_layers: params.nGpuLayers ?? 99,
      n_threads: params.nThreads,
      n_threads_batch: params.nThreadsBatch ?? params.nThreads,
      n_batch: params.nBatch,
      flash_attn_type: params.flashAttn ?? 'auto',
    });
    loadMs = Date.now() - t0;
    loadedModelPath = params.modelPath;
    const gpu = (ctx as any)?.gpu ?? undefined;
    const reasonNoGPU = (ctx as any)?.reasonNoGPU || undefined;
    return { ok: true, loadMs, gpu, reasonNoGPU };
  } catch (e: any) {
    ctx = null;
    loadedModelPath = null;
    // "Unknown error" from e.message alone hides the real native reason —
    // dump every own-enumerable field (code, userInfo, nativeStackAndroid, …).
    let detail = '';
    try {
      const extra: Record<string, unknown> = {};
      for (const k of Object.getOwnPropertyNames(e || {})) {
        if (k !== 'stack') extra[k] = (e as any)[k];
      }
      detail = JSON.stringify(extra);
    } catch {
      detail = '(could not serialize error)';
    }
    return { ok: false, loadMs: 0, error: `${String(e?.message ?? e)} | raw=${detail}` };
  }
}

export function currentModelPath(): string | null {
  return loadedModelPath;
}

/**
 * Run one throwaway completion so llama.cpp builds its compute graph and
 * primes the prompt-processing path, instead of paying that cost on the
 * user's first real sign (~6s first-token otherwise). Call once after load().
 *
 * Uses the SAME system prompt shape (long system + few-shot) as the real
 * gloss→text feature — a short generic prompt only warms up a short-prompt
 * code path and leaves the long-prompt cold start to hit on the first real
 * case anyway (this is what happened before this fix).
 */
export async function warmup(system?: string): Promise<number> {
  if (!ctx) throw new Error('LocalLlmProvider: no model loaded');
  const t0 = Date.now();
  await ctx.completion({
    messages: [
      { role: 'system', content: system ?? 'You are a helpful assistant.' },
      { role: 'user', content: 'Glosses: HELLO' },
    ],
    n_predict: 4,
    temperature: 0,
  });
  return Date.now() - t0;
}

export async function unload(): Promise<void> {
  if (ctx) await ctx.release();
  ctx = null;
  loadedModelPath = null;
  await releaseAllLlama();
}

/** Full completion with benchmark stats. complete() below wraps this. */
export async function completeWithStats(
  system: string,
  user: string,
  opts?: { maxTokens?: number; temperature?: number },
): Promise<CompletionStats> {
  if (!ctx) throw new Error('LocalLlmProvider: no model loaded');
  const start = Date.now();
  let firstTokenAt = 0;

  const res = await ctx.completion(
    {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      n_predict: opts?.maxTokens ?? 96,
      temperature: opts?.temperature ?? 0.2,
      stop: ['<|im_end|>', '</s>', '\n\n\n'],
    },
    (data: { token: string }) => {
      if (firstTokenAt === 0 && data?.token) firstTokenAt = Date.now();
    },
  );

  const totalMs = Date.now() - start;
  const timings: any = (res as any).timings ?? {};
  return {
    text: (res.text ?? '').trim(),
    tokensPredicted: timings.predicted_n ?? 0,
    tokensPerSecond: Math.round((timings.predicted_per_second ?? 0) * 10) / 10,
    promptTokensPerSecond: Math.round((timings.prompt_per_second ?? 0) * 10) / 10,
    msToFirstToken: firstTokenAt ? firstTokenAt - start : 0,
    totalMs,
  };
}

export const localProvider: LlmProvider = {
  async ready() {
    return ctx !== null;
  },
  async complete(system, user, opts) {
    const { text } = await completeWithStats(system, user, opts);
    return text;
  },
};
