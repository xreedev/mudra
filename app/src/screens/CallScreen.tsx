import React, { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  CameraStage,
  type CameraStageHandle,
  GlossBubbles,
  HandSkeleton,
  Icon,
  IconButton,
  Screen,
  SignGuideCircle,
  Text,
} from '../components';
import { DEMO_DRAFT, SEED_CONTACTS } from '../data/mock';
import { BUNDLED_GESTURE_TEMPLATES } from '../recognition';
import { useLiveHandGestures } from '../recognition/useLiveHandGestures';
import { useTheme } from '../theme';
import type { ScreenProps } from '../navigation/types';

/**
 * Call someone.
 *
 * Two states, one screen: pick who to call, then the live call. Live layout is a
 * full-bleed camera behind everything — signing is the input method, so the preview
 * gets the whole screen — with the call bar, recognized glosses, draft sentence, and
 * call controls floating on top of it as translucent overlays, the way a normal video
 * call's chrome floats over the video rather than displacing it.
 *
 * The draft is never spoken until "Confirm & speak" is pressed. That gate is the whole safety
 * model of the product, so it is a full-width primary button and nothing sits near it.
 */

/** Diameter of the white placement guide — kept in sync with the rectangle below. */
const GUIDE_SIZE = 300;
/** How far the detection zone extends above/below the circle. Full screen width,
 *  just a taller band than the circle itself — a hand anywhere sideways in frame
 *  still counts as long as it's roughly at sign height, but a hand held too low
 *  or too high (e.g. resting at your side, or waving near your face) doesn't. */
const ZONE_PADDING = 50;

export function CallScreen({ navigation }: ScreenProps<'Call'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [contact, setContact] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [draft, setDraft] = useState(DEMO_DRAFT);
  const [recognized, setRecognized] = useState<string[]>([]);
  // The CameraStage is styled StyleSheet.absoluteFill over the whole (edge-
  // to-edge) screen, so the window size is the skeleton's coordinate space
  // — reading it this way avoids the race of waiting on an onLayout
  // measurement that can still be 0,0 on the frames the skeleton needs it.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  // Real hand-landmark detection (HandLandmarksFrameProcessorPlugin.kt,
  // wrapping MediaPipe's HandLandmarker) matched against the bundled
  // gesture templates every frame.
  const { frameProcessor, match, landmarks } = useLiveHandGestures();
  const lastAppendedLabel = useRef<string | null>(null);
  const cameraStageRef = useRef<CameraStageHandle>(null);

  // Detection zone: full screen width, a band centered on the guide circle
  // but taller than it. A hand is only "detected" for the guide ring and
  // recognition if its wrist falls inside this band — MediaPipe itself
  // still runs on the whole frame, but a hand elsewhere in shot (resting,
  // passing through background) is ignored rather than triggering a hold.
  const zoneHalfHeight = GUIDE_SIZE / 2 + ZONE_PADDING;
  const zoneTop = windowHeight / 2 - zoneHalfHeight;
  const zoneBottom = windowHeight / 2 + zoneHalfHeight;
  const wrist = landmarks?.[0] ?? null;
  const inZone = !!wrist && wrist.y * windowHeight >= zoneTop && wrist.y * windowHeight <= zoneBottom;
  const zonedLandmarks = inZone ? landmarks : null;
  const zonedMatch = inZone ? match : null;
  const handDetected = !!zonedLandmarks && zonedLandmarks.length > 0;

  const handleGuideComplete = useCallback(() => {
    // The white guide ring completing a hold is the "shutter" — snapshot
    // whatever sign is being held at that instant and process it, rather
    // than appending on every frame a match happens to be known (that
    // produced duplicate/jittery entries as a held sign kept re-matching).
    cameraStageRef.current?.capture();
    if (zonedMatch?.isKnown && zonedMatch.label !== lastAppendedLabel.current) {
      lastAppendedLabel.current = zonedMatch.label;
      setRecognized((prev) => [...prev, zonedMatch.label]);
      setDraft(zonedMatch.label);
    }
  }, [zonedMatch]);

  const active = SEED_CONTACTS.find((entry) => entry.id === contact);

  if (!active) {
    return (
      <ContactPicker
        onSelect={(id) => {
          setRecognized([]);
          lastAppendedLabel.current = null;
          setDraft(DEMO_DRAFT);
          setContact(id);
        }}
      />
    );
  }

  return (
    <Screen dark edgeToEdge>
      <CameraStage
        ref={cameraStageRef}
        facing={facing}
        rounded={false}
        placeholderAlign="top"
        frameProcessor={frameProcessor}
        style={StyleSheet.absoluteFill}
      >
        <View
          style={[
            styles.overlay,
            { paddingTop: insets.top, paddingBottom: insets.bottom },
          ]}
        >
          <HandSkeleton
            landmarks={zonedLandmarks}
            width={windowWidth}
            height={windowHeight}
            mirror={facing === 'front'}
          />

          <View
            pointerEvents="none"
            style={[
              styles.zone,
              { top: zoneTop, height: zoneHalfHeight * 2 },
            ]}
          />

          <View style={styles.guideWrap} pointerEvents="none">
            <SignGuideCircle active={handDetected} size={GUIDE_SIZE} onComplete={handleGuideComplete} />
          </View>

          <View style={[styles.callBar, { paddingHorizontal: theme.spacing.lg }]}>
            <IconButton
              name="chevron-left"
              accessibilityLabel="End and go back"
              variant="translucent"
              size={38}
              onPress={() => navigation.goBack()}
            />
            <View style={styles.callBarTitle}>
              <Text variant="bodyStrong" style={styles.onDark}>
                {active.name}
              </Text>
              <Text variant="caption" style={[styles.onDark, styles.dim]}>
                Connected · 00:42
              </Text>
            </View>
            <View style={styles.liveBadge}>
              <View style={[styles.liveDot, { backgroundColor: theme.colors.danger }]} />
              <Text variant="caption" style={styles.onDark}>
                LIVE
              </Text>
            </View>
            <IconButton
              name="flip"
              accessibilityLabel="Switch camera"
              variant="translucent"
              size={38}
              onPress={() => setFacing(facing === 'front' ? 'back' : 'front')}
            />
          </View>

          <View style={[styles.pillRow, { paddingHorizontal: theme.spacing.lg }]}>
            <View style={styles.pill}>
              <Text variant="caption" style={styles.onDark}>
                Signing · {BUNDLED_GESTURE_TEMPLATES.length} templates on device
              </Text>
            </View>
          </View>

          <View style={styles.spacer} />

          <View
            style={[
              styles.chrome,
              {
                paddingHorizontal: theme.spacing.lg,
                paddingTop: theme.spacing.xl,
                borderTopLeftRadius: theme.radius['2xl'],
                borderTopRightRadius: theme.radius['2xl'],
                gap: theme.spacing.md,
              },
            ]}
          >
            <View style={{ gap: theme.spacing.sm }}>
              <Text variant="label" style={[styles.onDark, styles.dim]}>
                RECOGNIZED
              </Text>
              <GlossBubbles tokens={recognized} />
            </View>

            <View
              style={[
                styles.draftPanel,
                { borderRadius: theme.radius.lg, padding: theme.spacing.lg },
              ]}
            >
              <Text variant="label" style={[styles.onDark, styles.dim]}>
                WILL BE SPOKEN
              </Text>
              <Text variant="heading" style={[styles.onDark, { marginTop: theme.spacing.sm }]}>
                {draft}
              </Text>
              <View style={[styles.draftActions, { marginTop: theme.spacing.md }]}>
                <Pressable onPress={() => setDraft(DEMO_DRAFT)} hitSlop={8}>
                  <Text variant="caption" tone="accent">
                    Reset
                  </Text>
                </Pressable>
                <Text variant="caption" style={[styles.onDark, styles.dim]}>
                  ·
                </Text>
                <Pressable onPress={() => setDraft('')} hitSlop={8}>
                  <Text variant="caption" tone="accent">
                    Clear
                  </Text>
                </Pressable>
              </View>
            </View>

            <Button
              label="Confirm & speak"
              icon="check"
              size="lg"
              block
              disabled={draft.trim().length === 0}
              onPress={() => undefined}
            />

            <View style={styles.controls}>
              <IconButton
                name="mic-off"
                accessibilityLabel={muted ? 'Unmute' : 'Mute'}
                variant={muted ? 'accent' : 'translucent'}
                size={52}
                onPress={() => setMuted(!muted)}
              />
              <IconButton
                name="close"
                accessibilityLabel="End call"
                variant="danger"
                size={64}
                onPress={() => navigation.goBack()}
              />
              <IconButton
                name="chat"
                accessibilityLabel="Show transcript"
                variant="translucent"
                size={52}
                onPress={() => undefined}
              />
            </View>
          </View>
        </View>
      </CameraStage>
    </Screen>
  );
}

/** Who to call. An emergency contact is visually separated so it cannot be hit by accident. */
function ContactPicker({ onSelect }: { onSelect: (id: string) => void }) {
  const theme = useTheme();

  return (
    <Screen scroll>
      <View style={{ paddingTop: theme.spacing.lg }}>
        <Text variant="title">Call someone</Text>
        <Text variant="body" tone="muted" style={{ marginTop: theme.spacing.xs }}>
          Pick who to reach. You will confirm every sentence before it is spoken.
        </Text>
      </View>

      <View style={{ gap: theme.spacing.md, marginTop: theme.spacing['2xl'] }}>
        {SEED_CONTACTS.filter((entry) => !entry.emergency).map((entry) => (
          <Pressable
            key={entry.id}
            accessibilityRole="button"
            accessibilityLabel={`Call ${entry.name}`}
            onPress={() => onSelect(entry.id)}
            style={({ pressed }) => [
              styles.contactRow,
              {
                backgroundColor: theme.colors.surfaceRaised,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.lg,
                padding: theme.spacing.lg,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <View
              style={[
                styles.avatar,
                { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md },
              ]}
            >
              <Text variant="bodyStrong">{entry.name.slice(0, 1)}</Text>
            </View>
            <View style={styles.contactText}>
              <Text variant="bodyStrong">{entry.name}</Text>
              <Text variant="caption" tone="muted">
                {entry.detail}
              </Text>
            </View>
            <Icon name="chevron-right" size={20} color={theme.colors.textMuted} />
          </Pressable>
        ))}
      </View>

      {SEED_CONTACTS.filter((entry) => entry.emergency).map((entry) => (
        <View key={entry.id} style={{ marginTop: theme.spacing['3xl'] }}>
          <Text variant="label" tone="muted">
            EMERGENCY
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Call ${entry.name}`}
            onPress={() => onSelect(entry.id)}
            style={({ pressed }) => [
              styles.contactRow,
              {
                marginTop: theme.spacing.sm,
                backgroundColor: theme.colors.dangerSoft,
                borderColor: theme.colors.danger,
                borderRadius: theme.radius.lg,
                padding: theme.spacing.lg,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <View style={styles.contactText}>
              <Text variant="bodyStrong" tone="danger">
                {entry.name}
              </Text>
              <Text variant="caption" tone="muted">
                {entry.detail} · asks you to confirm twice
              </Text>
            </View>
            <Icon name="chevron-right" size={20} color={theme.colors.danger} />
          </Pressable>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  /** Centers the placement guide over the live preview, above the call bar
   *  and chrome but stacked below them here so those overlays' own touch
   *  targets still win — the guide itself is pointerEvents="none". */
  guideWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  /** Faint outline marking the active detection band — full width, taller
   *  than the guide circle it surrounds. */
  zone: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  callBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  callBarTitle: { flex: 1 },
  onDark: { color: '#FFFFFF' },
  dim: { opacity: 0.7 },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  /** Everything floats over the full-bleed camera: call bar pinned top, chrome
   *  pinned bottom, the middle left empty so the live preview stays visible. */
  overlay: { flex: 1, justifyContent: 'flex-start' },
  pillRow: { flexDirection: 'row', marginTop: 10 },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  spacer: { flex: 1 },
  /** A translucent scrim behind ALL the floating bottom chrome, not just the
   *  draft text — bare text over unpredictable live video is unreadable, the
   *  same reason every real video-call UI (FaceTime, WhatsApp) scrims its
   *  overlay chrome rather than relying on per-element panels. Still shows
   *  the camera through it, unlike the old opaque bottom sheet. */
  chrome: { paddingBottom: 8, backgroundColor: 'rgba(0,0,0,0.4)' },
  /** A slightly darker panel just for the draft text, so the sentence that's
   *  about to be spoken reads as the clear focal point of the chrome. */
  draftPanel: { backgroundColor: 'rgba(0,0,0,0.35)' },
  draftActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  avatar: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  contactText: { flex: 1, gap: 2 },
});
