# Custom gesture recognition pipeline

`custom_gestures.json` is copied from the snapshot trainer into `src/assets` and bundled with the React Native application. `recognizeLandmarks(landmarks, BUNDLED_GESTURE_TEMPLATES)` performs the same normalization, feature extraction, nearest-template matching, and `UNKNOWN` thresholding as the browser test module.

The camera package provides frames, not 21 hand landmarks. Connect a MediaPipe or ML Kit VisionCamera frame-processor plugin and call `recognizeLandmarks` with its single-hand `[ { x, y, z }, ... ]` result. The recognizer deliberately has no detector dependency, so the native detector can be selected independently while retaining JSON compatibility.
