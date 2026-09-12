import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from '../theme';

export type IconName =
  | 'call'
  | 'memory'
  | 'sign'
  | 'chat'
  | 'chevron-left'
  | 'chevron-right'
  | 'plus'
  | 'check'
  | 'close'
  | 'trash'
  | 'search'
  | 'shutter'
  | 'flip'
  | 'mic-off'
  | 'send'
  | 'lock'
  | 'pin'
  | 'volume'
  | 'stop';

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  /** Stroke width at a 24px grid; scaled with `size`. */
  weight?: number;
}

/**
 * The app's icon set: hand-written 24px-grid paths, stroked rather than filled so one set reads
 * correctly at every size and in both themes.
 *
 * Deliberately small — an app with four destinations does not need an icon font, and shipping
 * only what is used keeps the bundle honest.
 */
export function Icon({ name, size = 24, color, weight = 1.75 }: IconProps) {
  const theme = useTheme();
  const stroke = color ?? theme.colors.text;
  const strokeWidth = weight;

  const common: StrokeProps = {
    stroke,
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    fill: 'none',
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {renderPaths(name, common, stroke)}
    </Svg>
  );
}

interface StrokeProps {
  stroke: string;
  strokeWidth: number;
  strokeLinecap: 'round';
  strokeLinejoin: 'round';
  fill: 'none';
}

function renderPaths(name: IconName, common: StrokeProps, stroke: string) {
  switch (name) {
    case 'call':
      return (
        <Path
          {...common}
          d="M5.5 3.5h3l1.5 4-2 1.5a10.5 10.5 0 0 0 4.5 4.5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 3.5 5.7 2 2 0 0 1 5.5 3.5Z"
        />
      );
    case 'memory':
      // A layered stack: what the app remembers, one confirmed phrase on top of another.
      return (
        <>
          <Path {...common} d="M12 3.5 20.5 8 12 12.5 3.5 8 12 3.5Z" />
          <Path {...common} d="M3.5 12 12 16.5 20.5 12" />
          <Path {...common} d="M3.5 16 12 20.5 20.5 16" />
        </>
      );
    case 'sign':
      // A frame with a plus: capture a new sign.
      return (
        <>
          <Path
            {...common}
            d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1-1.8A1.5 1.5 0 0 1 10 3.5h4a1.5 1.5 0 0 1 1.3.7l1 1.8h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z"
          />
          <Path {...common} d="M12 9.5v5M9.5 12h5" />
        </>
      );
    case 'chat':
      return (
        <>
          <Path
            {...common}
            d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H12l-4.5 3.5V16H6.5A2.5 2.5 0 0 1 4 13.5v-7Z"
          />
          <Path {...common} d="M8.5 8.5h7M8.5 11.5h4" />
        </>
      );
    case 'chevron-left':
      return <Path {...common} d="M14.5 5.5 8 12l6.5 6.5" />;
    case 'chevron-right':
      return <Path {...common} d="M9.5 5.5 16 12l-6.5 6.5" />;
    case 'plus':
      return <Path {...common} d="M12 5v14M5 12h14" />;
    case 'check':
      return <Path {...common} d="M4.5 12.5 9.5 17.5 19.5 7" />;
    case 'close':
      return <Path {...common} d="M6 6l12 12M18 6 6 18" />;
    case 'trash':
      return (
        <>
          <Path {...common} d="M4.5 7h15M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" />
          <Path {...common} d="M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7" />
          <Path {...common} d="M10.5 11v5M13.5 11v5" />
        </>
      );
    case 'search':
      return (
        <>
          <Circle {...common} cx={11} cy={11} r={6.5} />
          <Path {...common} d="M15.8 15.8 20 20" />
        </>
      );
    case 'shutter':
      return (
        <>
          <Circle {...common} cx={12} cy={12} r={9} />
          <Circle cx={12} cy={12} r={6} fill={stroke} />
        </>
      );
    case 'flip':
      return (
        <>
          <Path {...common} d="M4 9.5A2.5 2.5 0 0 1 6.5 7h11A2.5 2.5 0 0 1 20 9.5v6A2.5 2.5 0 0 1 17.5 18h-11A2.5 2.5 0 0 1 4 15.5v-6Z" />
          <Path {...common} d="M9.5 12.5 12 10l2.5 2.5M12 10v5" />
        </>
      );
    case 'mic-off':
      return (
        <>
          <Path {...common} d="M9.5 5.5a2.5 2.5 0 0 1 5 0v4.2" />
          <Path {...common} d="M17 11.5a5 5 0 0 1-7.7 4.2M7 11.5V12a5 5 0 0 0 1.2 3.3" />
          <Path {...common} d="M12 17.5V20M4.5 4.5l15 15" />
        </>
      );
    case 'send':
      return <Path {...common} d="M4.5 12 20 4.5 15 20l-4-6-6.5-2Z" />;
    case 'lock':
      return (
        <>
          <Rect {...common} x={5} y={10.5} width={14} height={9} rx={2.5} />
          <Path {...common} d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
        </>
      );
    case 'pin':
      return (
        <>
          <Path {...common} d="M12 21s6.5-5.7 6.5-10.5a6.5 6.5 0 0 0-13 0C5.5 15.3 12 21 12 21Z" />
          <Circle {...common} cx={12} cy={10.5} r={2.4} />
        </>
      );
    case 'volume':
      return (
        <>
          <Path {...common} d="M4.5 9.5h3.2L12 6v12l-4.3-3.5H4.5v-5Z" />
          <Path {...common} d="M16 9a4.5 4.5 0 0 1 0 6M18.3 6.8a8 8 0 0 1 0 10.4" />
        </>
      );
    case 'stop':
      return <Rect {...common} x={6} y={6} width={12} height={12} rx={2.5} fill={stroke} />;
    default:
      return null;
  }
}
