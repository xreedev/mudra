import { cosineSimilarity } from './similarity';
import type {
  BaseClassifierResult,
  CollisionWarning,
  EmbeddingVector,
  RecognitionResult,
  SignPrototype,
} from './types';

export interface MatchOptions {
  /** Minimum similarity to consider a custom prototype a match at all. */
  threshold: number;
  /** Best match must beat the runner-up by at least this much (not just
   *  clear the threshold) — rejects ambiguous "two prototypes look almost
   *  equally close" cases instead of guessing. Default 0.05. */
  minMargin?: number;
}

/** Nearest-neighbor lookup over stored custom prototypes, with a margin
 *  check so near-ties are reported as "no confident match" rather than an
 *  arbitrary pick. */
export function findBestMatch(
  liveVector: EmbeddingVector,
  prototypes: SignPrototype[],
  opts: MatchOptions,
): { prototype: SignPrototype; similarity: number } | null {
  if (prototypes.length === 0) return null;

  const scored = prototypes
    .map((p) => ({ prototype: p, similarity: cosineSimilarity(liveVector, p.vector) }))
    .sort((a, b) => b.similarity - a.similarity);

  const best = scored[0];
  if (best.similarity < opts.threshold) return null;

  const runnerUp = scored[1];
  const margin = opts.minMargin ?? 0.05;
  if (runnerUp && best.similarity - runnerUp.similarity < margin) {
    return null; // too close to call — treat as no confident match
  }

  return best;
}

export interface DecideRecognitionOptions {
  /** The base (fixed-vocabulary) classifier's confidence at/above which it
   *  is trusted outright — the custom-sign matcher is not even consulted.
   *  This is the actual fix for "won't the embedding catch it first": the
   *  base classifier only gets overridden when IT is unsure. */
  baseConfidenceThreshold: number;
  custom: MatchOptions;
}

/**
 * The per-window recognition decision, combining both models:
 *   base confident?  -> trust it, custom matcher is never consulted
 *   base unsure?      -> check custom prototypes (this is where a genuinely
 *                        novel, user-taught sign gets its chance)
 *   neither confident -> unknown (caller should treat like IDLE: re-sign,
 *                        never guess)
 */
export function decideRecognition(
  base: BaseClassifierResult,
  liveVector: EmbeddingVector,
  customPrototypes: SignPrototype[],
  opts: DecideRecognitionOptions,
): RecognitionResult {
  if (base.confidence >= opts.baseConfidenceThreshold) {
    return { kind: 'base', label: base.label, confidence: base.confidence };
  }

  const match = findBestMatch(liveVector, customPrototypes, opts.custom);
  if (match) {
    return { kind: 'custom', prototype: match.prototype, similarity: match.similarity };
  }

  return { kind: 'unknown' };
}

export interface CollisionCheckOptions {
  /** Similarity above which a new prototype is flagged as too close to an
   *  existing one. Should generally be looser (lower) than the runtime
   *  match threshold — better to over-warn at enrollment time than to
   *  silently create runtime ambiguity. */
  threshold: number;
}

/**
 * Run at enrollment time, BEFORE saving a new prototype: checks it against
 * every existing custom prototype and (optionally) one reference embedding
 * per base-vocabulary class, so the user can be warned ("this looks like
 * your sign for X") instead of only discovering the collision later at
 * runtime.
 */
export function checkEnrollmentCollision(
  newVector: EmbeddingVector,
  existingCustom: SignPrototype[],
  baseReferenceVectors: Array<{ label: string; vector: EmbeddingVector }>,
  opts: CollisionCheckOptions,
): CollisionWarning[] {
  const warnings: CollisionWarning[] = [];

  for (const p of existingCustom) {
    const sim = cosineSimilarity(newVector, p.vector);
    if (sim >= opts.threshold) {
      warnings.push({ against: 'custom', label: p.label, similarity: sim });
    }
  }
  for (const ref of baseReferenceVectors) {
    const sim = cosineSimilarity(newVector, ref.vector);
    if (sim >= opts.threshold) {
      warnings.push({ against: 'base', label: ref.label, similarity: sim });
    }
  }

  return warnings.sort((a, b) => b.similarity - a.similarity);
}
