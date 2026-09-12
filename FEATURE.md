# Custom Gesture Recognition

Branch: `Fixedhomecallscreen`

## What changed

- Added `app/src/assets/custom_gestures.json`, copied from the snapshot trainer export (bundled, read-only templates).
- `app/src/recognition/gestureRecognizer.ts` — pure on-device matching pipeline. Normalizes 21 hand landmarks around the wrist, produces the same 72 features as the trainer, ranks templates by RMS Euclidean distance, and emits `UNKNOWN` when the closest result is above the configurable threshold (default `0.42`).
- `app/src/recognition/captureQuality.ts` — gates a capture before it's accepted: checks landmark shape validity, hand-to-camera distance (`handSpread`), and steadiness over the hold window (`maxJitter`), returning a reject reason (`no-hand` / `too-far` / `unstable`) or `null` when the capture is good.
- `app/src/recognition/duplicateDetection.ts` — before persisting a new gesture, `classifyGestureSave` checks only the label, custom signs first: an existing *custom* template with this name wins the match over a bundled one with the same name (the custom one is what's actually active for that label); either way an existing label is a `label-collision`, confirm before overwriting — this is also how a user intentionally shadows a bundled sign with their own recording. No shape/look-alike check — two different custom labels are free to share a similar hand shape.
- `app/src/recognition/userGestureStore.ts` — persists user-recorded gestures to an app-private JSON file (separate from the bundled asset) via atomic temp-file-then-swap writes, with a pub-sub (`subscribeUserGesturesChanged`) so other mounted screens pick up new saves live.
- `app/src/recognition/useAllGestureTemplates.ts` — React hook merging bundled templates with user-saved ones (user labels override bundled), exposing `templates` / `userTemplates` / `loading`, plus a serialized `addOrUpdate` to avoid corrupting concurrent saves.
- `app/src/recognition/useLiveHandGestures.ts` — wires a real VisionCamera frame processor to a native MediaPipe hand-landmark plugin, runs `recognizeLandmarks` against all templates every frame, smooths landmarks for display while matching on raw points, and exposes `frameProcessor` / `match` / `landmarks` / `templates`.
- `app/src/components/SignGuideCircle.tsx` — reusable hold-progress ring shared by Add Sign and Call screens; chains holds back-to-back with a cooldown so a new sign must visibly re-form before recording again.
- `app/src/components/ConfirmModal.tsx` — the app's first themed blocking-confirmation dialog, used when saving a custom sign under a label that already exists, and for confirming "Clear all" in Add custom sign.
- Public recognition exports via `app/src/recognition/index.ts`, plus unit tests for all of the above.

## Pipeline

Camera frame → native MediaPipe plugin → `useLiveHandGestures` (landmarks + live `recognizeLandmarks` match against `useAllGestureTemplates`'s merged bundled+user set) → UI shows skeleton/guide ring.

On a completed hold (`SignGuideCircle`, in `AddSignScreen`): `assessCapture` (quality gate: hand present, close enough, steady) → the frame is also snapshotted as a display-only preview photo (see below) → `featureVector` → `classifyGestureSave` (label check, custom signs checked before bundled) → on a label collision, `ConfirmModal` asks "Update" or "Cancel" → `userGestureStore.saveUserGestures` persists atomically and notifies other mounted screens (e.g. a backgrounded `CallScreen`) to reload templates instantly.

"Clear all" in `AddSignScreen` (next to "YOUR SIGNS · N") wipes every user-recorded gesture via `useAllGestureTemplates`'s `clearAll`, behind its own `ConfirmModal` ("Clear all your signs?"). It's serialized on the same save queue as `addOrUpdate`, so it can't race a concurrent capture.

## Usage

```ts
import { BUNDLED_GESTURE_TEMPLATES, recognizeLandmarks } from './src/recognition';

const match = recognizeLandmarks(handLandmarks, BUNDLED_GESTURE_TEMPLATES);
```

`handLandmarks` must be one detected hand as 21 `{ x, y, z }` points in MediaPipe-compatible order.

## User-facing behavior

- **AddSignScreen**: capture is hold-to-confirm inside `SignGuideCircle` (auto-fires after ~1s), rejecting bad captures with plain-language errors ("Hand not detected", "Move your hand closer", "Hold your hand steady"). The captured frame stays visible as a photo instead of a black box, copied to a stable app-owned path in the caches dir right after capture (a fresh uniquely-named file each time, cleaned up on retake/unmount) — display-only, never persisted or synced. Saving triggers `ConfirmModal` only when the typed label already names an existing sign (custom signs checked first, then bundled) — confirm to overwrite it; any other label saves immediately as a new sign. A "Clear all" button next to "YOUR SIGNS · N" deletes every recorded custom sign after confirmation.
- **CallScreen**: runs true live camera-based recognition (not mocked), gated to a "detection zone" band so only a hand held at sign height near the guide circle counts. A completed hold snapshots the currently-held match, appends it to the recognized-glosses list and draft (deduping consecutive repeats of the same held sign), and shows a live count of "N templates on device."

## Validation

- The bundled export contains 5 templates; each has 21 landmarks and 72 features.
- Jest and TypeScript checks passed after installing the React Native dependencies.
- Unit tests cover capture quality gating, duplicate/collision classification, the merged-template hook, and the user gesture store.

## Live camera integration

`react-native-vision-camera` provides the preview and app bundle; a native MediaPipe frame-processor plugin extracts per-frame 21-landmark hand output, which `useLiveHandGestures` passes into `recognizeLandmarks` for both the Call screen and Add Sign screen.
