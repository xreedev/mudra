import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CameraStage,
  GlossChips,
  Icon,
  IconButton,
  Screen,
  Text,
} from '../components';
import { DEMO_RECOGNIZED, DEMO_SENTENCE_OPTIONS } from '../data/mock';
import { LocalSpeaker } from '../speech/LocalSpeaker';
import { useTheme } from '../theme';
import type { ScreenProps } from '../navigation/types';

/**
 * Talk Aloud.
 *
 * Same camera-first layout as Call Someone — signing is still the input method — but there is no
 * call partner to confirm a single draft with, so the LLM's candidate phrasings are shown as a
 * list instead. Tapping one speaks it immediately through the phone's own speaker: the gate here
 * is picking the right sentence, not a separate confirm step.
 */
export function TalkAloudScreen({ navigation }: ScreenProps<'TalkAloud'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [muted, setMuted] = useState(false);
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [voiceUnavailable, setVoiceUnavailable] = useState(false);
  const speaker = useRef(new LocalSpeaker()).current;

  useEffect(() => () => speaker.stop(), [speaker]);

  const toggleSpeak = (index: number, sentence: string) => {
    if (speakingIndex === index) {
      speaker.stop();
      setSpeakingIndex(null);
      return;
    }

    speaker.speak(sentence, (state) => {
      if (state === 'speaking') {
        setVoiceUnavailable(false);
        setSpeakingIndex(index);
      } else if (state === 'unavailable') {
        setVoiceUnavailable(true);
        setSpeakingIndex(null);
      } else {
        setSpeakingIndex((current) => (current === index ? null : current));
      }
    });
  };

  return (
    <Screen dark edgeToEdge>
      <View style={[styles.topBar, { paddingHorizontal: theme.spacing.lg }]}>
        <IconButton
          name="chevron-left"
          accessibilityLabel="Go back"
          variant="translucent"
          size={38}
          onPress={() => navigation.goBack()}
        />
        <View style={styles.topBarTitle}>
          <Text variant="bodyStrong" style={styles.onDark}>
            Talk Aloud
          </Text>
          <Text variant="caption" style={[styles.onDark, styles.dim]}>
            Sign, then pick a sentence to speak
          </Text>
        </View>
        <View style={styles.deviceBadge}>
          <Icon name="volume" size={14} color="#FFFFFF" />
          <Text variant="caption" style={styles.onDark}>
            ON DEVICE
          </Text>
        </View>
      </View>

      <CameraStage facing={facing} rounded={false} style={styles.preview}>
        <View style={[styles.previewOverlay, { padding: theme.spacing.lg }]}>
          <View style={styles.overlayTop}>
            <View style={styles.pill}>
              <Text variant="caption" style={styles.onDark}>
                Signing · on device
              </Text>
            </View>
          </View>
          <View style={styles.overlayBottom}>
            <IconButton
              name="flip"
              accessibilityLabel="Switch camera"
              variant="translucent"
              size={40}
              onPress={() => setFacing(facing === 'front' ? 'back' : 'front')}
            />
          </View>
        </View>
      </CameraStage>

      <View
        style={[
          styles.sheet,
          {
            backgroundColor: theme.colors.background,
            borderTopLeftRadius: theme.radius['2xl'],
            borderTopRightRadius: theme.radius['2xl'],
            padding: theme.spacing.xl,
            paddingBottom: insets.bottom + theme.spacing.lg,
            gap: theme.spacing.lg,
          },
        ]}
      >
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" tone="muted">
            RECOGNIZED
          </Text>
          <GlossChips tokens={DEMO_RECOGNIZED} tone="accent" />
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" tone="muted">
            CHOOSE WHAT TO SAY
          </Text>
          <View style={{ gap: theme.spacing.sm }}>
            {DEMO_SENTENCE_OPTIONS.map((sentence, index) => {
              const speaking = speakingIndex === index;
              return (
                <Pressable
                  key={sentence}
                  accessibilityRole="button"
                  accessibilityLabel={speaking ? `Stop speaking: ${sentence}` : `Speak: ${sentence}`}
                  onPress={() => toggleSpeak(index, sentence)}
                  style={({ pressed }) => [
                    styles.sentenceRow,
                    {
                      backgroundColor: speaking ? theme.colors.accentSoft : theme.colors.surfaceRaised,
                      borderColor: speaking ? theme.colors.accent : theme.colors.border,
                      borderRadius: theme.radius.lg,
                      padding: theme.spacing.lg,
                      opacity: pressed ? 0.88 : 1,
                    },
                  ]}
                >
                  <Text variant="body" style={styles.sentenceText}>
                    {sentence}
                  </Text>
                  <View
                    style={[
                      styles.speakBadge,
                      {
                        backgroundColor: speaking ? theme.colors.accent : theme.colors.surface,
                        borderRadius: theme.radius.md,
                      },
                    ]}
                  >
                    <Icon
                      name={speaking ? 'stop' : 'volume'}
                      size={18}
                      color={speaking ? theme.colors.accentText : theme.colors.text}
                    />
                  </View>
                </Pressable>
              );
            })}
          </View>
          {voiceUnavailable ? (
            <Text variant="caption" tone="muted">
              Voice output needs a development build with react-native-tts linked.
            </Text>
          ) : null}
        </View>

        <View style={styles.controls}>
          <IconButton
            name="mic-off"
            accessibilityLabel={muted ? 'Unmute' : 'Mute'}
            variant={muted ? 'accent' : 'surface'}
            size={52}
            onPress={() => setMuted(!muted)}
          />
          <IconButton
            name="close"
            accessibilityLabel="Done"
            variant="danger"
            size={64}
            onPress={() => {
              speaker.stop();
              navigation.goBack();
            }}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  topBarTitle: { flex: 1 },
  onDark: { color: '#FFFFFF' },
  dim: { opacity: 0.7 },
  deviceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  preview: { flex: 1 },
  previewOverlay: { flex: 1, justifyContent: 'space-between' },
  overlayTop: { flexDirection: 'row' },
  overlayBottom: { flexDirection: 'row', justifyContent: 'flex-end' },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: { marginTop: -24 },
  sentenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  sentenceText: { flex: 1 },
  speakBadge: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
  },
});
