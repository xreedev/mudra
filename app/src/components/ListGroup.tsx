import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { HIT_SLOP_SIZE, useTheme } from '../theme';

export interface ListGroupProps {
  children: React.ReactNode;
}

/**
 * A rounded, outlined group of `ListRow`s.
 *
 * The dividers between rows are the group's own background showing through a 1pt gap, rather than
 * a border on each row — so the hairlines stop cleanly at the rounded corners instead of running
 * into them.
 */
export function ListGroup({ children }: ListGroupProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.group,
        {
          backgroundColor: theme.colors.border,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.xl,
        },
      ]}
    >
      {children}
    </View>
  );
}

export interface ListRowProps {
  label: string;
  icon: IconName;
  onPress: () => void;
  /** Trailing note, e.g. a live count. */
  meta?: string;
}

/** One tappable row inside a `ListGroup`: glyph, label, optional count, chevron. */
export function ListRow({ label, icon, onPress, meta }: ListRowProps) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={meta ? `${label}, ${meta}` : label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? theme.colors.surface : theme.colors.surfaceRaised,
          paddingHorizontal: theme.spacing.lg,
          gap: theme.spacing.md,
        },
      ]}
    >
      <Icon name={icon} size={20} color={theme.colors.textMuted} />
      <Text variant="bodyStrong" style={styles.label}>
        {label}
      </Text>
      {meta ? (
        <Text variant="label" tone="muted" style={styles.meta}>
          {meta}
        </Text>
      ) : null}
      <Icon name="chevron-right" size={18} color={theme.colors.borderStrong} weight={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: StyleSheet.hairlineWidth * 2,
    borderWidth: StyleSheet.hairlineWidth * 2,
    overflow: 'hidden',
  },
  row: { minHeight: HIT_SLOP_SIZE + 12, flexDirection: 'row', alignItems: 'center' },
  label: { flex: 1 },
  meta: { fontWeight: '400' },
});
