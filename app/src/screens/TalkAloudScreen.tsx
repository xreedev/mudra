import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  CameraStage,
  type CameraStageHandle,
  GlossBubbles,
  HandSkeleton,
  IconButton,
  Screen,
  SignGuideCircle,
  Text,
} from '../components';
import { DEMO_DRAFT } from '../data/mock';
import { getRememberedSentence, rememberSentenceChoice, withRememberedSentence } from '../llm';
import { useLocalLlm } from '../llm/useLocalLlm';
import { BUNDLED_GESTURE_TEMPLATES } from '../recognition';
import { useLiveHandGestures } from '../recognition/useLiveHandGestures';
import { LocalSpeaker, type SpeakingState } from '../speech/LocalSpeaker';
import { HIT_SLOP_SIZE, useTheme } from '../theme';
import type { ScreenProps } from '../navigation/types';

/**
 * Talk Aloud.
 *
 * The same live full-bleed signing view as Call Someone — real on-device hand-landmark
 * recognition feeding the on-device LLM, which composes candidate sentences from the recognized
 * glosses — but there is no call partner to speak to, so there is no contact step and no call
 * chrome. Instead, picking one of the candidate sentences speaks it immediately through the
 * phone's own speaker: the sentence list itself is the confirmation gate, the same role
 * "Confirm & speak" plays on a call.
 */

/** Diameter of the white placement guide — kept in sync with the rectangle below. */
const GUIDE_SIZE = 300;
/** How far the detection zone extends above/below the circle. Full screen width, just a taller
 *  band than the circle itself — a hand anywhere sideways in frame still counts as long as it's
 *  roughly at sign height, but a hand held too low or too high doesn't. */
const ZONE_PADDING = 50;

export function TalkAloudScreen({ navigation }: ScreenProps<'TalkAloud'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [muted, setMuted] = useState(false);
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [draft, setDraft] = useState(DEMO_DRAFT);
  // Candidate readings for the current draft: a remembered pick for this exact sign sequence (if
  // any) leads, then up to 2 fresh LLM readings — same ambiguity the call screen resolves by
  // letting the person pick — here, picking one also speaks it.
  const [draftOptions, setDraftOptions] = useState<string[]>([]);
  const [recognized, setRecognized] = useState<string[]>([]);
  const [spoken, setSpoken] = useState<string | null>(null);
  const [speakingState, setSpeakingState] = useState<SpeakingState>('idle');
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const { frameProcessor, match, landmarks } = useLiveHandGestures();
  const lastAppendedLabel = useRef<string | null>(null);
  const cameraStageRef = useRef<CameraStageHandle>(null);
  const speaker = useRef(new LocalSpeaker()).current;

  const llm = useLocalLlm();
  const composeRequestId = useRef(0);

  useEffect(() => () => speaker.stop(), [speaker]);

  const zoneHalfHeight = GUIDE_SIZE / 2 + ZONE_PADDING;
  const zoneTop = windowHeight / 2 - zoneHalfHeight;
  const wrist = landmarks?.[0] ?? null;
  const inZone = !!wrist && wrist.y * windowHeight >= zoneTop && wrist.y * windowHeight <= zoneTop + zoneHalfHeight * 2;
  const zonedLandmarks = inZone ? landmarks : null;
  const zonedMatch = inZone ? match : null;
  const handDetected = !!zonedLandmarks && zonedLandmarks.length > 0;

  const speak = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      speaker.speak(text, (state) => {
        setSpeakingState(state);
        setSpoken(state === 'idle' ? null : text);
      });
    },
    [speaker],
  );

  // Once a sentence is picked & spoken, the recognized-signs panel closes
  // and the draft resets — that's the end of the "turn", so the next sign
  // starts a fresh sequence rather than appending onto the one just spoken.
  // Also invalidates any in-flight compose so a late-arriving result can't
  // repopulate the panel right after it closes.
  const resetRecognition = useCallback(() => {
    composeRequestId.current += 1;
    lastAppendedLabel.current = null;
    setRecognized([]);
    setDraftOptions([]);
    setDraft(DEMO_DRAFT);
  }, []);

  // Speaking a sentence out of the candidate list IS the confirmation
  // gate here (see the screen doc comment) — so that tap is also the
  // moment the pick is remembered for this exact sign sequence, and the
  // moment the recognized-signs panel closes for the next one.
  const speakAndRemember = useCallback(
    (text: string) => {
      speak(text);
      rememberSentenceChoice(recognized, text).catch(() => undefined);
      resetRecognition();
    },
    [speak, recognized, resetRecognition],
  );

  const handleGuideComplete = useCallback(() => {
    cameraStageRef.current?.capture();
    if (!zonedMatch?.isKnown || zonedMatch.label === lastAppendedLabel.current) return;

    lastAppendedLabel.current = zonedMatch.label;
    setRecognized((prev) => {
      const updated = [...prev, zonedMatch.label];
      const requestId = ++composeRequestId.current;

      (async () => {
        // Independent of the LLM: has the user picked a sentence for this
        // EXACT sign sequence before? If so it always leads the list.
        const remembered = await getRememberedSentence(updated).catch(() => undefined);
        if (composeRequestId.current !== requestId) return;

        if (llm.status === 'ready') {
          try {
            const options = await llm.composeSentenceOptions(updated);
            if (composeRequestId.current !== requestId) return;
            const merged = withRememberedSentence(remembered, options);
            setDraftOptions(merged);
            setDraft(merged[0] ?? updated.join(' '));
          } catch {
            if (composeRequestId.current !== requestId) return;
            const merged = withRememberedSentence(remembered, []);
            setDraftOptions(merged);
            setDraft(merged[0] ?? updated.join(' '));
          }
        } else {
          const merged = withRememberedSentence(remembered, []);
          setDraftOptions(merged);
          setDraft(merged[0] ?? updated.join(' '));
        }
      })();

      return updated;
    });
  }, [zonedMatch, llm]);

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
        <View style={[styles.overlay, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <HandSkeleton
            landmarks={zonedLandmarks}
            width={windowWidth}
            height={windowHeight}
            mirror={facing === 'front'}
          />

          <View pointerEvents="none" style={[styles.zone, { top: zoneTop, height: zoneHalfHeight * 2 }]} />

          <View style={styles.guideWrap} pointerEvents="none">
            <SignGuideCircle active={handDetected} size={GUIDE_SIZE} onComplete={handleGuideComplete} />
          </View>

          <View
            style={[
              styles.topBar,
              { paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md, paddingVertical: theme.spacing.sm },
            ]}
          >
            <IconButton
              name="chevron-left"
              accessibilityLabel="Go back"
              variant="translucent"
              size={38}
              onPress={() => {
                speaker.stop();
                navigation.goBack();
              }}
            />
            <View style={styles.topBarTitle}>
              <Text variant="bodyStrong" style={styles.onDark}>
                Talk Aloud
              </Text>
              <Text variant="caption" style={[styles.onDark, styles.dim]}>
                Sign, then pick a sentence to hear it
              </Text>
            </View>
            <View
              style={[
                styles.deviceBadge,
                { paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs },
              ]}
            >
              <Text variant="caption" style={styles.onDark}>
                ON DEVICE
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
                Signing · {BUNDLED_GESTURE_TEMPLATES.length} templates on device
              </Text>
            </View>
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

            <View style={[styles.draftPanel, { borderRadius: theme.radius.lg, padding: theme.spacing.lg }]}>
              <Text variant="label" style={[styles.onDark, styles.dim]}>
                TAP A SENTENCE TO HEAR IT
              </Text>

              {[draft, ...draftOptions.filter((option) => option !== draft)].map((sentence, index) => {
                if (!sentence.trim()) return null;
                const speaking = speakingState === 'speaking' && spoken === sentence;
                return (
                  <Pressable
                    key={`${sentence}-${index}`}
                    accessibilityRole="button"
                    accessibilityLabel={speaking ? `Stop speaking: ${sentence}` : `Speak: ${sentence}`}
                    onPress={() => (speaking ? speaker.stop() : speakAndRemember(sentence))}
                    style={[
                      styles.optionRow,
                      {
                        borderRadius: theme.radius.md,
                        borderColor: speaking ? theme.colors.accent : 'rgba(255,255,255,0.25)',
                        backgroundColor: speaking ? theme.colors.accentSoft : 'transparent',
                        marginTop: index === 0 ? theme.spacing.sm : theme.spacing.xs,
                        gap: theme.spacing.sm,
                        paddingHorizontal: theme.spacing.md,
                        paddingVertical: theme.spacing.sm,
                      },
                    ]}
                  >
                    <Text
                      variant={index === 0 ? 'heading' : 'body'}
                      style={[styles.optionText, speaking ? undefined : styles.onDark]}
                      tone={speaking ? 'accent' : undefined}
                    >
                      {sentence}
                    </Text>
                    <IconButton
                      name={speaking ? 'stop' : 'volume'}
                      accessibilityLabel={speaking ? 'Stop' : 'Speak this sentence'}
                      variant={speaking ? 'accent' : 'translucent'}
                      size={36}
                      onPress={() => (speaking ? speaker.stop() : speakAndRemember(sentence))}
                    />
                  </Pressable>
                );
              })}

              {speakingState === 'unavailable' ? (
                <Text variant="caption" style={[styles.onDark, styles.dim, { marginTop: theme.spacing.sm }]}>
                  Voice output needs a development build with react-native-tts linked.
                </Text>
              ) : null}

              <View style={[styles.draftActions, { marginTop: theme.spacing.md, gap: theme.spacing.sm }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Reset draft"
                  onPress={() => {
                    speaker.stop();
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
                    speaker.stop();
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
              label={speakingState === 'speaking' ? 'Stop' : 'Speak draft'}
              icon={speakingState === 'speaking' ? 'stop' : 'volume'}
              size="lg"
              block
              disabled={draft.trim().length === 0}
              onPress={() => (speakingState === 'speaking' ? speaker.stop() : speakAndRemember(draft))}
            />

            <View style={[styles.controls, { gap: theme.spacing['2xl'] }]}>
              <IconButton
                name={muted ? 'mic-off' : 'mic'}
                accessibilityLabel={muted ? 'Unmute' : 'Mute'}
                selected={muted}
                variant={muted ? 'accent' : 'translucent'}
                size={52}
                onPress={() => setMuted(!muted)}
              />
            </View>
          </View>
        </View>
      </CameraStage>
    </Screen>
  );
}

const styles = StyleSheet.create({
  guideWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  zone: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  topBar: { flexDirection: 'row', alignItems: 'center' },
  topBarTitle: { flex: 1 },
  onDark: { color: '#FFFFFF' },
  dim: { opacity: 0.7 },
  deviceBadge: {
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  overlay: { flex: 1, justifyContent: 'flex-start' },
  pillRow: { flexDirection: 'row' },
  pill: {
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  spacer: { flex: 1 },
  chrome: { backgroundColor: 'rgba(0,0,0,0.4)' },
  draftPanel: { backgroundColor: 'rgba(0,0,0,0.35)' },
  draftActions: { flexDirection: 'row', alignItems: 'center' },
  textAction: { minHeight: HIT_SLOP_SIZE, justifyContent: 'center' },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  optionText: { flex: 1 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
