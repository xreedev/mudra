import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { useTheme } from '../theme';

export interface TileProps {
  title: string;
  description: string;
  icon: IconName;
  onPress: () => void;
  /** The one primary destination on the home screen. */
  featured?: boolean;
  /** Small trailing note, e.g. a count. */
  meta?: string;
}

/**
 * A home-screen destination.
 *
 * Tiles are tall, high-contrast and few in number: someone who needs to place an emergency call
 * should be able to hit the right one without reading carefully. The featured tile is visually
 * louder for the same reason.
 */
export function Tile({ title, description, icon, onPress, featured = false, meta }: TileProps) {
  const theme = useTheme();

  const background = featured ? theme.colors.accent : theme.colors.surfaceRaised;
  const foreground = featured ? theme.colors.accentText : theme.colors.text;
  const mutedForeground = featured ? theme.colors.accentText : theme.colors.textMuted;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${description}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: background,
          borderColor: featured ? 'transparent' : theme.colors.border,
          borderRadius: theme.radius.xl,
          padding: theme.spacing.lg,
          opacity: pressed ? 0.88 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}
    >
      <View
        style={[
          styles.chip,
          {
            backgroundColor: featured ? 'rgba(255,255,255,0.18)' : theme.colors.surface,
            borderRadius: theme.radius.md,
          },
        ]}
      >
        <Icon name={icon} size={22} color={foreground} />
      </View>

      <View style={styles.spacer} />

      <Text variant="heading" style={{ color: foreground }}>
        {title}
      </Text>
      <Text
        variant="caption"
        style={[styles.description, { color: mutedForeground, opacity: featured ? 0.9 : 1 }]}
      >
        {description}
      </Text>
      {meta ? (
        <Text variant="caption" style={{ color: mutedForeground, opacity: featured ? 0.8 : 1 }}>
          {meta}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minHeight: 158,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  chip: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  spacer: { flex: 1, minHeight: 12 },
  description: { marginTop: 2, marginBottom: 2 },
});
