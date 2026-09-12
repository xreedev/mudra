import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { useLocalLlm } from '../llm/useLocalLlm';
import { useLiveHandGestures } from '../recognition/useLiveHandGestures';
import { useAslRelaySender } from '../relay/useAslRelaySender';
import { LocalSpeaker, type SpeakingState } from '../speech/LocalSpeaker';
import { HIT_SLOP_SIZE, useTheme } from '../theme';
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
  // Up to 3 candidate readings for the current draft — genuinely different
  // interpretations (e.g. "you" the driver vs "I" the driver), not 3
  // rewordings of the same meaning, since the glosses alone can't say which
  // role the signer has. `draft` is always one of these (or the raw gloss
  // fallback when the LLM isn't ready); tapping an option in the UI below
  // just changes which one `draft` points at.
  const [draftOptions, setDraftOptions] = useState<string[]>([]);
  const [recognized, setRecognized] = useState<string[]>([]);
  // The CameraStage is styled StyleSheet.absoluteFill over the whole (edge-
  // to-edge) screen, so the window size is the skeleton's coordinate space
  // — reading it this way avoids the race of waiting on an onLayout
  // measurement that can still be 0,0 on the frames the skeleton needs it.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  // Real hand-landmark detection (HandLandmarksFrameProcessorPlugin.kt,
  // wrapping MediaPipe's HandLandmarker) matched against the bundled
  // gesture templates every frame.
  const { frameProcessor, match, landmarks, templates } = useLiveHandGestures();
  const lastAppendedLabel = useRef<string | null>(null);
  const cameraStageRef = useRef<CameraStageHandle>(null);

  // Same-WiFi relay to a second phone (see asl-relay-rn): scans for a receiver advertised on
  // the local network and auto-connects. "Confirm & speak" below speaks locally AND relays the
  // sentence to that phone, so a hearing person can hold the receiving phone instead of needing
  // to be within earshot.
  const relay = useAslRelaySender();
  const [speakingState, setSpeakingState] = useState<SpeakingState>('idle');
  const speaker = useRef(new LocalSpeaker()).current;
  useEffect(() => () => speaker.stop(), [speaker]);

  const speakDraft = useCallback(() => {
    if (!draft.trim()) return;
    speaker.speak(draft, setSpeakingState);
    relay.sendText(draft);
  }, [draft, speaker, relay]);

  // On-device LLM: turns the accumulated gloss sequence ("WHERE", "HOSPITAL")
  // into a fluent sentence ("Where is the hospital?"). Loaded once per app
  // session — see useLocalLlm.ts. Composes over the FULL recognized list on
  // every completed hold, not per-frame: each hold already has a ~1s hold +
  // 1.5s cooldown pause built into SignGuideCircle, so this fires once per
  // deliberately-signed word, with growing context each time, rather than
  // reacting to instantaneous per-frame matches.
  const llm = useLocalLlm();
  const composeRequestId = useRef(0);

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
    if (!zonedMatch?.isKnown || zonedMatch.label === lastAppendedLabel.current) return;

    lastAppendedLabel.current = zonedMatch.label;
    setRecognized((prev) => {
      const updated = [...prev, zonedMatch.label];

      if (llm.status === 'ready') {
        // Compose over the WHOLE sequence so far, not just the new word —
        // "WHERE" alone can't become "Where is the hospital?", but
        // "WHERE HOSPITAL" together can. A race guard (requestId) discards
        // a stale result if the user signs another word before this
        // composition (a real LLM call, ~0.5-1.5s per llm-testbed) returns.
        const requestId = ++composeRequestId.current;
        llm
          .composeSentenceOptions(updated)
          .then((options) => {
            if (composeRequestId.current !== requestId) return;
            setDraftOptions(options);
            setDraft(options[0] ?? updated.join(' '));
          })
          .catch(() => {
            // LLM call failed — fall back to the raw gloss sequence rather
            // than leaving the draft stuck on a stale sentence.
            if (composeRequestId.current === requestId) {
              setDraftOptions([]);
              setDraft(updated.join(' '));
            }
          });
      } else {
        // Model not ready (still loading, missing, or errored) — never
        // block signing on it. Show the raw glosses so the app stays
        // usable; the LLM upgrades this to real options once ready.
        setDraftOptions([]);
        setDraft(updated.join(' '));
      }

      return updated;
    });
  }, [zonedMatch, llm]);

  const active = SEED_CONTACTS.find((entry) => entry.id === contact);

  if (!active) {
    return (
      <ContactPicker
        onSelect={(id) => {
          setRecognized([]);
          lastAppendedLabel.current = null;
          setDraft(DEMO_DRAFT);
          setDraftOptions([]);
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

          <View
            style={[
              styles.callBar,
              { paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md, paddingVertical: theme.spacing.sm },
            ]}
          >
            <IconButton
              name="chevron-left"
              accessibilityLabel="End and go back"
              variant="translucent"
              size={38}
              onPress={() => {
                speaker.stop();
                navigation.goBack();
              }}
            />
            <View style={styles.callBarTitle}>
              <Text variant="bodyStrong" style={styles.onDark}>
                {active.name}
              </Text>
              <Text variant="caption" style={[styles.onDark, styles.dim]}>
                Connected · 00:42
              </Text>
            </View>
            <View
              style={[
                styles.liveBadge,
                {
                  gap: theme.spacing.xs,
                  paddingHorizontal: theme.spacing.sm,
                  paddingVertical: theme.spacing.xs,
                },
              ]}
            >
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

          <View
            style={[
              styles.pillRow,
              { paddingHorizontal: theme.spacing.lg, marginTop: theme.spacing.sm },
            ]}
          >
            <View style={[styles.pill, { paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs }]}>
              <Text variant="caption" style={styles.onDark}>
                Signing · {templates.length} templates on device
              </Text>
            </View>
            {relay.available ? (
              <View
                style={[
                  styles.pill,
                  {
                    marginLeft: theme.spacing.sm,
                    paddingHorizontal: theme.spacing.sm,
                    paddingVertical: theme.spacing.xs,
                  },
                ]}
              >
                <Text variant="caption" style={styles.onDark}>
                  {relay.status === 'connected' && `Relay · sending to ${relay.peerName}`}
                  {relay.status === 'scanning' && 'Relay · looking for a receiver phone'}
                  {relay.status === 'connecting' && 'Relay · connecting…'}
                  {relay.status === 'disconnected' && 'Relay · not connected'}
                </Text>
              </View>
            ) : null}
            {llm.status !== 'ready' ? (
              <View
                style={[
                  styles.pill,
                  {
                    marginLeft: theme.spacing.sm,
                    paddingHorizontal: theme.spacing.sm,
                    paddingVertical: theme.spacing.xs,
                  },
                ]}
              >
                <Text variant="caption" style={styles.onDark}>
                  {llm.status === 'loading' && 'Loading on-device LLM…'}
                  {llm.status === 'checking' && 'Checking for on-device model…'}
                  {llm.status === 'missing' && 'LLM model not found — showing raw signs'}
                  {llm.status === 'error' && 'LLM failed to load — showing raw signs'}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.spacer} />

          <View
            style={[
              styles.chrome,
              {
                paddingHorizontal: theme.spacing.lg,
                paddingTop: theme.spacing.xl,
                paddingBottom: theme.spacing.sm,
                borderTopLeftRadius: theme.radius['2xl'],
                borderTopRightRadius: theme.radius['2xl'],
                gap: theme.spacing.md,
              },
            ]}
          >
            {recognized.length > 0 ? (
              <View style={{ gap: theme.spacing.xs }}>
                <Text variant="caption" style={[styles.onDark, styles.dim]}>
                  RECOGNIZED
                </Text>
                <GlossBubbles tokens={recognized} />
              </View>
            ) : null}

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

              {draftOptions.length > 1 ? (
                // The glosses alone can't say whether the signer is the
                // customer or the driver ("ARRIVED HOME RIGHT LEFT" means
                // opposite things either way) — rather than the LLM
                // silently guessing, it offers a few genuinely different
                // readings and the person picks the one matching their
                // actual situation. Same confirmation-gate idea as the rest
                // of the app: the LLM proposes, the human confirms.
                <View style={{ gap: theme.spacing.xs, marginTop: theme.spacing.md }}>
                  <Text variant="label" style={[styles.onDark, styles.dim]}>
                    WHO'S SPEAKING? PICK ONE
                  </Text>
                  {draftOptions.map((option, index) => {
                    const selected = option === draft;
                    return (
                      <Pressable
                        key={`${option}-${index}`}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => setDraft(option)}
                        style={[
                          styles.optionRow,
                          {
                            borderRadius: theme.radius.md,
                            borderColor: selected ? theme.colors.accent : 'rgba(255,255,255,0.25)',
                            backgroundColor: selected ? theme.colors.accentSoft : 'transparent',
                            gap: theme.spacing.sm,
                            paddingHorizontal: theme.spacing.md,
                            paddingVertical: theme.spacing.sm,
                          },
                        ]}
                      >
                        {selected ? (
                          <Icon name="check" size={16} color={theme.colors.accent} />
                        ) : (
                          <View style={styles.optionCheckSpacer} />
                        )}
                        <Text
                          variant="body"
                          style={[styles.optionText, selected ? undefined : styles.onDark]}
                          tone={selected ? 'accent' : undefined}
                        >
                          {option}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              <View
                style={[
                  styles.draftActions,
                  { marginTop: theme.spacing.md, gap: theme.spacing.sm },
                ]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Reset draft"
                  onPress={() => {
                    setDraft(DEMO_DRAFT);
                    setDraftOptions([]);
                  }}
                  hitSlop={6}
                  style={styles.textAction}
                >
                  <Text variant="caption" tone="accent">
                    Reset
                  </Text>
                </Pressable>
                <Text variant="caption" style={[styles.onDark, styles.dim]}>
                  ·
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear draft"
                  onPress={() => {
                    setDraft('');
                    setDraftOptions([]);
                  }}
                  hitSlop={6}
                  style={styles.textAction}
                >
                  <Text variant="caption" tone="accent">
                    Clear
                  </Text>
                </Pressable>
              </View>
            </View>

            <Button
              label={speakingState === 'speaking' ? 'Stop' : 'Confirm & speak'}
              icon={speakingState === 'speaking' ? 'stop' : 'check'}
              size="lg"
              block
              disabled={draft.trim().length === 0}
              onPress={() => (speakingState === 'speaking' ? speaker.stop() : speakDraft())}
            />
            {speakingState === 'unavailable' ? (
              <Text variant="caption" style={[styles.onDark, styles.dim]}>
                Voice output needs a development build with react-native-tts linked.
              </Text>
            ) : null}

            <View style={[styles.controls, { gap: theme.spacing['2xl'] }]}>
              <IconButton
                name={muted ? 'mic-off' : 'mic'}
                accessibilityLabel={muted ? 'Unmute' : 'Mute'}
                selected={muted}
                variant={muted ? 'accent' : 'translucent'}
                size={52}
                onPress={() => setMuted(!muted)}
              />
              <IconButton
                name="close"
                accessibilityLabel="End call"
                variant="danger"
                size={64}
                onPress={() => {
                  speaker.stop();
                  navigation.goBack();
                }}
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
                gap: theme.spacing.md,
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
            <View style={[styles.contactText, { gap: theme.spacing.xs / 2 }]}>
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
                gap: theme.spacing.md,
                marginTop: theme.spacing.sm,
                backgroundColor: theme.colors.dangerSoft,
                borderColor: theme.colors.danger,
                borderRadius: theme.radius.lg,
                padding: theme.spacing.lg,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <View style={[styles.contactText, { gap: theme.spacing.xs / 2 }]}>
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
  },
  callBarTitle: { flex: 1 },
  onDark: { color: '#FFFFFF' },
  dim: { opacity: 0.7 },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  /** Everything floats over the full-bleed camera: call bar pinned top, chrome
   *  pinned bottom, the middle left empty so the live preview stays visible. */
  overlay: { flex: 1, justifyContent: 'flex-start' },
  pillRow: { flexDirection: 'row' },
  pill: {
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  spacer: { flex: 1 },
  /** A translucent scrim behind ALL the floating bottom chrome, not just the
   *  draft text — bare text over unpredictable live video is unreadable, the
   *  same reason every real video-call UI (FaceTime, WhatsApp) scrims its
   *  overlay chrome rather than relying on per-element panels. Still shows
   *  the camera through it, unlike the old opaque bottom sheet. */
  chrome: { backgroundColor: 'rgba(0,0,0,0.4)' },
  /** A slightly darker panel just for the draft text, so the sentence that's
   *  about to be spoken reads as the clear focal point of the chrome. */
  draftPanel: { backgroundColor: 'rgba(0,0,0,0.35)' },
  draftActions: { flexDirection: 'row', alignItems: 'center' },
  textAction: { minHeight: HIT_SLOP_SIZE, justifyContent: 'center' },
  optionRow: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth * 2 },
  optionCheckSpacer: { width: 16 },
  optionText: { flex: 1 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  avatar: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  contactText: { flex: 1 },
});
