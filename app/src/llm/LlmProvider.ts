/**
 * The provider-agnostic LLM interface (MUDRA+ PLAN.md §1b).
 *
 * Both the cloud provider and the on-device provider implement this exact
 * shape, so feature code (glossToText, smartReplies) never changes when the
 * active provider is swapped in Settings. This file is written to be copied
 * verbatim into `app/src/features/llm/LlmProvider.ts`.
 */
export interface LlmProvider {
  /** True when the provider can serve a completion right now. */
  ready(): Promise<boolean>;
  /** Single-turn completion: a system prompt + a user message → text. */
  complete(
    system: string,
    user: string,
    opts?: { maxTokens?: number; temperature?: number },
  ): Promise<string>;
}

/** Optional richer result used by the testbed to surface benchmark numbers. */
export interface CompletionStats {
  text: string;
  tokensPredicted: number;
  tokensPerSecond: number;
  promptTokensPerSecond: number;
  msToFirstToken: number;
  totalMs: number;
}
