import React from 'react';
import { Text as RNText, type StyleProp, type TextProps, type TextStyle } from 'react-native';
import { typography, useTheme } from '../theme';

type Variant = keyof typeof typography;

export interface AppTextProps extends TextProps {
  variant?: Variant;
  /** `muted` for secondary copy, `accent` for links, `danger` for destructive labels. */
  tone?: 'default' | 'muted' | 'accent' | 'danger' | 'inverse';
  style?: StyleProp<TextStyle>;
}

/**
 * The only text primitive in the app. Going through one component means every string picks up
 * the type scale and the themed colour, and none of them can quietly hard-code a size.
 */
export function Text({ variant = 'body', tone = 'default', style, ...rest }: AppTextProps) {
  const theme = useTheme();
  const color =
    tone === 'muted'
      ? theme.colors.textMuted
      : tone === 'accent'
        ? theme.colors.accent
        : tone === 'danger'
          ? theme.colors.danger
          : tone === 'inverse'
            ? theme.colors.textInverse
            : theme.colors.text;

  return <RNText {...rest} style={[theme.typography[variant], { color }, style]} />;
}
