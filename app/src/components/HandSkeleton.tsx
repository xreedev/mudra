import React from 'react';
import Svg, { Circle, Line } from 'react-native-svg';
import type { HandLandmark } from '../recognition/types';

/** MediaPipe's 21-point hand-landmark connectivity (thumb, then each finger, then the palm). */
const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export interface HandSkeletonProps {
  landmarks: readonly HandLandmark[] | null;
  width: number;
  height: number;
  /** Mirror the x axis — the front camera preview is shown mirrored. */
  mirror?: boolean;
}

/** Draws MediaPipe's live hand skeleton (bones + joints) over the camera preview. */
export function HandSkeleton({ landmarks, width, height, mirror = false }: HandSkeletonProps) {
  if (!landmarks || landmarks.length === 0 || width === 0 || height === 0) return null;

  const point = (index: number) => {
    const landmark = landmarks[index];
    if (!landmark) return null;
    return {
      x: mirror ? (1 - landmark.x) * width : landmark.x * width,
      y: landmark.y * height,
    };
  };

  return (
    <Svg
      width={width}
      height={height}
      style={{ position: 'absolute', top: 0, left: 0 }}
      pointerEvents="none"
    >
      {HAND_CONNECTIONS.map(([a, b], index) => {
        const pa = point(a);
        const pb = point(b);
        if (!pa || !pb) return null;
        return (
          <Line
            key={`bone-${index}`}
            x1={pa.x}
            y1={pa.y}
            x2={pb.x}
            y2={pb.y}
            stroke="#22C55E"
            strokeWidth={3}
          />
        );
      })}
      {landmarks.map((_, index) => {
        const p = point(index);
        if (!p) return null;
        return <Circle key={`joint-${index}`} cx={p.x} cy={p.y} r={5} fill="#4ADE80" />;
      })}
    </Svg>
  );
}
