import React from 'react';
import { Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { Icon, type IconName } from './Icon';
import { HIT_SLOP_SIZE, useTheme } from '../theme';

export interface IconButtonProps {
  name: IconName;
  onPress?: () => void;
  /** Required: an icon-only control is invisible to a screen reader without it. */
  accessibilityLabel: string;
  variant?: 'plain' | 'surface' | 'accent' | 'danger' | 'translucent';
  size?: number;
  disabled?: boolean;
  style?: ViewStyle;
}

export function IconButton({
  name,
  onPress,
  accessibilityLabel,
  variant = 'plain',
  size = HIT_SLOP_SIZE,
  disabled = false,
  style,
}: IconButtonProps) {
  const theme = useTheme();

  const background =
    variant === 'surface'
      ? theme.colors.surface
      : variant === 'accent'
        ? theme.colors.accent
        : variant === 'danger'
          ? theme.colors.danger
          : variant === 'translucent'
            ? 'rgba(255,255,255,0.16)'
            : 'transparent';

  const tint =
    variant === 'accent'
      ? theme.colors.accentText
      : variant === 'danger'
        ? theme.colors.textInverse
        : variant === 'translucent'
          ? '#FFFFFF'
          : theme.colors.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      onPress={disabled ? undefined : onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: background,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      <Icon name={name} size={Math.round(size * 0.46)} color={tint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
});
