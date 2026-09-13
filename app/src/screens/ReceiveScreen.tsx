import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, PermissionsAndroid, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, IconButton, Screen, Text } from '../components';
import { useAslRelayReceiver } from '../relay/useAslRelayReceiver';
import { LocalSpeaker, type SpeakingState } from '../speech/LocalSpeaker';
import { LocalWhisperTranscriber } from '../speech/LocalWhisperTranscriber';
import { useTheme } from '../theme';
import type { ScreenProps } from '../navigation/types';

interface TranscriptEntry {
  text: string;
  /** Who said it — 'signer' arrived over the relay, 'me' is this phone's own talk-back reply. */
  from: 'signer' | 'me';
}

/**
 * Receive on this phone.
 *
 * The other half of the same-WiFi ASL relay (see `asl-relay-rn`): this phone — typically the
 * hearing person's — advertises itself on the local network, speaks aloud whatever the signer's
 * phone sends it from a call, and can talk back — transcribed locally (`LocalWhisperTranscriber`,
 * same on-device Whisper used elsewhere in the app) and relayed back over the same connection,
 * where it shows up as a caption over the signer's camera view.
 *
 * The mic works the way a real phone call's does: it's just always listening for as long as
 * you're on this screen, not something you press to talk into — the same reason Call's camera is
 * always live rather than needing a "start signing" button. Mute silences BOTH directions at
 * once, same as stepping away from a real call: your mic stops listening and incoming messages
 * stop being spoken aloud (still logged either way, so nothing's lost).
 *
 * Styled as a call screen rather than a plain message list: for the hearing person holding this
 * phone, this IS the call — there's just no live audio stream, only text passing each way. Same
 * dark full-bleed chrome, call bar, and bottom controls as Call, so it reads as "on a call"
 * rather than "watching a feed".
 */
export function ReceiveScreen({ navigation }: ScreenProps<'Receive'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [muted, setMuted] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [speakingState, setSpeakingState] = useState<SpeakingState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const speaker = useRef(new LocalSpeaker()).current;
  const whisper = useRef(new LocalWhisperTranscriber()).current;

  const handleMessage = useCallback(
    (text: string) => {
      setTranscript((prev) => [{ text, from: 'signer' as const }, ...prev].slice(0, 20));
      // Still logged to the transcript above either way — muting only silences the
      // speaker, the same way Call's mute never stops signs from being recognized.
      if (muted) return;
      speaker.speak(text, setSpeakingState);
    },
    [speaker, muted],
  );

  const relay = useAslRelayReceiver(handleMessage);

  // Starts listening the moment the call isn't muted, and keeps listening for as long as it
  // isn't — no press-to-talk, same as the mic on a real call. Re-runs whenever `muted` flips.
  useEffect(() => {
    if (muted) {
      whisper.stop().catch(() => undefined);
      return;
    }

    let cancelled = false;
    (async () => {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        if (cancelled || granted !== PermissionsAndroid.RESULTS.GRANTED) return;
      }
      try {
        await whisper.start({
          onTranscript: (text) => {
            relay.sendText(text);
            setTranscript((prev) => [{ text, from: 'me' as const }, ...prev].slice(0, 20));
          },
          onListeningChange: setMicActive,
          onError: () => setMicActive(false),
        });
      } catch {
        setMicActive(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // relay.sendText is stable for the component's lifetime (see useAslRelayReceiver); only
    // `muted` should actually restart the mic.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted, whisper]);

  useEffect(() => {
    return () => {
      speaker.stop();
      whisper.stop().catch(() => undefined);
    };
  }, [speaker, whisper]);

  // A live "connected" clock for as long as this phone is listening — the same at-a-glance
  // reassurance a phone call's duration gives, even though nothing here is a literal telephone
  // connection.
  useEffect(() => {
    if (relay.status !== 'listening') return;
    const start = Date.now();
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [relay.status]);

  const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const seconds = String(elapsed % 60).padStart(2, '0');
  const latestEntry = transcript[0] ?? null;
  const speaking = speakingState === 'speaking';
  const leave = () => {
    speaker.stop();
    navigation.goBack();
  };

  // Priority order for the center display: what's happening right now beats what already
  // happened. The mic being on isn't its own state here — it's just the ambient default, the
  // same way a real call doesn't announce "microphone active" — so it doesn't crowd this out.
  const centerLabel = speaking
    ? 'SPEAKING'
    : latestEntry
      ? latestEntry.from === 'me'
        ? 'YOU SAID'
        : 'LAST HEARD'
      : 'WAITING FOR SIGNS';
  const centerBody = latestEntry?.text ?? 'Keep this open while the other phone signs to you.';
  const avatarActive = speaking;
  const avatarIcon = speaking ? 'volume' : 'wifi';

  return (
    <Screen dark edgeToEdge>
      <View style={[styles.background, { backgroundColor: theme.colors.viewport }]}>
        <View style={[styles.overlay, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View
            style={[
              styles.callBar,
              { paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md, paddingVertical: theme.spacing.sm },
            ]}
          >
            <IconButton name="chevron-left" accessibilityLabel="Leave" variant="translucent" size={38} onPress={leave} />
            <View style={styles.callBarTitle}>
              <Text variant="bodyStrong" style={styles.onDark}>
                ASL Receiver
              </Text>
              <Text variant="caption" style={[styles.onDark, styles.dim]}>
                {relay.status === 'listening' ? `Listening · ${minutes}:${seconds}` : 'Starting…'}
              </Text>
            </View>
            <View
              style={[
                styles.liveBadge,
                {
                  gap: theme.spacing.xs,
                  paddingHorizontal: theme.spacing.sm,
                  paddingVertical: theme.spacing.xs,
                  backgroundColor:
                    relay.status === 'listening' ? 'rgba(45, 191, 137, 0.24)' : 'rgba(255,255,255,0.16)',
                },
              ]}
            >
              <View
                style={[
                  styles.liveDot,
                  { backgroundColor: relay.status === 'listening' ? theme.colors.accent : theme.colors.textMuted },
                ]}
              />
              <Text variant="caption" style={styles.onDark}>
                {relay.status === 'listening' ? 'LIVE' : relay.status === 'unavailable' ? 'OFFLINE' : '…'}
              </Text>
            </View>
          </View>

          <View style={[styles.pillRow, { paddingHorizontal: theme.spacing.lg, marginTop: theme.spacing.sm }]}>
            <View
              style={[
                styles.pill,
                { gap: theme.spacing.xs / 2, paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs },
              ]}
            >
              <Icon name="wifi" size={12} color="#FFFFFF" />
              <Text variant="caption" style={styles.onDark}>
                {relay.available
                  ? 'Advertised as "ASL Receiver"'
                  : 'Needs a development build with the relay linked'}
              </Text>
            </View>
            <View
              style={[
                styles.pill,
                {
                  marginLeft: theme.spacing.sm,
                  gap: theme.spacing.xs / 2,
                  paddingHorizontal: theme.spacing.sm,
                  paddingVertical: theme.spacing.xs,
                },
              ]}
            >
              <Icon name={muted ? 'mic-off' : 'mic'} size={12} color="#FFFFFF" />
              <Text variant="caption" style={styles.onDark}>
                {muted ? 'Mic muted' : micActive ? 'Mic listening' : 'Starting mic…'}
              </Text>
            </View>
          </View>

          <View style={styles.centerWrap}>
            <View
              style={[
                styles.avatar,
                {
                  backgroundColor: avatarActive ? theme.colors.accent : 'rgba(255,255,255,0.12)',
                  borderColor: avatarActive ? theme.colors.accent : 'rgba(255,255,255,0.25)',
                },
              ]}
            >
              <Icon name={avatarIcon} size={40} color="#FFFFFF" />
            </View>

            <Text variant="label" style={[styles.onDark, styles.dim, { marginTop: theme.spacing.lg }]}>
              {centerLabel}
            </Text>
            <Text variant="title" style={[styles.onDark, styles.centerText, { marginTop: theme.spacing.sm }]}>
              {centerBody}
            </Text>
          </View>

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
            <Text variant="label" style={[styles.onDark, styles.dim]}>
              TRANSCRIPT
            </Text>
            <FlatList
              data={transcript}
              keyExtractor={(_item, index) => String(index)}
              style={styles.transcriptList}
              contentContainerStyle={{ gap: theme.spacing.xs }}
              showsVerticalScrollIndicator={false}
              renderItem={({ item, index }) => (
                <View
                  style={[
                    styles.transcriptRow,
                    {
                      borderRadius: theme.radius.md,
                      paddingHorizontal: theme.spacing.md,
                      paddingVertical: theme.spacing.sm,
                      backgroundColor:
                        index === 0
                          ? item.from === 'me'
                            ? theme.colors.accentSoft
                            : 'rgba(255,255,255,0.14)'
                          : 'transparent',
                    },
                  ]}
                >
                  <Text
                    variant="caption"
                    style={[item.from === 'me' ? undefined : styles.onDark, styles.dim]}
                    tone={item.from === 'me' ? 'accent' : undefined}
                  >
                    {item.from === 'me' ? 'YOU' : 'THEM'}
                  </Text>
                  <Text variant="body" style={item.from === 'me' && index === 0 ? undefined : styles.onDark}>
                    {item.text}
                  </Text>
                </View>
              )}
              ListEmptyComponent={
                <Text variant="caption" style={[styles.onDark, styles.dim]}>
                  Confirmed sentences from the other phone — and anything you talk back — show up
                  here.
                </Text>
              }
            />

            <View style={[styles.controls, { gap: theme.spacing['2xl'], marginTop: theme.spacing.sm }]}>
              <IconButton
                name={muted ? 'mic-off' : 'mic'}
                accessibilityLabel={muted ? 'Unmute' : 'Mute'}
                selected={muted}
                variant={muted ? 'accent' : 'translucent'}
                size={52}
                onPress={() => setMuted(!muted)}
              />
              <IconButton name="close" accessibilityLabel="Leave" variant="danger" size={64} onPress={leave} />
              <IconButton
                name="volume"
                accessibilityLabel="Replay last message"
                variant="translucent"
                size={52}
                disabled={!latestEntry}
                onPress={() => latestEntry && speaker.speak(latestEntry.text, setSpeakingState)}
              />
            </View>
          </View>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  background: { flex: 1 },
  overlay: { flex: 1 },
  onDark: { color: '#FFFFFF' },
  dim: { opacity: 0.7 },
  callBar: { flexDirection: 'row', alignItems: 'center' },
  callBarTitle: { flex: 1 },
  liveBadge: { flexDirection: 'row', alignItems: 'center', borderRadius: 999 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  pillRow: { flexDirection: 'row' },
  pill: { flexDirection: 'row', alignItems: 'center', borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.4)' },
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  centerText: { textAlign: 'center' },
  chrome: { backgroundColor: 'rgba(0,0,0,0.4)' },
  transcriptList: { maxHeight: 160 },
  transcriptRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
