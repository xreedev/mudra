import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { HIT_SLOP_SIZE, useTheme } from '../theme';

export interface HeroCardProps {
  headline: string;
  /** Small pill in the top-right — the standing on-device promise. */
  badge?: string;
  body: string;
  primaryLabel: string;
  primaryIcon: IconName;
  onPrimaryPress: () => void;
  secondaryLabel: string;
  onSecondaryPress: () => void;
}

/**
 * The home screen's single loud element.
 *
 * Everything that matters on first open lives inside one solid accent block: what the app is for,
 * the promise that nothing is spoken without a tap, and the one button that starts a conversation.
 * Below it the screen goes quiet again — outlined tiles and rows — so there is never a question
 * about where to press when you are standing in a pharmacy queue.
 */
export function HeroCard({
  headline,
  badge,
  body,
  primaryLabel,
  primaryIcon,
  onPrimaryPress,
  secondaryLabel,
  onSecondaryPress,
}: HeroCardProps) {
  const theme = useTheme();

  return (
    <View
      style={{
        backgroundColor: theme.colors.accent,
        borderRadius: theme.radius['2xl'],
        padding: theme.spacing['2xl'],
        gap: theme.spacing.lg,
      }}
    >
      <View style={[styles.headlineRow, { gap: theme.spacing.md }]}>
        <Text variant="display" style={[styles.headline, { color: theme.colors.accentText }]}>
          {headline}
        </Text>
        {badge ? (
          <Text
            variant="mono"
            style={[
              styles.badge,
              {
                color: theme.colors.accentText,
                backgroundColor: theme.colors.onAccentSoft,
                borderRadius: theme.radius.pill,
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: theme.spacing.xs,
              },
            ]}
          >
            {badge}
          </Text>
        ) : null}
      </View>

      <Text variant="body" style={{ color: theme.colors.accentText }}>
        {body}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={primaryLabel}
        onPress={onPrimaryPress}
        style={({ pressed }) => [
          styles.primary,
          {
            backgroundColor: theme.colors.accentText,
            borderRadius: theme.radius.lg,
            gap: theme.spacing.sm,
            opacity: pressed ? 0.9 : 1,
          },
        ]}
      >
        <Icon name={primaryIcon} size={22} color={theme.colors.accent} weight={1.9} />
        <Text variant="heading" style={{ color: theme.colors.accent }}>
          {primaryLabel}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={secondaryLabel}
        onPress={onSecondaryPress}
        style={({ pressed }) => [
          styles.secondary,
          { gap: theme.spacing.sm, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text variant="bodyStrong" style={{ color: theme.colors.accentText }}>
          {secondaryLabel}
        </Text>
        <Icon name="chevron-right" size={16} color={theme.colors.accentText} weight={2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  headlineRow: { flexDirection: 'row', alignItems: 'flex-start' },
  headline: { flex: 1 },
  badge: { overflow: 'hidden' },
  primary: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: {
    minHeight: HIT_SLOP_SIZE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
