import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useTheme } from '../theme';

export interface GlossBubblesProps {
  tokens: readonly string[];
}

/**
 * Recognized signs shown as small chat bubbles, one per sign, each arriving
 * with a brief delay-then-pop-in — the live equivalent of a message landing
 * in a chat thread, since that's the mental model users already have for
 * "words appearing one at a time as someone communicates."
 */
export function GlossBubbles({ tokens }: GlossBubblesProps) {
  return (
    <View style={styles.row}>
      {tokens.map((token, index) => (
        <Bubble key={`${token}-${index}`} label={token} />
      ))}
    </View>
  );
}

function Bubble({ label }: { label: string }) {
  const theme = useTheme();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(150),
      Animated.spring(progress, {
        toValue: 1,
        friction: 7,
        tension: 60,
        useNativeDriver: true,
      }),
    ]).start();
  }, [progress]);

  return (
    <Animated.View
      style={[
        styles.bubble,
        {
          backgroundColor: theme.colors.accentSoft,
          borderColor: theme.colors.accent,
          borderRadius: theme.radius.pill,
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: 4,
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
          ],
        },
      ]}
    >
      <Text variant="mono" tone="accent" style={styles.text}>
        {label}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  bubble: { borderWidth: StyleSheet.hairlineWidth * 2 },
  text: { fontSize: 11, lineHeight: 15 },
});
