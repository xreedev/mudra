import { checkEnrollmentCollision, decideRecognition, findBestMatch } from '../src/matching';
import type { BaseClassifierResult, SignPrototype } from '../src/types';

// Synthetic embedding "directions" standing in for real sign_embed.tflite
// output — each represents a visually distinct sign. Small per-repetition
// jitter simulates natural variation between performances of the same sign.
const PROTO_HOSPITAL: SignPrototype = {
  id: 'p1',
  label: 'HOSPITAL',
  vector: [1, 0.05, 0, 0],
  sampleCount: 4,
  createdAt: 0,
};
const PROTO_INSURANCE: SignPrototype = {
  id: 'p2',
  label: 'INSURANCE',
  vector: [0, 1, 0.05, 0],
  sampleCount: 4,
  createdAt: 0,
};
// Deliberately near-identical to PROTO_HOSPITAL — simulates a user teaching
// a genuinely ambiguous/near-duplicate custom sign.
const PROTO_ALMOST_HOSPITAL: SignPrototype = {
  id: 'p3',
  label: 'ALMOST_HOSPITAL',
  vector: [0.99, 0.1, 0, 0],
  sampleCount: 3,
  createdAt: 0,
};

describe('findBestMatch', () => {
  const prototypes = [PROTO_HOSPITAL, PROTO_INSURANCE];

  it('finds the clearly nearest prototype', () => {
    const live = [0.98, 0.02, 0, 0]; // close to HOSPITAL, far from INSURANCE
    const match = findBestMatch(live, prototypes, { threshold: 0.7 });
    expect(match?.prototype.label).toBe('HOSPITAL');
  });

  it('returns null when nothing clears the threshold', () => {
    const live = [0, 0, 0, 1]; // orthogonal to everything
    const match = findBestMatch(live, prototypes, { threshold: 0.7 });
    expect(match).toBeNull();
  });

  it('returns null on a near-tie even if both clear the threshold (margin check)', () => {
    const ambiguous = [PROTO_HOSPITAL, PROTO_ALMOST_HOSPITAL];
    const live = [0.985, 0.075, 0, 0]; // roughly equidistant from both
    const match = findBestMatch(live, ambiguous, { threshold: 0.7, minMargin: 0.05 });
    expect(match).toBeNull();
  });

  it('returns empty-list null without throwing', () => {
    expect(findBestMatch([1, 0], [], { threshold: 0.5 })).toBeNull();
  });
});

describe('decideRecognition — base-confidence-first priority (Fix 1)', () => {
  const opts = {
    baseConfidenceThreshold: 0.6,
    custom: { threshold: 0.7, minMargin: 0.05 },
  };
  const prototypes = [PROTO_HOSPITAL];

  it('trusts a confident base classifier and never even checks custom prototypes', () => {
    // live vector deliberately looks like PROTO_HOSPITAL, but the base
    // classifier is confident about a DIFFERENT label — base should win,
    // proving the custom matcher doesn't "steal" a confidently-classified
    // known sign.
    const base: BaseClassifierResult = { label: 'PAIN', confidence: 0.9 };
    const live = [1, 0.05, 0, 0];
    const result = decideRecognition(base, live, prototypes, opts);
    expect(result).toEqual({ kind: 'base', label: 'PAIN', confidence: 0.9 });
  });

  it('falls through to a custom match when the base classifier is unsure', () => {
    const base: BaseClassifierResult = { label: 'PAIN', confidence: 0.2 };
    const live = [1, 0.05, 0, 0]; // matches PROTO_HOSPITAL
    const result = decideRecognition(base, live, prototypes, opts);
    expect(result.kind).toBe('custom');
    if (result.kind === 'custom') expect(result.prototype.label).toBe('HOSPITAL');
  });

  it('reports unknown when neither the base classifier nor any custom sign matches', () => {
    const base: BaseClassifierResult = { label: 'PAIN', confidence: 0.2 };
    const live = [0, 0, 0, 1]; // matches nothing
    const result = decideRecognition(base, live, prototypes, opts);
    expect(result).toEqual({ kind: 'unknown' });
  });
});

describe('checkEnrollmentCollision (Fix 2)', () => {
  it('flags a new prototype that is too close to an existing custom sign', () => {
    const warnings = checkEnrollmentCollision(
      [0.99, 0.06, 0, 0], // about to be saved as a new custom sign
      [PROTO_HOSPITAL],
      [],
      { threshold: 0.9 },
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ against: 'custom', label: 'HOSPITAL' });
  });

  it('flags a new prototype that collides with a base-vocabulary reference embedding', () => {
    const warnings = checkEnrollmentCollision(
      [0, 0.99, 0.04, 0],
      [],
      [{ label: 'INSURANCE', vector: [0, 1, 0.05, 0] }],
      { threshold: 0.9 },
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ against: 'base', label: 'INSURANCE' });
  });

  it('returns no warnings for a genuinely distinct new sign', () => {
    const warnings = checkEnrollmentCollision(
      [0, 0, 0, 1],
      [PROTO_HOSPITAL, PROTO_INSURANCE],
      [],
      { threshold: 0.9 },
    );
    expect(warnings).toHaveLength(0);
  });

  it('sorts multiple warnings by similarity, most concerning first', () => {
    const warnings = checkEnrollmentCollision(
      [0.97, 0.08, 0, 0],
      [PROTO_HOSPITAL, PROTO_ALMOST_HOSPITAL],
      [],
      { threshold: 0.5 },
    );
    expect(warnings.length).toBe(2);
    expect(warnings[0].similarity).toBeGreaterThanOrEqual(warnings[1].similarity);
  });
});
