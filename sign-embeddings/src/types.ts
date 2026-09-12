/**
 * Custom-sign-via-embedding: types shared across the enrollment and
 * runtime-matching logic. Kept platform-agnostic — no RN/TFLite imports
 * here — so this whole module ports into app/src/features/signing/ later
 * without changes. See INTEGRATION.md for the plug-in points.
 */

/** A single landmark-window embedding — the output of sign_embed.tflite for
 *  one ~30-frame window, same shape the base classifier's penultimate layer
 *  produces (see ml/export_embedding_model.py). */
export type EmbeddingVector = number[];

/** A user-taught custom sign: the averaged embedding of a few repetitions,
 *  plus whatever label/output text it should produce when recognized. */
export interface SignPrototype {
  id: string;
  /** What the user called it / the text this sign should produce. */
  label: string;
  vector: EmbeddingVector;
  /** How many enrollment repetitions were averaged into this vector —
   *  useful for showing the user "3/5 samples" during teaching, and for
   *  incrementally re-averaging if more samples are added later. */
  sampleCount: number;
  createdAt: number;
}

/** Result of the base (fixed-vocabulary) classifier on one window. */
export interface BaseClassifierResult {
  label: string;
  confidence: number;
}

/** What the combined recognition step decides for one window. */
export type RecognitionResult =
  | { kind: 'base'; label: string; confidence: number }
  | { kind: 'custom'; prototype: SignPrototype; similarity: number }
  | { kind: 'unknown' };

/** A potential collision flagged during enrollment (new sign too close to
 *  an existing one — see checkEnrollmentCollision in matching.ts). */
export interface CollisionWarning {
  against: 'custom' | 'base';
  label: string;
  similarity: number;
}
