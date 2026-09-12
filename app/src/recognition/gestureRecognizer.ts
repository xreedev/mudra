import { isValidLandmarks, REQUIRED_LANDMARK_COUNT } from './captureQuality';
import type { GestureMatch, GestureTemplate, GestureTemplateFile, HandLandmark } from './types';

const GEOMETRY_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 4], [0, 8], [0, 12], [0, 16], [0, 20], [4, 8], [8, 12], [12, 16], [16, 20],
];

/** 21 landmarks × 3 coordinates, plus one distance per `GEOMETRY_PAIRS` entry
 *  — every valid `features` array, bundled or user-recorded, is this length. */
export const FEATURE_VECTOR_LENGTH = REQUIRED_LANDMARK_COUNT * 3 + GEOMETRY_PAIRS.length;

/** Matches the feature recipe used by custom_gesture_snapshot_app exactly. */
export function featureVector(landmarks: readonly HandLandmark[]): number[] | null {
  if (!isValidLandmarks(landmarks)) return null;
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

/**
 * Validates and filters an untyped `GestureTemplateFile`-shaped blob —
 * whether it's the bundled asset or a hand-edited/corrupted on-device file,
 * a single bad record must never take down the whole set. A gesture is
 * dropped (not the whole file) if its label is missing, its `features`
 * aren't exactly `FEATURE_VECTOR_LENGTH` finite numbers (wrong dimension —
 * e.g. from an incompatible recorder — would silently corrupt every
 * distance comparison against it), or its optional `hand_landmarks` contain
 * non-finite values.
 */
export function parseGestureTemplates(input: unknown): GestureTemplate[] {
  if (!input || typeof input !== 'object' || !Array.isArray((input as GestureTemplateFile).gestures)) return [];
  return (input as GestureTemplateFile).gestures.filter((gesture): gesture is GestureTemplate => {
    if (typeof gesture?.label !== 'string' || gesture.label.trim().length === 0) return false;
    if (
      !Array.isArray(gesture.features) ||
      gesture.features.length !== FEATURE_VECTOR_LENGTH ||
      !gesture.features.every((value) => typeof value === 'number' && Number.isFinite(value))
    ) {
      return false;
    }
    if (gesture.hand_landmarks !== undefined && !isValidLandmarks(gesture.hand_landmarks)) return false;
    return true;
  });
}

/** Below this RMS feature distance, two gestures are considered the same
 *  sign — used both for live recognition and for flagging a near-duplicate
 *  when a user records a new custom gesture. */
export const DEFAULT_MATCH_THRESHOLD = 0.42;

export function recognizeLandmarks(landmarks: readonly HandLandmark[] | null | undefined, templates: readonly GestureTemplate[], threshold = DEFAULT_MATCH_THRESHOLD): GestureMatch {
  const features = landmarks ? featureVector(landmarks) : null;
  if (!features || templates.length === 0) return { label: 'UNKNOWN', distance: Number.POSITIVE_INFINITY, isKnown: false };
  const ranked = templates.map((template) => ({ label: template.label, distance: featureDistance(features, template.features) })).sort((first, second) => first.distance - second.distance);
  const closest = ranked[0];
  return closest.distance <= threshold ? { ...closest, isKnown: true } : { label: 'UNKNOWN', distance: closest.distance, isKnown: false, closestLabel: closest.label };
}
