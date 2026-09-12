import type { GestureMatch, GestureTemplate, GestureTemplateFile, HandLandmark } from './types';

const GEOMETRY_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 4], [0, 8], [0, 12], [0, 16], [0, 20], [4, 8], [8, 12], [12, 16], [16, 20],
];

/** Matches the feature recipe used by custom_gesture_snapshot_app exactly. */
export function featureVector(landmarks: readonly HandLandmark[]): number[] | null {
  if (landmarks.length !== 21) return null;
  const wrist = landmarks[0];
  let scale = 0;
  for (const point of landmarks) {
    scale = Math.max(scale, Math.hypot(point.x - wrist.x, point.y - wrist.y, point.z - wrist.z));
  }
  if (scale === 0) return null;
  const normalized = landmarks.map((point) => ({ x: (point.x - wrist.x) / scale, y: (point.y - wrist.y) / scale, z: (point.z - wrist.z) / scale }));
  const features = normalized.flatMap((point) => [point.x, point.y, point.z]);
  for (const [left, right] of GEOMETRY_PAIRS) {
    const a = normalized[left];
    const b = normalized[right];
    features.push(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
  }
  return features;
}

/** Root-mean-square Euclidean distance; lower means a closer gesture. */
export function featureDistance(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0) return Number.POSITIVE_INFINITY;
  const length = Math.max(a.length, b.length);
  let total = 0;
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    total += delta * delta;
  }
  return Math.sqrt(total / length);
}

export function parseGestureTemplates(input: unknown): GestureTemplate[] {
  if (!input || typeof input !== 'object' || !Array.isArray((input as GestureTemplateFile).gestures)) return [];
  return (input as GestureTemplateFile).gestures.filter(
    (gesture): gesture is GestureTemplate => typeof gesture?.label === 'string' && gesture.label.trim().length > 0 && Array.isArray(gesture.features) && gesture.features.every((value) => typeof value === 'number'),
  );
}

export function recognizeLandmarks(landmarks: readonly HandLandmark[] | null | undefined, templates: readonly GestureTemplate[], threshold = 0.42): GestureMatch {
  const features = landmarks ? featureVector(landmarks) : null;
  if (!features || templates.length === 0) return { label: 'UNKNOWN', distance: Number.POSITIVE_INFINITY, isKnown: false };
  const ranked = templates.map((template) => ({ label: template.label, distance: featureDistance(features, template.features) })).sort((first, second) => first.distance - second.distance);
  const closest = ranked[0];
  return closest.distance <= threshold ? { ...closest, isKnown: true } : { label: 'UNKNOWN', distance: closest.distance, isKnown: false, closestLabel: closest.label };
}
