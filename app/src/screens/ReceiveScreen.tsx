import React, { useCallback, useEffect, useRef } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { AppHeader, Card, EmptyState, Icon, Screen, Text } from '../components';
import { useAslRelayReceiver } from '../relay/useAslRelayReceiver';
import { LocalSpeaker } from '../speech/LocalSpeaker';
import { useTheme } from '../theme';
import type { ScreenProps } from '../navigation/types';

/**
 * Receive on this phone.
 *
 * The other half of the same-WiFi ASL relay (see `asl-relay-rn`): this phone — typically the
 * hearing person's — advertises itself on the local network and speaks aloud whatever Call
 * Someone or Talk Aloud sends it from the signer's phone. Nothing to configure: opening this
 * screen is the whole setup.
 */
export function ReceiveScreen(_: ScreenProps<'Receive'>) {
  const theme = useTheme();
  const speaker = useRef(new LocalSpeaker()).current;

  useEffect(() => () => speaker.stop(), [speaker]);

  const handleMessage = useCallback(
    (text: string) => {
      speaker.speak(text, () => undefined);
    },
    [speaker],
  );

  const relay = useAslRelayReceiver(handleMessage);

  return (
    <Screen>
      <AppHeader title="Receive on this phone" subtitle="Keep this open while the other phone signs to you" />

      <Card tone={relay.status === 'listening' ? 'accent' : 'flat'} style={{ marginTop: theme.spacing.md }}>
        <View style={[styles.statusRow, { gap: theme.spacing.sm }]}>
          <Icon
            name="wifi"
            size={20}
            color={relay.status === 'listening' ? theme.colors.accent : theme.colors.textMuted}
          />
          <View style={styles.statusText}>
            <Text variant="bodyStrong" tone={relay.status === 'listening' ? 'accent' : undefined}>
              {relay.status === 'listening' && 'Listening on this WiFi network'}
              {relay.status === 'idle' && 'Starting…'}
              {relay.status === 'unavailable' && 'Relay unavailable'}
            </Text>
            <Text variant="caption" tone="muted" style={{ marginTop: theme.spacing.xs / 2 }}>
              {relay.available
                ? 'Advertised as "ASL Receiver" — the sender finds it automatically.'
                : 'Needs a development build with the relay libraries linked.'}
            </Text>
          </View>
        </View>
      </Card>

      <FlatList
        data={relay.messages}
        keyExtractor={(_item, index) => String(index)}
        style={{ marginTop: theme.spacing.lg }}
        contentContainerStyle={{ gap: theme.spacing.sm, paddingBottom: theme.spacing['4xl'] }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <Card tone="flat">
            <Text variant="body">{item}</Text>
          </Card>
        )}
        ListEmptyComponent={
          <EmptyState
            icon="volume"
            title="Nothing yet"
            body="Once the other phone confirms a sentence, it's spoken here and shows up in this list."
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'flex-start' },
  statusText: { flex: 1 },
});
