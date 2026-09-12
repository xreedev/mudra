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
  /**
   * Visual size of the button. Never goes below the 44px minimum touch target — a smaller
   * value only shrinks the icon/background, the tappable area is padded back up to 44px via
   * `hitSlop` so this app's controls stay reachable for someone signing one-handed.
   */
  size?: number;
  disabled?: boolean;
  /** For a toggle button (e.g. mute) whose icon/variant already changes with state — reported
   *  to assistive tech alongside the visual change, not as a substitute for it. */
  selected?: boolean;
  style?: ViewStyle;
}

export function IconButton({
  name,
  onPress,
  accessibilityLabel,
  variant = 'plain',
  size = HIT_SLOP_SIZE,
  disabled = false,
  selected,
  style,
}: IconButtonProps) {
  const theme = useTheme();
  const hitSlop = Math.max(0, Math.ceil((HIT_SLOP_SIZE - size) / 2));

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
      accessibilityState={{ disabled, selected }}
      onPress={disabled ? undefined : onPress}
      hitSlop={hitSlop}
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
