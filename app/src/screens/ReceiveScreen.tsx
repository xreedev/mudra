import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, PermissionsAndroid, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, IconButton, Screen, Text } from '../components';
import { useAslRelayReceiver } from '../relay/useAslRelayReceiver';
import { LocalSpeaker, type SpeakingState } from '../speech/LocalSpeaker';
import { LocalVoiceRecorder, type VoiceRecorderStats } from '../speech/LocalVoiceRecorder';
import { useTheme } from '../theme';
import type { ScreenProps } from '../navigation/types';

type RecordState = 'idle' | 'recording' | 'transcribing';

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
 * always live rather than needing a "start signing" button. It also pauses itself for as long as
 * this phone's own speaker is playing a reply out loud, so it never re-hears (and relays back)
 * the message it's in the middle of speaking. Mute silences both directions at once, same as
 * stepping away from a real call: your mic stops listening and incoming messages stop being
 * spoken aloud (still logged either way, so nothing's lost).
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
  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [recordStats, setRecordStats] = useState<VoiceRecorderStats | null>(null);
  const [chatText, setChatText] = useState('');
  // Pure diagnostic: increments synchronously on every tap, with nothing async in the way —
  // proves whether a touch is reaching React at all, independent of permissions/recorder logic.
  const [tapCount, setTapCount] = useState(0);
  const [speakingState, setSpeakingState] = useState<SpeakingState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const speaker = useRef(new LocalSpeaker()).current;
  const recorder = useRef(new LocalVoiceRecorder()).current;
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const clearRecordTimer = useCallback(() => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  }, []);

  const handleRecordStart = useCallback(async () => {
    console.log('[voice-record] tap start, recordState =', recordState);
    if (recordState !== 'idle') return;
    setRecordError(null);
    setRecordStats(null);

    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      console.log('[voice-record] permission result:', granted);
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        setRecordError('Microphone permission denied');
        return;
      }
    }
    try {
      console.log('[voice-record] calling recorder.start()...');
      await recorder.start(setRecordStats);
      console.log('[voice-record] recorder.start() resolved OK');
    } catch (e) {
      console.log('[voice-record] recorder.start() THREW:', e);
      setRecordError(e instanceof Error ? e.message : 'Could not start recording');
      return;
    }
    setRecordSeconds(0);
    setRecordState('recording');
    recordTimerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
  }, [recordState, recorder]);

  const handleRecordStop = useCallback(async () => {
    console.log('[voice-record] tap stop, recordState =', recordState);
    if (recordState !== 'recording') return;
    clearRecordTimer();
    setRecordState('transcribing');
    const stats = recorder.getStats();
    console.log('[voice-record] stats at stop:', JSON.stringify(stats));
    let text = '';
    try {
      text = await recorder.stop();
      console.log('[voice-record] recorder.stop() resolved, text =', JSON.stringify(text));
    } catch (e) {
      console.log('[voice-record] recorder.stop() THREW:', e);
      setRecordError(e instanceof Error ? e.message : 'Could not transcribe recording');
    }
    setRecordState('idle');
    setRecordSeconds(0);
    if (text) {
      relay.sendText(text);
      setTranscript((prev) => [{ text, from: 'me' as const }, ...prev].slice(0, 20));
    } else if (stats.chunkCount === 0) {
      // No onData ever fired — the native audio stream never actually opened, as opposed to
      // opening but hearing silence (peakLevel would be 0 too, but chunkCount would be > 0).
      setRecordError('No audio captured at all — mic never opened. Check permission/hardware.');
    } else if (stats.peakLevel < 0.01) {
      setRecordError(`Mic open but heard only silence (peak ${(stats.peakLevel * 100).toFixed(1)}%).`);
    } else {
      setRecordError("Heard audio but couldn't make out any words — try again closer to the mic.");
    }
  }, [recordState, recorder, relay, clearRecordTimer]);

  const handleRecordToggle = useCallback(() => {
    setTapCount((c) => c + 1);
    console.log('[voice-record] Pressable onPress fired, recordState =', recordState);
    if (recordState === 'idle') {
      handleRecordStart();
    } else if (recordState === 'recording') {
      handleRecordStop();
    }
  }, [recordState, handleRecordStart, handleRecordStop]);

  const handleSendChat = useCallback(() => {
    const text = chatText.trim();
    if (!text) return;
    relay.sendText(text);
    setTranscript((prev) => [{ text, from: 'me' as const }, ...prev].slice(0, 20));
    setChatText('');
  }, [chatText, relay]);

  useEffect(() => {
    return () => {
      speaker.stop();
      clearRecordTimer();
      recorder.release().catch(() => undefined);
    };
  }, [speaker, recorder, clearRecordTimer]);

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
  const recordMinutes = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
  const recordSecondsDisplay = String(recordSeconds % 60).padStart(2, '0');
  const centerLabel = recordError
    ? 'RECORDING FAILED'
    : recordState === 'recording'
      ? 'RECORDING'
      : recordState === 'transcribing'
        ? 'TRANSCRIBING'
        : speaking
          ? 'SPEAKING'
          : latestEntry
            ? latestEntry.from === 'me'
              ? 'YOU SAID'
              : 'LAST HEARD'
            : 'WAITING FOR SIGNS';
  const centerBody = recordError
    ? recordError
    : recordState === 'recording'
      ? `${recordMinutes}:${recordSecondsDisplay}`
      : recordState === 'transcribing'
        ? 'Converting your voice message...'
        : latestEntry?.text ?? 'Keep this open while the other phone signs to you.';
  const avatarActive = speaking || recordState === 'recording';
  const avatarIcon = recordState === 'recording' ? 'mic' : speaking ? 'volume' : 'wifi';

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
                {muted ? 'Replies muted' : 'Tap record to talk back'}
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

            {recordState === 'recording' ? (
              <View style={[styles.levelMeterTrack, { marginTop: theme.spacing.lg }]}>
                <View
                  style={[
                    styles.levelMeterFill,
                    {
                      backgroundColor: theme.colors.accent,
                      width: `${Math.round((recordStats?.lastLevel ?? 0) * 100)}%`,
                    },
                  ]}
                />
              </View>
            ) : null}
            {recordState === 'recording' && recordStats ? (
              <Text variant="caption" style={[styles.onDark, styles.dim, { marginTop: theme.spacing.xs }]}>
                {recordStats.chunkCount} chunks · peak {(recordStats.peakLevel * 100).toFixed(1)}%
              </Text>
            ) : null}
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

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Record voice message"
              disabled={recordState === 'transcribing'}
              onPress={handleRecordToggle}
              style={({ pressed }) => [
                styles.recordButton,
                {
                  borderRadius: theme.radius.md,
                  backgroundColor:
                    recordState === 'recording' ? theme.colors.danger : theme.colors.accent,
                  opacity: recordState === 'transcribing' ? 0.45 : pressed ? 0.8 : 1,
                },
              ]}
            >
              <Icon name={recordState === 'recording' ? 'stop' : 'mic'} size={20} color="#FFFFFF" />
              <Text variant="bodyStrong" style={styles.onDark}>
                {recordState === 'recording'
                  ? `Stop recording · ${recordMinutes}:${recordSecondsDisplay}`
                  : recordState === 'transcribing'
                    ? 'Transcribing...'
                    : `Start recording a voice message (taps: ${tapCount})`}
              </Text>
            </Pressable>

            <View style={[styles.chatRow, { gap: theme.spacing.sm }]}>
              <TextInput
                value={chatText}
                onChangeText={setChatText}
                placeholder="Or type a reply instead..."
                placeholderTextColor="rgba(255,255,255,0.5)"
                style={[styles.chatInput, { borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.md }]}
                onSubmitEditing={handleSendChat}
                returnKeyType="send"
              />
              <IconButton
                name="send"
                accessibilityLabel="Send typed reply"
                variant="accent"
                size={44}
                disabled={!chatText.trim()}
                onPress={handleSendChat}
              />
            </View>

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
  levelMeterTrack: {
    width: 160,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  levelMeterFill: { height: '100%', borderRadius: 3 },
  chrome: { backgroundColor: 'rgba(0,0,0,0.4)' },
  recordButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 56,
    paddingHorizontal: 20,
  },
  chatRow: { flexDirection: 'row', alignItems: 'center' },
  chatInput: {
    flex: 1,
    height: 44,
    color: '#FFFFFF',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  transcriptList: { maxHeight: 160 },
  transcriptRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
