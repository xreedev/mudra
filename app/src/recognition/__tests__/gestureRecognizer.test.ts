import { BUNDLED_GESTURE_TEMPLATES, featureVector, recognizeLandmarks } from '..';

describe('custom gesture JSON recognizer', () => {
  it('loads usable templates from the bundled browser export', () => {
    expect(BUNDLED_GESTURE_TEMPLATES.length).toBeGreaterThan(0);
    expect(BUNDLED_GESTURE_TEMPLATES.every((template) => template.features.length === 72)).toBe(true);
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
});
