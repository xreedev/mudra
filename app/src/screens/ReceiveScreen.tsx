import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, IconButton, Screen, Text } from '../components';
import { useAslRelayReceiver } from '../relay/useAslRelayReceiver';
import { LocalSpeaker, type SpeakingState } from '../speech/LocalSpeaker';
import { useTheme } from '../theme';
import type { ScreenProps } from '../navigation/types';

/**
 * Receive on this phone.
 *
 * The other half of the same-WiFi ASL relay (see `asl-relay-rn`): this phone — typically the
 * hearing person's — advertises itself on the local network and speaks aloud whatever Call
 * Someone or Talk Aloud sends it from the signer's phone.
 *
 * Styled as a call screen rather than a plain message list: for the hearing person holding this
 * phone, this IS the call — there's just no live audio stream, only the signer's confirmed
 * sentences arriving one at a time. Same dark full-bleed chrome, call bar, and bottom controls as
 * Call Someone, so it reads as "on a call" rather than "watching a feed".
 */
export function ReceiveScreen({ navigation }: ScreenProps<'Receive'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [muted, setMuted] = useState(false);
  const [speakingState, setSpeakingState] = useState<SpeakingState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const speaker = useRef(new LocalSpeaker()).current;

  useEffect(() => () => speaker.stop(), [speaker]);

  const handleMessage = useCallback(
    (text: string) => {
      // Still logged to the transcript below either way — muting only silences the
      // speaker, the same way Call Someone's mute never stops signs from being recognized.
      if (muted) return;
      speaker.speak(text, setSpeakingState);
    },
    [speaker, muted],
  );

  const relay = useAslRelayReceiver(handleMessage);

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
  const latest = relay.messages[0] ?? null;
  const speaking = speakingState === 'speaking';
  const leave = () => {
    speaker.stop();
    navigation.goBack();
  };

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
          </View>

          <View style={styles.centerWrap}>
            <View
              style={[
                styles.avatar,
                {
                  backgroundColor: speaking ? theme.colors.accent : 'rgba(255,255,255,0.12)',
                  borderColor: speaking ? theme.colors.accent : 'rgba(255,255,255,0.25)',
                },
              ]}
            >
              <Icon name={speaking ? 'volume' : 'wifi'} size={40} color="#FFFFFF" />
            </View>

            <Text variant="label" style={[styles.onDark, styles.dim, { marginTop: theme.spacing.lg }]}>
              {speaking ? 'SPEAKING' : latest ? 'LAST HEARD' : 'WAITING FOR SIGNS'}
            </Text>
            <Text variant="title" style={[styles.onDark, styles.centerText, { marginTop: theme.spacing.sm }]}>
              {latest ?? 'Keep this open while the other phone signs to you.'}
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
              data={relay.messages}
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
                      backgroundColor: index === 0 ? 'rgba(255,255,255,0.14)' : 'transparent',
                    },
                  ]}
                >
                  <Text variant="body" style={styles.onDark}>
                    {item}
                  </Text>
                </View>
              )}
              ListEmptyComponent={
                <Text variant="caption" style={[styles.onDark, styles.dim]}>
                  Confirmed sentences from the other phone show up here.
                </Text>
              }
            />

            <View style={[styles.controls, { gap: theme.spacing['2xl'], marginTop: theme.spacing.sm }]}>
              <IconButton
                name={muted ? 'mic-off' : 'mic'}
                accessibilityLabel={muted ? 'Unmute incoming speech' : 'Mute incoming speech'}
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
                disabled={!latest}
                onPress={() => latest && speaker.speak(latest, setSpeakingState)}
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
  transcriptRow: {},
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
