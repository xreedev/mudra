import { classifyGestureSave, normalizeLabel } from '..';
import type { GestureTemplate } from '..';

function template(label: string, features: number[]): GestureTemplate {
  return { label, created_at: '2024-01-01T00:00:00.000Z', features };
}

describe('normalizeLabel', () => {
  it('treats different casing and surrounding whitespace as the same label', () => {
    expect(normalizeLabel('ARRIVED')).toBe('ARRIVED');
    expect(normalizeLabel('arrived')).toBe('ARRIVED');
    expect(normalizeLabel('  Arrived  ')).toBe('ARRIVED');
  });
});

describe('classifyGestureSave', () => {
  const near = [0, 0, 0];
  const far = [10, 10, 10];

  it('saves normally when the label is new in both custom and bundled sets', () => {
    const userTemplates = [template('HOME', near)];
    const bundled = [template('HELLO', far)];
    const decision = classifyGestureSave(userTemplates, bundled, 'ARRIVED');
    expect(decision).toEqual({ kind: 'save' });
  });

  it('flags a label collision against a custom sign', () => {
    const existing = template('ARRIVED', near);
    const decision = classifyGestureSave([existing], [], 'arrived');
    expect(decision).toEqual({ kind: 'label-collision', existing });
  });

  it('flags a label collision against a bundled sign', () => {
    const bundled = template('HELLO', near);
    const decision = classifyGestureSave([], [bundled], 'hello');
    expect(decision).toEqual({ kind: 'label-collision', existing: bundled });
  });

  it('checks custom signs before bundled ones, so a custom override wins the match', () => {
    // The user has already shadowed the bundled "HELLO" with their own recording — the collision
    // decision should point at that custom template, not the bundled one underneath it.
    const customOverride = template('HELLO', near);
    const bundledOriginal = template('HELLO', far);
    const decision = classifyGestureSave([customOverride], [bundledOriginal], 'hello');
    expect(decision).toEqual({ kind: 'label-collision', existing: customOverride });
  });

  it('does not flag a collision when a different label has a near-identical shape', () => {
    const existing = template('HOME', near);
    const decision = classifyGestureSave([existing], [], 'HOUSE');
    expect(decision).toEqual({ kind: 'save' });
  });
});
