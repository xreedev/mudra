import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { HeroCard, Icon, ListGroup, ListRow, Screen, Text, Tile } from '../components';
import { listRememberedSentences } from '../llm';
import { useAllGestureTemplates } from '../recognition';
import { useTheme } from '../theme';
import type { ScreenProps } from '../navigation/types';

/**
 * The home screen.
 *
 * One loud thing, then quiet things. The hero card carries the whole reason the app exists — the
 * promise that nothing is spoken until you tap, and the button that starts a conversation — and
 * everything under it is outlined and secondary. A person who opened this app mid-conversation
 * should be able to hit the right target without reading.
 *
 * No tab bar and no dashboard — the destinations *are* the navigation, and every one of them is
 * one back-press from here.
 */
export function HomeScreen({ navigation }: ScreenProps<'Home'>) {
  const theme = useTheme();
  const [memoryCount, setMemoryCount] = useState(0);
  const { userTemplates } = useAllGestureTemplates();

  // Re-read on every focus (not just mount) so a sentence remembered on a call, or one forgotten
  // on the Memory screen, updates this count the moment the person lands back on Home.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listRememberedSentences().then((entries) => {
        if (!cancelled) setMemoryCount(entries.length);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return (
    <Screen scroll contentStyle={{ gap: theme.spacing.lg, paddingTop: theme.spacing.sm }}>
      <View style={[styles.brandRow, { gap: theme.spacing.sm }]}>
        <View
          style={[
            styles.mark,
            { backgroundColor: theme.colors.accent, borderRadius: theme.radius.md },
          ]}
        />
        <Text variant="label" tone="muted">
          MUDRA+
        </Text>
      </View>

      <HeroCard
        headline="Say it your way."
        badge="ON DEVICE"
        body="Sign into the camera. Nothing is spoken until you tap to confirm it."
        primaryLabel="Start signing"
        primaryIcon="call"
        onPrimaryPress={() => navigation.navigate('Call')}
        secondaryLabel="Send to another phone"
        onSecondaryPress={() => navigation.navigate('Call')}
      />

      <View style={[styles.row, { gap: theme.spacing.md }]}>
        <Tile
          title="Receive here"
          subtitle="Hand this phone over"
          icon="wifi"
          onPress={() => navigation.navigate('Receive')}
        />
        <Tile
          title="Teach a sign"
          subtitle={`${userTemplates.length} of your own`}
          icon="sign"
          onPress={() => navigation.navigate('AddSign')}
        />
      </View>

      <ListGroup>
        <ListRow
          label="Memory"
          icon="memory"
          meta={memoryCount > 0 ? `${memoryCount} saved` : undefined}
          onPress={() => navigation.navigate('Memory')}
        />
      </ListGroup>

      <View style={[styles.footer, { gap: theme.spacing.sm }]}>
        <Icon name="lock" size={16} color={theme.colors.textMuted} />
        <Text variant="caption" tone="muted" style={styles.footerText}>
          Signs, phrases and memories stay on this phone.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center' },
  mark: { width: 28, height: 28 },
  row: { flexDirection: 'row' },
  footer: { flexDirection: 'row', alignItems: 'center' },
  footerText: { flex: 1 },
});
