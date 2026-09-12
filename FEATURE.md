# Custom Gesture Recognition

Branch: `feature/custom-gesture-recognition`

## What changed

- Added `app/src/assets/custom_gestures.json`, copied from the snapshot trainer export.
- Added `app/src/recognition/gestureRecognizer.ts`, a pure on-device matching pipeline compatible with that JSON format.
- The pipeline validates gesture templates, normalizes 21 hand landmarks around the wrist, produces the same 72 features as the trainer, ranks templates by RMS Euclidean distance, and emits `UNKNOWN` when the closest result is above the configurable threshold (default `0.42`).
- Added a bundled-template loader, public recognition exports, and unit tests.
- Updated the call camera overlay to show the number of local templates loaded.

## Usage

```ts
import { BUNDLED_GESTURE_TEMPLATES, recognizeLandmarks } from './src/recognition';

const match = recognizeLandmarks(handLandmarks, BUNDLED_GESTURE_TEMPLATES);
```

`handLandmarks` must be one detected hand as 21 `{ x, y, z }` points in MediaPipe-compatible order.

## Validation

- The bundled export contains 5 templates.
- Each template has 21 landmarks and 72 features.
- Jest and TypeScript checks passed after installing the React Native dependencies.

## Live camera integration

Metro and `react-native-vision-camera` provide the preview and app bundle, but they do not extract hand landmarks. To perform live recognition on-device, connect a MediaPipe or ML Kit VisionCamera frame-processor plugin and pass its per-frame 21-landmark output to `recognizeLandmarks`.
