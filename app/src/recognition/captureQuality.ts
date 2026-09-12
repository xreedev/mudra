import type { HandLandmark } from './types';

/** MediaPipe Hands' fixed single-hand landmark count. */
export const REQUIRED_LANDMARK_COUNT = 21;

/**
 * True only for a plausible single-hand MediaPipe result: exactly
 * `REQUIRED_LANDMARK_COUNT` points, every coordinate a finite number (not
 * `NaN`/`Infinity`, and not a non-numeric value that slipped through a
 * corrupted JSON file or a bridge/serialization glitch).
 */
export function isValidLandmarks(
  landmarks: readonly HandLandmark[] | null | undefined,
): landmarks is HandLandmark[] {
  if (!landmarks || landmarks.length !== REQUIRED_LANDMARK_COUNT) return false;
  return landmarks.every(
    (point) =>
      typeof point?.x === 'number' &&
      typeof point.y === 'number' &&
      typeof point.z === 'number' &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      Number.isFinite(point.z),
  );
}

/**
 * Bounding-box diagonal across raw (frame-normalized, not wrist-relative)
 * landmark coordinates — a cheap proxy for how large the hand appears in
 * frame. A hand held far from the camera occupies a small fraction of the
 * frame and produces a small spread, which is what "move closer" detects;
 * `featureVector`'s own wrist-relative scale can't tell this apart from a
 * close, small hand, so this check has to run on the raw points instead.
 */
export function handSpread(landmarks: readonly HandLandmark[]): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of landmarks) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return Math.hypot(maxX - minX, maxY - minY);
}

/** Below this frame-relative spread, the hand reads as too far from the camera. */
export const MIN_HAND_SPREAD = 0.15;

/**
 * Largest single-landmark displacement between any two consecutive samples
 * in a short hold window — a simple jitter signal. A steadily-held sign
 * moves very little frame to frame; a hand still mid-motion, or tracking
 * that's losing/reacquiring the hand, moves a lot.
 */
export function maxJitter(samples: ReadonlyArray<readonly HandLandmark[]>): number {
  let max = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const previous = samples[i - 1];
    const current = samples[i];
    if (previous.length !== current.length) continue;
    for (let index = 0; index < current.length; index += 1) {
      const distance = Math.hypot(
        current[index].x - previous[index].x,
        current[index].y - previous[index].y,
        current[index].z - previous[index].z,
      );
      if (distance > max) max = distance;
    }
  }
  return max;
}

/** Above this per-frame displacement, a hold is treated as unstable. */
export const MAX_JITTER = 0.08;

export type CaptureRejectReason = 'no-hand' | 'too-far' | 'unstable';

export const CAPTURE_REJECT_MESSAGES: Record<CaptureRejectReason, string> = {
  'no-hand': 'Hand not detected',
  'too-far': 'Move your hand closer',
  unstable: 'Hold your hand steady',
};

/**
 * Decides whether a completed hold is good enough to save, in priority
 * order: no valid hand at all, hand too small in frame, then jitter across
 * the hold window. `samples` should be the landmarks seen during roughly
 * the hold duration, oldest first, ending with the landmarks at completion.
 */
export function assessCapture(
  landmarks: readonly HandLandmark[] | null | undefined,
  samples: ReadonlyArray<readonly HandLandmark[]>,
): CaptureRejectReason | null {
  if (!isValidLandmarks(landmarks)) return 'no-hand';
  if (handSpread(landmarks) < MIN_HAND_SPREAD) return 'too-far';
  if (maxJitter(samples) > MAX_JITTER) return 'unstable';
  return null;
}
