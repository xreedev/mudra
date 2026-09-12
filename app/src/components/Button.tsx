import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { useTheme } from '../theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  /** Stretch to the container width. */
  block?: boolean;
  style?: ViewStyle;
}

/**
 * One button, four intents. `primary` is the single confirming action on a screen, `danger` is
 * reserved for ending a call or deleting a memory — an assistive app should never make those two
 * look alike.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  disabled = false,
  busy = false,
  block = false,
  style,
}: ButtonProps) {
  const theme = useTheme();
  const inactive = disabled || busy;

  const background =
    variant === 'primary'
      ? theme.colors.accent
      : variant === 'danger'
        ? theme.colors.danger
        : variant === 'secondary'
          ? theme.colors.surfaceRaised
          : 'transparent';

  const foreground =
    variant === 'primary' || variant === 'danger'
      ? variant === 'primary'
        ? theme.colors.accentText
        : theme.colors.textInverse
      : theme.colors.text;

  const border =
    variant === 'secondary' ? theme.colors.border : variant === 'ghost' ? 'transparent' : 'transparent';

  const height = size === 'lg' ? 56 : 48;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      accessibilityLabel={label}
      onPress={inactive ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        {
          height,
          paddingHorizontal: size === 'lg' ? theme.spacing['2xl'] : theme.spacing.xl,
          borderRadius: theme.radius.md,
          backgroundColor: background,
          borderColor: border,
          borderWidth: variant === 'secondary' ? StyleSheet.hairlineWidth * 2 : 0,
          opacity: inactive ? 0.45 : pressed ? 0.82 : 1,
          alignSelf: block ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={foreground} size="small" />
      ) : (
        <View style={styles.content}>
          {icon ? <Icon name={icon} size={18} color={foreground} /> : null}
          <Text variant="bodyStrong" style={{ color: foreground }}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
