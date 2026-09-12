import { useState } from 'react';
import { useFrameProcessor, VisionCameraProxy } from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';
import { BUNDLED_GESTURE_TEMPLATES } from './bundledTemplates';
import { recognizeLandmarks } from './gestureRecognizer';
import type { GestureMatch, HandLandmark } from './types';

// Created once per JS bundle load, not per component instance — matches
// VisionCamera's own documented usage (see its useFrameProcessor example).
// Returns undefined if HandLandmarksFrameProcessorPlugin.kt wasn't
// registered (e.g. running before a native rebuild that added it).
const plugin = VisionCameraProxy.initFrameProcessorPlugin('detectHandLandmarks', {});

export interface LiveHandGestures {
  /** Pass straight to `<CameraStage frameProcessor={...}>`. */
  frameProcessor: ReturnType<typeof useFrameProcessor>;
  /** The most recently recognized gesture. `null` before the first hand is
   *  seen, or `{ isKnown: false, label: 'UNKNOWN' }` once a hand is seen but
   *  doesn't match any bundled template closely enough — TRAINING.md's
   *  "never guess" principle: low confidence maps to nothing shown, not a
   *  best-effort wrong guess. */
  match: GestureMatch | null;
}

/**
 * Runs real on-device hand-landmark detection on every camera frame and
 * matches it against the bundled gesture templates — the live-camera
 * connection src/recognition/README.md describes as still needed:
 * "Connect a MediaPipe... frame-processor plugin and call recognizeLandmarks
 * with its single-hand result."
 */
export function useLiveHandGestures(): LiveHandGestures {
  const [match, setMatch] = useState<GestureMatch | null>(null);

  const handleLandmarks = useRunOnJS((landmarks: HandLandmark[] | null) => {
    setMatch(recognizeLandmarks(landmarks, BUNDLED_GESTURE_TEMPLATES));
  }, []);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      if (!plugin) return;
      const landmarks = plugin.call(frame) as HandLandmark[] | null | undefined;
      handleLandmarks(landmarks ?? null);
    },
    [handleLandmarks],
  );

  return { frameProcessor, match };
}
