import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { useTheme } from '../theme';

export interface TileProps {
  title: string;
  /** One short line under the title — what it does, or a live count. */
  subtitle: string;
  icon: IconName;
  onPress: () => void;
}

/**
 * A secondary home destination, laid out two to a row.
 *
 * The glyph sits alone at the top and the label pair at the bottom, with the gap between them
 * doing the work a chip background used to: at arm's length the icon is what you aim at, and the
 * text is what confirms you aimed right. The loud primary action lives in the hero card above,
 * so tiles are deliberately quiet — outline only, no fill.
 */
export function Tile({ title, subtitle, icon, onPress }: TileProps) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: theme.colors.surfaceRaised,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.xl,
          padding: theme.spacing.lg,
          gap: theme.spacing['2xl'],
          opacity: pressed ? 0.88 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}
    >
      <Icon name={icon} size={22} color={theme.colors.text} />
      <View style={styles.labels}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="caption" tone="muted">
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  labels: { gap: 2 },
});
