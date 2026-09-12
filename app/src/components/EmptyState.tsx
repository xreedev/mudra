import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { useTheme } from '../theme';

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  body: string;
  action?: React.ReactNode;
}

/** What a list looks like before the user has put anything in it. */
export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  const theme = useTheme();
  return (
    <View style={[styles.wrapper, { paddingVertical: theme.spacing['4xl'], gap: theme.spacing.sm }]}>
      <View
        style={[
          styles.badge,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            marginBottom: theme.spacing.xs,
          },
        ]}
      >
        <Icon name={icon} size={26} color={theme.colors.textMuted} />
      </View>
      <Text variant="heading" style={styles.centered}>
        {title}
      </Text>
      <Text variant="body" tone="muted" style={[styles.centered, styles.body]}>
        {body}
      </Text>
      {action ? <View style={{ marginTop: theme.spacing.lg }}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center' },
  badge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  centered: { textAlign: 'center' },
  body: { maxWidth: 280 },
});
