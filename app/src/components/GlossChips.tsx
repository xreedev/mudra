import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useTheme } from '../theme';

export interface GlossChipsProps {
  tokens: readonly string[];
  /** `accent` for the sequence currently being recognized. */
  tone?: 'default' | 'accent';
  size?: 'sm' | 'md';
}

/**
 * A gloss sequence, one chip per sign — `ME` `TEA` `HOT`.
 *
 * Glosses are shown as discrete chips rather than a `ME|TEA|HOT` string because that is what
 * they are: separate signs, in order. It also makes a misrecognized sign easy to point at.
 */
export function GlossChips({ tokens, tone = 'default', size = 'md' }: GlossChipsProps) {
  const theme = useTheme();
  const accent = tone === 'accent';

  return (
    <View style={[styles.row, { gap: theme.spacing.xs }]}>
      {tokens.map((token, index) => (
        <View
          key={`${token}-${index}`}
          style={[
            styles.chip,
            {
              backgroundColor: accent ? theme.colors.accentSoft : theme.colors.surface,
              borderColor: accent ? theme.colors.accent : theme.colors.border,
              borderRadius: theme.radius.sm,
              paddingHorizontal: size === 'sm' ? theme.spacing.sm : theme.spacing.md,
              paddingVertical: theme.spacing.xs,
            },
          ]}
        >
          <Text
            variant="mono"
            tone={accent ? 'accent' : 'default'}
            style={size === 'sm' ? styles.chipTextSmall : undefined}
          >
            {token}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  chip: { borderWidth: StyleSheet.hairlineWidth * 2 },
  chipTextSmall: { fontSize: 11, lineHeight: 15 },
});
