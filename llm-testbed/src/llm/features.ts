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
