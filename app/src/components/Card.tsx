import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';

export interface CardProps {
  children: React.ReactNode;
  /** `raised` for content that sits on the app background, `flat` for content inside a card. */
  tone?: 'raised' | 'flat' | 'accent';
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** A bordered surface. Depth in this app comes from hairline borders, not from drop shadows. */
export function Card({ children, tone = 'raised', padded = true, style }: CardProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor:
            tone === 'accent'
              ? theme.colors.accentSoft
              : tone === 'flat'
                ? theme.colors.surface
                : theme.colors.surfaceRaised,
          borderColor: tone === 'accent' ? 'transparent' : theme.colors.border,
          borderRadius: theme.radius.lg,
          padding: padded ? theme.spacing.lg : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { borderWidth: StyleSheet.hairlineWidth * 2 },
});
