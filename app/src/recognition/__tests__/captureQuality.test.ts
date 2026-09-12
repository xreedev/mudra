import {
  assessCapture,
  CAPTURE_REJECT_MESSAGES,
  handSpread,
  isValidLandmarks,
  MAX_JITTER,
  MIN_HAND_SPREAD,
  maxJitter,
  REQUIRED_LANDMARK_COUNT,
} from '..';
import type { HandLandmark } from '..';

/** A plausible, well-spread single hand, centered in frame. */
function goodHand(offset = 0): HandLandmark[] {
  return Array.from({ length: REQUIRED_LANDMARK_COUNT }, (_, index) => ({
    x: 0.5 + Math.cos(index) * 0.2 + offset,
    y: 0.5 + Math.sin(index) * 0.2 + offset,
    z: 0,
  }));
}

describe('isValidLandmarks', () => {
  it('accepts exactly 21 finite points', () => {
    expect(isValidLandmarks(goodHand())).toBe(true);
  });

  it('rejects null/undefined/empty', () => {
    expect(isValidLandmarks(null)).toBe(false);
    expect(isValidLandmarks(undefined)).toBe(false);
    expect(isValidLandmarks([])).toBe(false);
  });

  it('rejects the wrong landmark count', () => {
    expect(isValidLandmarks(goodHand().slice(0, 20))).toBe(false);
    expect(isValidLandmarks([...goodHand(), { x: 0, y: 0, z: 0 }])).toBe(false);
  });

  it('rejects NaN, Infinity, and non-numeric coordinates', () => {
    const nan = goodHand();
    nan[5] = { ...nan[5], x: NaN };
    expect(isValidLandmarks(nan)).toBe(false);

    const infinite = goodHand();
    infinite[3] = { ...infinite[3], y: Infinity };
    expect(isValidLandmarks(infinite)).toBe(false);

    const nonNumeric = goodHand();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nonNumeric[0] = { ...nonNumeric[0], z: 'oops' as any };
    expect(isValidLandmarks(nonNumeric)).toBe(false);
  });
});

describe('handSpread', () => {
  it('is 0 for a degenerate single point repeated', () => {
    const point: HandLandmark = { x: 0.5, y: 0.5, z: 0 };
    expect(handSpread(Array(REQUIRED_LANDMARK_COUNT).fill(point))).toBe(0);
  });

  it('is below the minimum for a small/far hand', () => {
    const tiny = goodHand().map((point) => ({
      x: 0.5 + (point.x - 0.5) * 0.05,
      y: 0.5 + (point.y - 0.5) * 0.05,
      z: point.z,
    }));
    expect(handSpread(tiny)).toBeLessThan(MIN_HAND_SPREAD);
  });

  it('is above the minimum for a normally-sized hand', () => {
    expect(handSpread(goodHand())).toBeGreaterThanOrEqual(MIN_HAND_SPREAD);
  });
});

describe('maxJitter', () => {
  it('is 0 for identical repeated samples', () => {
    const hand = goodHand();
    expect(maxJitter([hand, hand, hand])).toBe(0);
  });

  it('is small for a steadily-held hand with tiny natural noise', () => {
    const base = goodHand();
    const samples = [base, base.map((p) => ({ ...p, x: p.x + 0.001 })), base];
    expect(maxJitter(samples)).toBeLessThan(MAX_JITTER);
  });

  it('is large when the hand is still moving between samples', () => {
    const samples = [goodHand(0), goodHand(0.3), goodHand(0.6)];
    expect(maxJitter(samples)).toBeGreaterThan(MAX_JITTER);
  });
});

describe('assessCapture', () => {
  it('rejects with no-hand when landmarks are missing or invalid', () => {
    expect(assessCapture(null, [])).toBe('no-hand');
    expect(assessCapture(goodHand().slice(0, 5), [])).toBe('no-hand');
  });

  it('rejects with too-far for a small/distant hand', () => {
    const tiny = goodHand().map((point) => ({
      x: 0.5 + (point.x - 0.5) * 0.05,
      y: 0.5 + (point.y - 0.5) * 0.05,
      z: point.z,
    }));
    expect(assessCapture(tiny, [tiny])).toBe('too-far');
  });

  it('rejects with unstable when recent samples jittered a lot', () => {
    const current = goodHand(0.6);
    expect(assessCapture(current, [goodHand(0), goodHand(0.3), current])).toBe('unstable');
  });

  it('accepts a valid, close, steady hand', () => {
    const hand = goodHand();
    expect(assessCapture(hand, [hand, hand, hand])).toBeNull();
  });

  it('has a user-facing message for every reject reason', () => {
    expect(CAPTURE_REJECT_MESSAGES['no-hand']).toBeTruthy();
    expect(CAPTURE_REJECT_MESSAGES['too-far']).toBeTruthy();
    expect(CAPTURE_REJECT_MESSAGES.unstable).toBeTruthy();
  });
});
