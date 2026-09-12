import {
  BUNDLED_GESTURE_TEMPLATES,
  FEATURE_VECTOR_LENGTH,
  featureVector,
  parseGestureTemplates,
  recognizeLandmarks,
} from '..';
import type { HandLandmark } from '..';

function goodHand(): HandLandmark[] {
  return Array.from({ length: 21 }, (_, index) => ({
    x: 0.5 + Math.cos(index) * 0.2,
    y: 0.5 + Math.sin(index) * 0.2,
    z: 0,
  }));
}

describe('custom gesture JSON recognizer', () => {
  it('loads usable templates from the bundled browser export', () => {
    expect(BUNDLED_GESTURE_TEMPLATES.length).toBeGreaterThan(0);
    expect(BUNDLED_GESTURE_TEMPLATES.every((template) => template.features.length === FEATURE_VECTOR_LENGTH)).toBe(
      true,
    );
  });

  it('recognizes a template landmark set with zero distance', () => {
    const template = BUNDLED_GESTURE_TEMPLATES[0];
    const result = recognizeLandmarks(template.hand_landmarks, BUNDLED_GESTURE_TEMPLATES);
    expect(result).toMatchObject({ label: template.label, isKnown: true });
    expect(result.distance).toBeCloseTo(0);
  });

  it('rejects incomplete landmark input', () => {
    expect(featureVector([])).toBeNull();
    expect(recognizeLandmarks([], BUNDLED_GESTURE_TEMPLATES).label).toBe('UNKNOWN');
  });

  it('rejects landmarks with non-finite coordinates', () => {
    const bad = goodHand();
    bad[4] = { ...bad[4], x: NaN };
    expect(featureVector(bad)).toBeNull();

    const infinite = goodHand();
    infinite[10] = { ...infinite[10], z: Infinity };
    expect(featureVector(infinite)).toBeNull();
  });

  it('produces a feature vector of the expected fixed length', () => {
    const features = featureVector(goodHand());
    expect(features).not.toBeNull();
    expect(features).toHaveLength(FEATURE_VECTOR_LENGTH);
  });
});

describe('parseGestureTemplates', () => {
  const base = { label: 'HOME', features: Array(FEATURE_VECTOR_LENGTH).fill(0.1) };

  it('accepts a well-formed gesture', () => {
    const result = parseGestureTemplates({ schema: 'custom-gesture-snapshot-v1', gestures: [base] });
    expect(result).toHaveLength(1);
  });

  it('drops a gesture with the wrong feature dimension without throwing', () => {
    const wrongLength = { label: 'HOME', features: [1, 2, 3] };
    const result = parseGestureTemplates({ schema: 'custom-gesture-snapshot-v1', gestures: [wrongLength, base] });
    expect(result).toEqual([base]);
  });

  it('drops a gesture whose features contain NaN/Infinity', () => {
    const withNaN = { label: 'HOME', features: [...Array(FEATURE_VECTOR_LENGTH - 1).fill(0), NaN] };
    const result = parseGestureTemplates({ schema: 'custom-gesture-snapshot-v1', gestures: [withNaN, base] });
    expect(result).toEqual([base]);
  });

  it('drops a gesture with an empty or missing label', () => {
    const blank = { ...base, label: '   ' };
    const missing = { features: base.features };
    const result = parseGestureTemplates({ schema: 'custom-gesture-snapshot-v1', gestures: [blank, missing, base] });
    expect(result).toEqual([base]);
  });

  it('drops a gesture whose hand_landmarks are corrupt, even if features are fine', () => {
    const corruptLandmarks = { ...base, hand_landmarks: [{ x: NaN, y: 0, z: 0 }] };
    const result = parseGestureTemplates({
      schema: 'custom-gesture-snapshot-v1',
      gestures: [corruptLandmarks, base],
    });
    expect(result).toEqual([base]);
  });

  it('returns an empty array for a non-object or missing gestures list, without throwing', () => {
    expect(parseGestureTemplates(null)).toEqual([]);
    expect(parseGestureTemplates(undefined)).toEqual([]);
    expect(parseGestureTemplates('not json')).toEqual([]);
    expect(parseGestureTemplates({ schema: 'custom-gesture-snapshot-v1' })).toEqual([]);
  });
});
