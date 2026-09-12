import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Text } from './Text';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** How long a hand must be held before the ring completes. Exported so
 *  callers that need to judge hold stability (e.g. Add custom sign) can
 *  size their sample window to match. */
export const HOLD_MS = 1000;
/** Pause between one capture completing and the next hold starting, so a
 *  new sign has to visibly form rather than the ring immediately refilling
 *  on whatever the hand happens to still be doing. */
const COOLDOWN_MS = 1500;
const STROKE_WIDTH = 4;

export interface SignGuideCircleProps {
  /** Whether a hand is currently detected in frame. */
  active: boolean;
  /** Diameter of the guide circle. */
  size?: number;
  /** Fires once when a hand has been held in frame for `HOLD_MS` — the
   *  caller takes the snapshot and processes the sign at that moment. */
  onComplete: () => void;
}

/**
 * The placement guide shown over the live camera preview: a white circle
 * marking where to hold a sign. Once a hand is detected, its perimeter
 * fills in over one second as a progress ring; reaching full circle fires
 * `onComplete`, which the caller uses to snapshot and process the sign.
 * Once a hold starts it always runs to completion — briefly losing the hand
 * mid-hold (a jittery frame, a hand dipping out of the circle) does not
 * cancel it; the snapshot fires at 1s regardless. After each capture there's
 * a 1.5s pause before the ring can start filling again, so the next sign
 * has time to actually form instead of the ring refilling instantly.
 */
export function SignGuideCircle({ active, size = 300, onComplete }: SignGuideCircleProps) {
  const progress = useRef(new Animated.Value(0)).current;
  const runningRef = useRef(false);
  const [running, setRunning] = useState(false);
  // `onComplete` is a new function identity most frames (it closes over the
  // live match), but the hold timer must only start once per hold — not
  // rebind on every re-render — so a ref carries the latest callback.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  // A completed hold must chain straight into the next one for as long as
  // the hand stays put — the effect below only re-fires when `active`
  // flips, so relying on that alone meant a second sign only started
  // recording once the hand left frame and came back. The completion
  // callback checks this ref instead of waiting for a prop change.
  const activeRef = useRef(active);
  activeRef.current = active;
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active || runningRef.current) return;

    const startHold = () => {
      runningRef.current = true;
      setRunning(true);
      progress.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: HOLD_MS,
        useNativeDriver: false,
      }).start(({ finished }) => {
        runningRef.current = false;
        setRunning(false);
        progress.setValue(0);
        if (finished) {
          onCompleteRef.current();
        }
        cooldownTimer.current = setTimeout(() => {
          if (activeRef.current && !runningRef.current) {
            startHold();
          }
        }, COOLDOWN_MS);
      });
    };

    startHold();

    return () => {
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    };
  }, [active, progress]);

  const radius = (size - STROKE_WIDTH) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });

  return (
    <View style={[styles.wrap, { width: size, height: size }]} pointerEvents="none">
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(255,255,255,0.35)"
          strokeWidth={STROKE_WIDTH}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#FFFFFF"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference}, ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      {!running ? (
        <Text variant="caption" style={styles.hint}>
          Hold sign here
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  hint: { color: 'rgba(255,255,255,0.75)' },
});
