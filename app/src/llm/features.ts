/**
 * The two MUDRA+ LLM features, provider-agnostic — each takes an LlmProvider
 * so callers can pass LocalLlmProvider (see ../LocalLlmProvider.ts, kept out
 * of index.ts's barrel since it needs llama.rn), or later a CloudLlmProvider
 * once Phase 3's provider-switch (llmClient.ts / Settings screen) exists.
 */
import type { LlmProvider } from './LlmProvider';
import {
  GLOSS_TO_TEXT_SYSTEM,
  GLOSS_TO_TEXT_FEWSHOT,
  GLOSS_TO_TEXT_OPTIONS_SYSTEM,
  GLOSS_TO_TEXT_OPTIONS_FEWSHOT,
  SMART_REPLIES_SYSTEM,
  buildGlossUserPrompt,
  buildSmartRepliesUserPrompt,
} from './prompts';

/** Fold the few-shot pairs into the system prompt (keeps complete() generic). */
export function glossSystemWithFewShot(): string {
  const shots = GLOSS_TO_TEXT_FEWSHOT.map(
    (s) => `Glosses: ${s.gloss}\n${s.text}`,
  ).join('\n');
  return `${GLOSS_TO_TEXT_SYSTEM}\n\nExamples:\n${shots}`;
}

/** Same folding, for the 2-candidate-options prompt. */
export function glossOptionsSystemWithFewShot(): string {
  const shots = GLOSS_TO_TEXT_OPTIONS_FEWSHOT.map(
    (s) => `Glosses: ${s.gloss}\n${JSON.stringify(s.options)}`,
  ).join('\n');
  return `${GLOSS_TO_TEXT_OPTIONS_SYSTEM}\n\nExamples:\n${shots}`;
}

/** ["METFORMIN","ONE","STRIP","NEED"] → "I need one strip of Metformin." */
export async function glossToText(llm: LlmProvider, gloss: string[]): Promise<string> {
  return llm.complete(glossSystemWithFewShot(), buildGlossUserPrompt(gloss), {
    maxTokens: 48,
    temperature: 0.2,
  });
}

/**
 * ["ARRIVED","HOME","RIGHT","LEFT"] -> 2 different candidate sentences,
 * covering different plausible readings of who is signing (the customer or
 * the driver) — see GLOSS_TO_TEXT_OPTIONS_SYSTEM for why a single guess
 * isn't good enough here. Higher temperature than glossToText (0.2 -> 0.6)
 * specifically to encourage the 2 options to genuinely diverge rather than
 * be near-identical rewordings; falls back to parseReplies' same tolerant
 * JSON-array recovery already proven on-device for smartReplies.
 */
export async function glossToTextOptions(llm: LlmProvider, gloss: string[]): Promise<string[]> {
  const raw = await llm.complete(glossOptionsSystemWithFewShot(), buildGlossUserPrompt(gloss), {
    maxTokens: 150,
    temperature: 0.6,
  });
  return parseReplies(raw, 2);
}

/** Word-for-word equal, ignoring surrounding whitespace and case — the same
 *  tolerant match `withRememberedSentence` dedupes with, exported so a UI
 *  can also ask "is this displayed option the remembered one?" (e.g. to
 *  show a "from memory" tag) without duplicating the comparison. */
export function isSameSentence(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Combines a remembered sentence (the user's past pick for this exact sign
 * sequence, see sentenceMemory.ts) with fresh LLM candidates: the remembered
 * one always leads, and any LLM option that's word-for-word the same
 * (trimmed, case-insensitive) is dropped rather than shown twice.
 */
export function withRememberedSentence(
  remembered: string | undefined,
  llmOptions: readonly string[],
): string[] {
  if (!remembered) return [...llmOptions];
  const rest = llmOptions.filter((option) => !isSameSentence(option, remembered));
  return [remembered, ...rest];
}

/** callee transcript → up to 3 short reply options. Tolerant JSON parsing. */
export async function smartReplies(
  llm: LlmProvider,
  context: string,
  lastTranscript: string,
): Promise<string[]> {
  const raw = await llm.complete(
    SMART_REPLIES_SYSTEM,
    buildSmartRepliesUserPrompt(context, lastTranscript),
    // 3 short replies rarely need more than ~50 tokens; cap tighter than 96
    // so we're not paying generation time for tokens we'd discard anyway.
    { maxTokens: 60, temperature: 0.4 },
  );
  return parseReplies(raw);
}

// ─────────────────────────────────────────────────────────────────────────
// Conversation memory — a rolling window over the call's turn history.
//
// Two layers, kept deliberately separate:
//   1. The FULL turn log — every confirmed caller sentence + every callee
//      transcript line, for the whole call. Owned by the app's call state
//      (Zustand `callStore.ts` in the real app), not by this module. It can
//      also double as the source for PLAN.md's emergency-call audit log.
//   2. The BOUNDED context fed to the LLM each time — a recency window of
//      the full log, kept small so it fits in our 1024-token n_ctx budget
//      alongside the system prompt. `buildRecentContext` is that mapping.
//
// No explicit "topic changed" detection: for the short, linear pharmacy/
// emergency flows this app targets, a recency window handles drift on its
// own (stale turns simply age out), and the confirmation gate already
// catches any suggestion built from stale context before it's ever spoken.
// ─────────────────────────────────────────────────────────────────────────

export interface ConversationTurn {
  speaker: 'caller' | 'callee';
  text: string;
  /** ms since epoch — not used for windowing, kept for audit-log parity. */
  ts: number;
}

/** Pure append — returns a new array, ready for a Zustand-style setState. */
export function appendTurn(
  turns: ConversationTurn[],
  speaker: ConversationTurn['speaker'],
  text: string,
): ConversationTurn[] {
  return [...turns, { speaker, text, ts: Date.now() }];
}

export interface ContextBuildOptions {
  /** How many of the most recent turns to consider. Default 6. */
  maxTurns?: number;
  /** Hard character cap as a cheap proxy for a token budget (~4 chars/token),
   *  so one unusually long transcript line can't blow the prompt's context
   *  window. Default 500 chars (~125 tokens). */
  maxChars?: number;
}

/**
 * Turns the tail of the full turn log into the short "context" string
 * smartReplies() expects — the LLM-facing feature signature itself is
 * unchanged; this is what PRODUCES its `context` argument in the real app.
 */
export function buildRecentContext(
  turns: ConversationTurn[],
  opts?: ContextBuildOptions,
): string {
  const maxTurns = opts?.maxTurns ?? 6;
  const maxChars = opts?.maxChars ?? 500;

  const window = turns.slice(-maxTurns);
  const lines = window.map(
    (t) => `${t.speaker === 'caller' ? 'Caller' : 'Callee'}: ${t.text}`,
  );

  // Trim from the oldest end of the window until under the char budget,
  // rather than truncating mid-line — an incomplete line is worse than one
  // fewer turn of history.
  while (lines.join('\n').length > maxChars && lines.length > 1) {
    lines.shift();
  }
  return lines.join('\n');
}

/** @param limit Max entries to return — 3 for smartReplies, 2 for glossToTextOptions. */
export function parseReplies(raw: string, limit = 3): string[] {
  // 1) Ideal case: a single clean JSON array anywhere in the output.
  const match = raw.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const arr = JSON.parse(match[0]);
      if (Array.isArray(arr)) {
        const out = arr.map((x) => String(x).trim()).filter(Boolean);
        if (out.length) return out.slice(0, limit);
      }
    } catch {
      // fall through
    }
  }
  // 2) Small models often emit several arrays or code fences, e.g.
  //    ["a"]["b"]["c"]  — not valid JSON. Pull out every quoted string.
  const quoted = [...raw.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim());
  if (quoted.length) return quoted.slice(0, limit);
  // 3) Last resort: line-based recovery.
  return raw
    .split('\n')
    .map((l) => l.replace(/^[\s\-*\d.)[\]"']+/, '').replace(/["'\],]+$/, '').trim())
    .filter(Boolean)
    .slice(0, limit);
}
