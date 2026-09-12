import type { EmbeddingVector } from './types';

/** Cosine similarity, range [-1, 1] (1 = identical direction). Using cosine
 *  rather than raw distance so vector *magnitude* (which can vary with
 *  signing speed/energy) doesn't matter, only its *shape* — standard choice
 *  for embedding-matching (face/voice recognition use the same metric). */
export function cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: dimension mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Prototype = mean of a few enrollment-repetition embeddings (the standard
 *  "prototypical network" definition of a class prototype from a handful of
 *  support examples). */
export function averageVectors(vectors: EmbeddingVector[]): EmbeddingVector {
  if (vectors.length === 0) throw new Error('averageVectors: need at least one vector');
  const dim = vectors[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    if (v.length !== dim) throw new Error('averageVectors: all vectors must have the same dimension');
    for (let i = 0; i < dim; i++) sum[i] += v[i];
  }
  return sum.map((x) => x / vectors.length);
}
