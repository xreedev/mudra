/**
 * Sequence-level similarity. Everything here is bounded work on short token arrays
 * (<= `maxTokens`) and allocates at most two small rows.
 */

/**
 * Length of the longest common subsequence of two token-id sequences.
 *
 * Order-aware, so `ME TEA HOT` scores higher against `ME WANT TEA HOT` than against
 * `HOT TEA ME` — exactly the discrimination gloss ordering needs.
 */
export function lcsLength(
  a: Int32Array | number[],
  aLength: number,
  b: Int32Array | number[],
  bLength: number,
): number {
  if (aLength === 0 || bLength === 0) return 0;

  // Iterate the shorter sequence in the inner dimension to keep the rows small.
  let x = a;
  let xLength = aLength;
  let y = b;
  let yLength = bLength;
  if (aLength > bLength) {
    x = b;
    xLength = bLength;
    y = a;
    yLength = aLength;
  }

  let previous = new Int32Array(xLength + 1);
  let current = new Int32Array(xLength + 1);
  for (let i = 1; i <= yLength; i++) {
    const yi = y[i - 1];
    current[0] = 0;
    for (let j = 1; j <= xLength; j++) {
      current[j] =
        x[j - 1] === yi
          ? previous[j - 1] + 1
          : Math.max(previous[j], current[j - 1]);
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[xLength];
}

/**
 * Levenshtein distance with an early exit once the best possible distance exceeds `maxEdits`.
 * Returns `Infinity` when the strings are further apart than that. Used only to repair an
 * unknown query token against the vocabulary.
 */
export function boundedEditDistance(a: string, b: string, maxEdits: number): number {
  if (maxEdits < 0) return Infinity;
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxEdits) return Infinity;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const width = b.length + 1;
  let previous = new Int32Array(width);
  let current = new Int32Array(width);
  for (let j = 0; j < width; j++) previous[j] = j;

  const unreachable = 1 << 24;
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    const ai = a.charCodeAt(i - 1);
    let rowMin = current[0];
    // Cells outside the diagonal band can never reach a distance <= maxEdits.
    const from = Math.max(1, i - maxEdits);
    const to = Math.min(b.length, i + maxEdits);
    for (let j = 1; j <= b.length; j++) {
      if (j < from || j > to) {
        current[j] = unreachable;
        continue;
      }
      const substitution = previous[j - 1] + (ai === b.charCodeAt(j - 1) ? 0 : 1);
      current[j] = Math.min(substitution, previous[j] + 1, current[j - 1] + 1);
      if (current[j] < rowMin) rowMin = current[j];
    }
    if (rowMin > maxEdits) return Infinity;
    const swap = previous;
    previous = current;
    current = swap;
  }
  const distance = previous[b.length];
  return distance > maxEdits ? Infinity : distance;
}
