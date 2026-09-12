import React from 'react';
import {
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';

export interface ScreenProps {
  children: React.ReactNode;
  /** Wrap the content in a ScrollView. Off for screens that own their own list. */
  scroll?: boolean;
  /** Remove the horizontal gutter (full-bleed camera screens). */
  edgeToEdge?: boolean;
  /** Paint the dark viewport background instead of the app background. */
  dark?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}

/**
 * Every screen's outer frame: safe-area padding, background, status-bar style, and the single
 * horizontal gutter the whole app shares. Screens never set their own page padding, so nothing
 * can drift out of alignment with its neighbours.
 */
export function Screen({
  children,
  scroll = false,
  edgeToEdge = false,
  dark = false,
  contentStyle,
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const background = dark ? theme.colors.viewport : theme.colors.background;
  const padding = {
    paddingTop: insets.top,
    paddingBottom: insets.bottom,
    paddingHorizontal: edgeToEdge ? 0 : theme.spacing.xl,
  };

  const body = scroll ? (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[{ paddingBottom: theme.spacing['4xl'] }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, contentStyle]}>{children}</View>
  );

  return (
    <View style={[styles.fill, { backgroundColor: background }, padding]}>
      <StatusBar
        barStyle={dark || theme.isDark ? 'light-content' : 'dark-content'}
        backgroundColor={background}
      />
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
