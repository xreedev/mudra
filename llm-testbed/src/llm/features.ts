/**
 * The two MUDRA+ LLM features, provider-agnostic. In the real app these live
 * as glossToText.ts and smartReplies.ts and call getLlm() from llmClient.ts.
 * Here they take an LlmProvider so the testbed can point them at localProvider.
 */
import type { LlmProvider } from './LlmProvider';
import {
  GLOSS_TO_TEXT_SYSTEM,
  GLOSS_TO_TEXT_FEWSHOT,
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

/** ["METFORMIN","ONE","STRIP","NEED"] → "I need one strip of Metformin." */
export async function glossToText(llm: LlmProvider, gloss: string[]): Promise<string> {
  return llm.complete(glossSystemWithFewShot(), buildGlossUserPrompt(gloss), {
    maxTokens: 48,
    temperature: 0.2,
  });
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

export function parseReplies(raw: string): string[] {
  // 1) Ideal case: a single clean JSON array anywhere in the output.
  const match = raw.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const arr = JSON.parse(match[0]);
      if (Array.isArray(arr)) {
        const out = arr.map((x) => String(x).trim()).filter(Boolean);
        if (out.length) return out.slice(0, 3);
      }
    } catch {
      // fall through
    }
  }
  // 2) Small models often emit several arrays or code fences, e.g.
  //    ["a"]["b"]["c"]  — not valid JSON. Pull out every quoted string.
  const quoted = [...raw.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim());
  if (quoted.length) return quoted.slice(0, 3);
  // 3) Last resort: line-based recovery.
  return raw
    .split('\n')
    .map((l) => l.replace(/^[\s\-*\d.)[\]"']+/, '').replace(/["'\],]+$/, '').trim())
    .filter(Boolean)
    .slice(0, 3);
}
