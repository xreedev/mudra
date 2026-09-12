import React, { useState } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Icon } from './Icon';
import { Text } from './Text';
import { useTheme } from '../theme';

export interface TextFieldProps extends TextInputProps {
  label?: string;
  /** Helper or error copy under the field. */
  hint?: string;
  invalid?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
}

/** A labelled input. The label is a real label, so the field is reachable by a screen reader. */
export function TextField({
  label,
  hint,
  invalid = false,
  containerStyle,
  style,
  multiline,
  ...rest
}: TextFieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = invalid
    ? theme.colors.danger
    : focused
      ? theme.colors.accent
      : theme.colors.border;

  return (
    <View style={[{ gap: theme.spacing.sm }, containerStyle]}>
      {label ? (
        <Text variant="label" tone="muted">
          {label}
        </Text>
      ) : null}
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.colors.textMuted}
        selectionColor={theme.colors.accent}
        multiline={multiline}
        onFocus={(event) => {
          setFocused(true);
          rest.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          rest.onBlur?.(event);
        }}
        {...rest}
        style={[
          styles.input,
          theme.typography.body,
          {
            color: theme.colors.text,
            backgroundColor: theme.colors.surfaceRaised,
            borderColor,
            borderRadius: theme.radius.md,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: multiline ? theme.spacing.md : 0,
            height: multiline ? undefined : 48,
            minHeight: multiline ? 88 : undefined,
            textAlignVertical: multiline ? 'top' : 'center',
          },
          style,
        ]}
      />
      {hint ? (
        <View style={styles.hintRow}>
          {invalid ? <Icon name="alert" size={14} color={theme.colors.danger} /> : null}
          <Text variant="caption" tone={invalid ? 'danger' : 'muted'}>
            {hint}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: StyleSheet.hairlineWidth * 2 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
