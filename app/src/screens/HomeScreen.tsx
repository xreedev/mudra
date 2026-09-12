import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Screen, Text, Tile } from '../components';
import { useTheme } from '../theme';
import type { ScreenProps } from '../navigation/types';

/**
 * The home screen: a wordmark, five tiles, and a privacy line.
 *
 * No tab bar, no carousel, no dashboard. Destinations laid out as a grid of large targets is the
 * fastest thing to hit correctly — which matters when the reason you opened the app is an
 * emergency.
 */
export function HomeScreen({ navigation }: ScreenProps<'Home'>) {
  const theme = useTheme();

  return (
    <Screen scroll>
      <View style={{ paddingTop: theme.spacing['2xl'], paddingBottom: theme.spacing['2xl'] }}>
        <View style={[styles.brandRow, { gap: theme.spacing.sm }]}>
          <View
            style={[
              styles.mark,
              { backgroundColor: theme.colors.accent, borderRadius: theme.radius.md },
            ]}
          >
            <Icon name="chat" size={20} color={theme.colors.accentText} />
          </View>
          <Text variant="label" tone="muted">
            MUDRA+
          </Text>
        </View>

        <Text variant="display" style={{ marginTop: theme.spacing.xl }}>
          Say it your way.
        </Text>
        <Text variant="body" tone="muted" style={{ marginTop: theme.spacing.sm, maxWidth: 320 }}>
          Sign into the camera, confirm the sentence, and MUDRA+ speaks for you.
        </Text>
      </View>

      <View style={[styles.grid, { gap: theme.spacing.md }]}>
        <View style={[styles.row, { gap: theme.spacing.md }]}>
          <Tile
            title="Call someone"
            description="Sign into a live voice call"
            icon="call"
            featured
            onPress={() => navigation.navigate('Call')}
          />
          <Tile
            title="Memory"
            description="Sentences remembered from signing"
            icon="memory"
            onPress={() => navigation.navigate('Memory')}
          />
        </View>
        <View style={[styles.row, { gap: theme.spacing.md }]}>
          <Tile
            title="Add custom sign"
            description="Teach MUDRA+ a new sign"
            icon="sign"
            onPress={() => navigation.navigate('AddSign')}
          />
          <Tile
            title="Chatbot"
            description="Help phrasing what to say"
            icon="chat"
            onPress={() => navigation.navigate('Chat')}
          />
        </View>
        <View style={[styles.row, { gap: theme.spacing.md }]}>
          <Tile
            title="Talk Aloud"
            description="Sign a sentence, hear it spoken"
            icon="volume"
            onPress={() => navigation.navigate('TalkAloud')}
          />
        </View>
      </View>

      <View
        style={[
          styles.footer,
          {
            gap: theme.spacing.sm,
            marginTop: theme.spacing['2xl'],
            borderColor: theme.colors.border,
            borderRadius: theme.radius.lg,
            padding: theme.spacing.lg,
            backgroundColor: theme.colors.surface,
          },
        ]}
      >
        <Icon name="lock" size={18} color={theme.colors.textMuted} />
        <Text variant="caption" tone="muted" style={styles.footerText}>
          Signs, phrases and memories stay on this phone.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center' },
  mark: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  grid: {},
  row: { flexDirection: 'row' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  footerText: { flex: 1 },
});
