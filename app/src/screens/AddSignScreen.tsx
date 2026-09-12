import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import RNFS from 'react-native-fs';
import {
  AppHeader,
  Button,
  CameraStage,
  Card,
  ConfirmModal,
  GlossChips,
  HandSkeleton,
  HOLD_MS,
  Icon,
  Screen,
  SignGuideCircle,
  Text,
  TextField,
  type CameraStageHandle,
} from '../components';
import {
  assessCapture,
  BUNDLED_GESTURE_TEMPLATES,
  classifyGestureSave,
  CAPTURE_REJECT_MESSAGES,
  featureVector,
  useAllGestureTemplates,
  type GestureTemplate,
  type HandLandmark,
} from '../recognition';
import { useLiveHandGestures } from '../recognition/useLiveHandGestures';
import { useTheme } from '../theme';
import type { ScreenProps } from '../navigation/types';

/** Display-only preview photo handling. VisionCamera's own `photo.path` lives in a temporary
 *  location it doesn't guarantee the lifetime of, which showed up as the preview silently going
 *  blank a moment after capture — copying it into a stable, app-owned path immediately after
 *  capture avoids depending on that temp file surviving. Never the file that gets
 *  persisted/synced, only the landmarks/features are. */
const PREVIEW_PHOTO_DIR = RNFS.CachesDirectoryPath;

function stripFileScheme(uri: string): string {
  return uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
}

/**
 * Copies VisionCamera's temporary photo to a fresh, uniquely-named file in the app's cache dir
 * and returns a displayable URI, or the original URI unchanged if the copy fails for any reason.
 * A fresh filename per capture — instead of one fixed path — matters for two reasons: it avoids
 * Android's Image component showing a stale cached bitmap for a *reused* URI, and, unlike a
 * `?query` suffix, doesn't corrupt a `file://` path (Android's local-file image loader opens that
 * string as a literal path, so anything appended after it just makes the file "not found").
 */
async function persistPreviewPhoto(sourceUri: string): Promise<string> {
  const destPath = `${PREVIEW_PHOTO_DIR}/add-sign-preview-${Date.now()}.jpg`;
  try {
    await RNFS.copyFile(stripFileScheme(sourceUri), destPath);
    return Platform.OS === 'android' ? `file://${destPath}` : destPath;
  } catch {
    return sourceUri;
  }
}

/** How long a landmark sample stays in the stability-check buffer — matches
 *  the guide circle's hold duration, since that's the window a hold's
 *  steadiness is judged over. A little slack is added for timer/paint jitter. */
const SAMPLE_WINDOW_MS = HOLD_MS + 200;

/**
 * Add a custom sign: hold it inside the guide circle until it captures, name it, save.
 *
 * Capture reuses CallScreen's hold-to-confirm circle and live MediaPipe skeleton, and saves
 * only the normalized hand landmarks and the derived `features` vector — the same
 * normalization/feature-extraction/matching pipeline every other gesture (bundled or custom)
 * goes through. A completed hold is checked for quality (a real, stable, close-enough hand)
 * before it's ever offered up to save.
 *
 * Before saving, the only check is whether the label already names an existing gesture —
 * bundled or custom — which always asks for confirmation before it overwrites that template
 * (this is also how a user shadows a bundled sign with their own recording, on purpose). Any
 * other label saves directly as a new gesture.
 */
export function AddSignScreen(_: ScreenProps<'AddSign'>) {
  const theme = useTheme();
  const camera = useRef<CameraStageHandle>(null);
  const [captured, setCaptured] = useState(false);
  const [capturedLandmarks, setCapturedLandmarks] = useState<HandLandmark[] | null>(null);
  const [capturedFeatures, setCapturedFeatures] = useState<number[] | null>(null);
  const [capturedPhotoUri, setCapturedPhotoUri] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState('');
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });

  const [confirmingLabelOverwrite, setConfirmingLabelOverwrite] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<GestureTemplate | null>(null);
  const [confirmingClearAll, setConfirmingClearAll] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);

  const { frameProcessor, landmarks } = useLiveHandGestures();
  const { userTemplates, addOrUpdate, clearAll } = useAllGestureTemplates();
  // Tracks the previous preview file so it can be cleaned up once a new one replaces it — each
  // capture gets its own uniquely-named file (see `persistPreviewPhoto`), so without this they'd
  // accumulate in the cache dir for as long as the screen stays mounted.
  const previewPhotoPathRef = useRef<string | null>(null);
  useEffect(() => {
    return () => {
      if (previewPhotoPathRef.current) {
        RNFS.unlink(stripFileScheme(previewPhotoPathRef.current)).catch(() => undefined);
      }
    };
  }, []);

  // A rolling buffer of recently-seen landmark samples, used at capture time
  // to judge whether the hold was steady — `handleGuideComplete` only sees
  // the single frame at the instant the ring completes, which can't tell a
  // clean hold from a hand that was jittering the whole second before it.
  const samplesRef = useRef<Array<{ landmarks: HandLandmark[]; time: number }>>([]);
  useEffect(() => {
    if (!landmarks) return;
    const now = Date.now();
    samplesRef.current = [...samplesRef.current, { landmarks, time: now }].filter(
      (sample) => now - sample.time <= SAMPLE_WINDOW_MS,
    );
  }, [landmarks]);

  const gloss = label.trim().toUpperCase().replace(/\s+/g, '_');

  const handleFrameLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setFrameSize({ width, height });
  }, []);

  const retake = useCallback(() => {
    setCaptured(false);
    setCapturedLandmarks(null);
    setCapturedFeatures(null);
    setCapturedPhotoUri(null);
    setCaptureError(null);
    setSaveError(null);
    samplesRef.current = [];
    if (previewPhotoPathRef.current) {
      RNFS.unlink(stripFileScheme(previewPhotoPathRef.current)).catch(() => undefined);
      previewPhotoPathRef.current = null;
    }
  }, []);

  const handleGuideComplete = useCallback(async () => {
    const reason = assessCapture(
      landmarks,
      samplesRef.current.map((sample) => sample.landmarks),
    );
    if (reason) {
      setCaptureError(CAPTURE_REJECT_MESSAGES[reason]);
      return;
    }
    // assessCapture already confirmed `landmarks` is a valid 21-point hand,
    // so featureVector succeeding is guaranteed bar exactly-coincident
    // points (scale === 0) — vanishingly unlikely for a real hand, but keep
    // the null-guard rather than assume it away.
    const features = featureVector(landmarks as HandLandmark[]);
    if (!features) {
      setCaptureError(CAPTURE_REJECT_MESSAGES['no-hand']);
      return;
    }
    // Display-only: freezes the frame the hold completed on instead of the black placeholder, so
    // the user can see what they just recorded. Taken before `setCaptured(true)` below, which
    // swaps the live CameraStage out for the placeholder and would tear down the camera view
    // (and its ref) before an after-the-fact capture() call could ever resolve. Never persisted —
    // only the landmarks/features above are saved.
    const rawPhotoUri = await camera.current?.capture();
    const photoUri = rawPhotoUri ? await persistPreviewPhoto(rawPhotoUri) : null;
    // Capture only ever runs right after a `retake()` (or on first mount), both of which have
    // already cleared this ref — nothing to clean up here, just record the new file for later.
    previewPhotoPathRef.current = photoUri;
    setCaptureError(null);
    setCapturedLandmarks(landmarks as HandLandmark[]);
    setCapturedFeatures(features);
    setCapturedPhotoUri(photoUri);
    setCaptured(true);
  }, [landmarks]);

  const commitSave = useCallback(
    async (template: GestureTemplate) => {
      setSaving(true);
      setSaveError(null);
      try {
        await addOrUpdate(template);
        setLabel('');
        retake();
      } catch {
        setSaveError('Could not save this sign. Try again.');
      } finally {
        setSaving(false);
      }
    },
    [addOrUpdate, retake],
  );

  const closeConfirm = useCallback(() => {
    setConfirmingLabelOverwrite(false);
    setPendingTemplate(null);
  }, []);

  const handleLabelOverwriteConfirm = useCallback(async () => {
    if (pendingTemplate) await commitSave(pendingTemplate);
    closeConfirm();
  }, [pendingTemplate, commitSave, closeConfirm]);

  const handleClearAllConfirm = useCallback(async () => {
    setClearingAll(true);
    try {
      await clearAll();
      setConfirmingClearAll(false);
    } catch {
      setSaveError('Could not clear your signs. Try again.');
      setConfirmingClearAll(false);
    } finally {
      setClearingAll(false);
    }
  }, [clearAll]);

  const handleSave = useCallback(async () => {
    if (saving || gloss.length === 0 || !capturedFeatures || !capturedLandmarks) return;
    const template: GestureTemplate = {
      label: gloss,
      created_at: new Date().toISOString(),
      hand_landmarks: capturedLandmarks,
      features: capturedFeatures,
    };

    const decision = classifyGestureSave(userTemplates, BUNDLED_GESTURE_TEMPLATES, gloss);
    if (decision.kind === 'label-collision') {
      setPendingTemplate(template);
      setConfirmingLabelOverwrite(true);
      return;
    }

    await commitSave(template);
  }, [saving, gloss, capturedFeatures, capturedLandmarks, userTemplates, commitSave]);

  const guideSize = Math.min(frameSize.width, frameSize.height) * 0.55;

  return (
    <Screen>
      <AppHeader title="Add custom sign" subtitle="Hold the sign, then name it" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: theme.spacing['4xl'], gap: theme.spacing.xl }}
      >
        <View
          onLayout={handleFrameLayout}
          style={[styles.frame, { borderRadius: theme.radius.xl }]}
        >
          {captured ? (
            <CapturedPlaceholder uri={capturedPhotoUri} />
          ) : (
            <CameraStage
              ref={camera}
              facing="front"
              frameProcessor={frameProcessor}
              style={StyleSheet.absoluteFill}
            >
              {frameSize.width > 0 ? (
                <>
                  <HandSkeleton
                    landmarks={landmarks}
                    width={frameSize.width}
                    height={frameSize.height}
                    mirror
                  />
                  <View style={styles.guideWrap} pointerEvents="none">
                    <SignGuideCircle
                      active={!!landmarks && landmarks.length > 0}
                      size={guideSize}
                      onComplete={handleGuideComplete}
                    />
                  </View>
                </>
              ) : null}
            </CameraStage>
          )}

          {captured ? (
            <View
              style={[
                styles.frameBadge,
                {
                  top: theme.spacing.md,
                  left: theme.spacing.md,
                  gap: theme.spacing.xs,
                  paddingHorizontal: theme.spacing.sm,
                  paddingVertical: theme.spacing.xs,
                },
              ]}
            >
              <Icon name="check" size={14} color="#FFFFFF" />
              <Text variant="caption" style={styles.onDark}>
                Captured
              </Text>
            </View>
          ) : null}
        </View>

        {captured ? (
          <View style={{ gap: theme.spacing.lg }}>
            <TextField
              label="Label this sign"
              placeholder="METFORMIN"
              autoCapitalize="characters"
              autoCorrect={false}
              value={label}
              onChangeText={setLabel}
              hint="One word. This becomes the gloss the recognizer emits."
            />

            {gloss.length > 0 ? (
              <View style={{ gap: theme.spacing.sm }}>
                <Text variant="label" tone="muted">
                  WILL BE SAVED AS
                </Text>
                <GlossChips tokens={[gloss]} tone="accent" />
              </View>
            ) : null}

            {saveError ? (
              <Text variant="caption" tone="danger">
                {saveError}
              </Text>
            ) : null}

            <View style={[styles.actions, { gap: theme.spacing.md }]}>
              <Button label="Retake" variant="secondary" icon="close" onPress={retake} disabled={saving} />
              <Button
                label="Save sign"
                icon="check"
                disabled={gloss.length === 0 || !capturedFeatures || saving}
                busy={saving}
                onPress={handleSave}
                style={styles.grow}
              />
            </View>
          </View>
        ) : (
          <Text variant="caption" tone={captureError ? 'danger' : 'muted'}>
            {captureError ?? 'Hold your sign steady inside the circle — it captures automatically.'}
          </Text>
        )}

        <View style={{ gap: theme.spacing.md }}>
          <View style={styles.signsHeader}>
            <Text variant="label" tone="muted">
              YOUR SIGNS · {userTemplates.length}
            </Text>
            {userTemplates.length > 0 ? (
              <Button
                label="Clear all"
                variant="secondary"
                icon="close"
                onPress={() => setConfirmingClearAll(true)}
              />
            ) : null}
          </View>
          {userTemplates.map((template) => (
            <Card key={template.label} tone="flat">
              <View style={styles.signRow}>
                <GlossChips tokens={[template.label]} size="sm" />
                <Text variant="caption" tone="muted">
                  Recorded
                </Text>
              </View>
            </Card>
          ))}
        </View>
      </ScrollView>

      <ConfirmModal
        visible={confirmingLabelOverwrite}
        title="Sign already exists"
        message={`"${pendingTemplate?.label}" is already saved. Update it with this new recording?`}
        confirmLabel="Update"
        confirmVariant="danger"
        cancelLabel="Cancel"
        onConfirm={handleLabelOverwriteConfirm}
        onCancel={closeConfirm}
      />
      <ConfirmModal
        visible={confirmingClearAll}
        title="Clear all your signs?"
        message={`This deletes all ${userTemplates.length} sign${userTemplates.length === 1 ? '' : 's'} you've recorded. This can't be undone.`}
        confirmLabel="Clear all"
        confirmVariant="danger"
        cancelLabel="Cancel"
        onConfirm={handleClearAllConfirm}
        onCancel={() => (clearingAll ? null : setConfirmingClearAll(false))}
      />
    </Screen>
  );
}

/**
 * The framed box after a successful capture. Shows the frozen camera frame the hold completed
 * on so the user can see what they just recorded — that photo is display-only and is never
 * saved or sent anywhere; only the landmarks/features are persisted. Falls back to the plain
 * icon when there's no real camera to snapshot from (e.g. `capture()` returned `null`).
 */
function CapturedPlaceholder({ uri }: { uri: string | null }) {
  const theme = useTheme();
  if (uri) {
    return <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />;
  }
  return (
    <View style={[styles.placeholder, { gap: theme.spacing.sm }]}>
      <Icon name="sign" size={28} color="rgba(255,255,255,0.6)" />
      <Text variant="caption" style={[styles.onDark, styles.dim]}>
        Sign captured
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    aspectRatio: 3 / 4,
    overflow: 'hidden',
    backgroundColor: '#0B0C0E',
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  frameBadge: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  onDark: { color: '#FFFFFF' },
  dim: { opacity: 0.7 },
  actions: { flexDirection: 'row' },
  grow: { flex: 1 },
  signRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  signsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
