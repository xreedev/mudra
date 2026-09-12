import { averageVectors, cosineSimilarity } from '../src/similarity';

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('is -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('ignores magnitude, only cares about direction', () => {
    // Same direction, very different signing "energy"/speed -> should
    // still read as a strong match.
    expect(cosineSimilarity([1, 1], [50, 50])).toBeCloseTo(1);
  });

  it('throws on dimension mismatch', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow();
  });
});

describe('averageVectors', () => {
  it('averages component-wise', () => {
    expect(averageVectors([[1, 2], [3, 4]])).toEqual([2, 3]);
  });

  it('is stable for near-identical repetitions of the same sign', () => {
    const reps = [
      [1.0, 0.1, 0.0],
      [0.95, 0.12, 0.02],
      [1.05, 0.08, -0.01],
    ];
    const proto = averageVectors(reps);
    // The averaged prototype should still point clearly in the same
    // direction as each individual repetition.
    for (const rep of reps) {
      expect(cosineSimilarity(proto, rep)).toBeGreaterThan(0.98);
    }
  });

  it('throws on empty input', () => {
    expect(() => averageVectors([])).toThrow();
  });
});
