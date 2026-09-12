import type { MemoryConfig } from './config';
import type { RejectReason } from './types';

export type NormalizeResult =
  | { ok: true; tokens: string[] }
  | { ok: false; reason: RejectReason; detail: string };

/** Cheap pre-filter so a pathological raw token is rejected before any work is done. */
const RAW_LENGTH_SLACK = 4;

/** Characters kept in a gloss: any letter or digit, plus the few marks glosses actually use. */
const DROPPED = /[^\p{L}\p{N}_'+-]/gu;
const WHITESPACE_RUN = /\s+/g;

/**
 * Turns whatever the sign classifier emits into the canonical gloss form every index uses.
 *
 * Rules (deliberately boring — the same input must always produce the same key):
 *  - `null`, `undefined`, non-string and blank entries are dropped, never thrown
 *    (the recognizer is allowed to be messy);
 *  - trimmed and upper-cased with `toUpperCase`, **not** `toLocaleUpperCase`: the device locale
 *    must not change the key (Turkish `i` would otherwise split one gloss into two);
 *  - internal whitespace collapses to `_`, so `"thank you"` and `"THANK_YOU"` share a key;
 *  - anything that is not a letter, digit, `_`, `'`, `-` or `+` is dropped (stray punctuation
 *    from a fingerspelling fallback, emoji, control characters).
 */
export function normalizeTokens(
  raw: readonly (string | null | undefined)[] | null | undefined,
  config: MemoryConfig,
): NormalizeResult {
  if (raw == null || raw.length === 0) {
    return { ok: false, reason: 'empty-tokens', detail: 'no tokens supplied' };
  }
  if (raw.length > config.maxTokens) {
    return {
      ok: false,
      reason: 'too-many-tokens',
      detail: `${raw.length} tokens supplied, max is ${config.maxTokens}`,
    };
  }

  const tokens: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    if (entry.length > config.maxTokenLength * RAW_LENGTH_SLACK) {
      return {
        ok: false,
        reason: 'token-too-long',
        detail: `raw token of ${entry.length} characters exceeds the limit`,
      };
    }
    const token = normalizeToken(entry);
    if (token === null) continue;
    if (token.length > config.maxTokenLength) {
      return {
        ok: false,
        reason: 'token-too-long',
        detail: `token '${token.slice(0, 16)}...' is ${token.length} characters, max is ${config.maxTokenLength}`,
      };
    }
    tokens.push(token);
  }

  if (tokens.length === 0) {
    return { ok: false, reason: 'empty-tokens', detail: 'nothing survived normalization' };
  }
  return { ok: true, tokens };
}

/** Normalizes one token; returns `null` when nothing meaningful is left. */
export function normalizeToken(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const token = trimmed.replace(WHITESPACE_RUN, '_').replace(DROPPED, '').toUpperCase();
  return token.length === 0 ? null : token;
}

/** Debug/display key for a sequence, e.g. `ME|TEA|HOT`. */
export function sequenceKey(tokens: readonly string[]): string {
  return tokens.join('|');
}
