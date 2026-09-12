import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { IconButton } from './IconButton';
import { Text } from './Text';
import { useTheme } from '../theme';

export interface AppHeaderProps {
  title: string;
  subtitle?: string;
  /** Show the back affordance. Defaults to on for any screen that can go back. */
  back?: boolean;
  /** Rendered on the trailing edge — a single action, never a row of them. */
  action?: React.ReactNode;
}

/**
 * A screen's title block. Left-aligned and typographic rather than a centred navigation bar:
 * it gives the title room to breathe and keeps the back target in the thumb's reach.
 */
export function AppHeader({ title, subtitle, back = true, action }: AppHeaderProps) {
  const theme = useTheme();
  const navigation = useNavigation();
  const canGoBack = back && navigation.canGoBack();

  return (
    <View style={[styles.wrapper, { paddingVertical: theme.spacing.md }]}>
      {canGoBack ? (
        <IconButton
          name="chevron-left"
          accessibilityLabel="Go back"
          onPress={navigation.goBack}
          style={{ marginLeft: -theme.spacing.md, marginBottom: theme.spacing.xs }}
        />
      ) : null}
      <View style={styles.row}>
        <View style={styles.titles}>
          <Text variant="title" accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? (
            <Text variant="body" tone="muted" style={{ marginTop: theme.spacing.xs }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {action ? <View style={styles.action}>{action}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 0 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  titles: { flex: 1 },
  action: { marginLeft: 12, paddingTop: 2 },
});
