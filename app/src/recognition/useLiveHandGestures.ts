import { useEffect, useRef, useState } from 'react';
import { useFrameProcessor, VisionCameraProxy } from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';
import { recognizeLandmarks } from './gestureRecognizer';
import { useAllGestureTemplates } from './useAllGestureTemplates';
import type { GestureMatch, GestureTemplate, HandLandmark } from './types';

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
  /** The most recent frame's landmarks, lightly smoothed frame-to-frame for
   *  display, or `null` when no hand is in view — drawn as the live
   *  skeleton overlay and used to know whether a hand is currently present
   *  (drives the hold-to-confirm guide). Recognition matching below still
   *  runs on the raw, unsmoothed points. */
  landmarks: HandLandmark[] | null;
  /** Every template currently being matched against — bundled plus
   *  user-added — for UI that reports how many signs the app knows. */
  templates: GestureTemplate[];
}

/**
 * Runs real on-device hand-landmark detection on every camera frame and
 * matches it against every known gesture template — bundled ones plus
 * whatever the user has recorded via Add custom sign (see
 * `useAllGestureTemplates`) — the live-camera connection
 * src/recognition/README.md describes as still needed: "Connect a
 * MediaPipe... frame-processor plugin and call recognizeLandmarks with its
 * single-hand result."
 */
// How much each new frame moves the displayed point toward the raw
// detection: lower = smoother but laggier, higher = snappier but jittery.
const SMOOTHING_ALPHA = 0.4;

export function useLiveHandGestures(): LiveHandGestures {
  const [match, setMatch] = useState<GestureMatch | null>(null);
  const [landmarks, setLandmarks] = useState<HandLandmark[] | null>(null);
  const smoothedRef = useRef<HandLandmark[] | null>(null);
  const { templates } = useAllGestureTemplates();
  // `handleLandmarks` is bound once (see the empty deps array below) so the
  // frame processor's worklet stays stable — it reads the latest templates
  // through this ref rather than closing over a stale array.
  const templatesRef = useRef(templates);
  useEffect(() => {
    templatesRef.current = templates;
  }, [templates]);

  const handleLandmarks = useRunOnJS((frameLandmarks: HandLandmark[] | null) => {
    // Recognition matches on the raw points — smoothing would blur exactly
    // the shape differences it needs to tell signs apart.
    setMatch(recognizeLandmarks(frameLandmarks, templatesRef.current));

    if (!frameLandmarks) {
      smoothedRef.current = null;
      setLandmarks(null);
      return;
    }
    const prev = smoothedRef.current;
    const smoothed =
      prev && prev.length === frameLandmarks.length
        ? frameLandmarks.map((point, index) => ({
            x: prev[index].x + (point.x - prev[index].x) * SMOOTHING_ALPHA,
            y: prev[index].y + (point.y - prev[index].y) * SMOOTHING_ALPHA,
            z: prev[index].z + (point.z - prev[index].z) * SMOOTHING_ALPHA,
          }))
        : frameLandmarks;
    smoothedRef.current = smoothed;
    setLandmarks(smoothed);
  }, []);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      if (!plugin) return;
      const frameLandmarks = plugin.call(frame) as HandLandmark[] | null | undefined;
      handleLandmarks(frameLandmarks ?? null);
    },
    [handleLandmarks],
  );

  return { frameProcessor, match, landmarks, templates };
}
