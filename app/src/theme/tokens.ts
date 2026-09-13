import { Platform } from 'react-native';

/**
 * Design tokens.
 *
 * One source of truth for colour, spacing, radius and type. Screens never hard-code a hex value
 * or a pixel gap — they read from here, so a palette change is one edit and dark mode comes for
 * free.
 *
 * The palette is intentionally quiet: near-neutral greys carry the layout, a single teal accent
 * carries action, and red is reserved for destructive or emergency intent only. For an assistive
 * app that people use under stress, colour has to mean something.
 */

const palette = {
  teal600: '#0D9488',
  teal500: '#14B8A6',
  teal50: '#ECFDF9',
  teal900: '#052F2A',

  red600: '#DC2626',
  red400: '#F87171',
  red50: '#FEF2F2',

  amber500: '#F59E0B',

  white: '#FFFFFF',
  grey25: '#FBFCFD',
  grey50: '#F6F7F9',
  grey100: '#EFF1F4',
  grey200: '#E3E6EB',
  grey300: '#CBD1D9',
  grey500: '#6B7280',
  grey600: '#4B5563',

  ink900: '#0B0C0E',
  ink800: '#14161A',
  ink700: '#1B1E24',
  ink600: '#24272E',
  ink400: '#3A3F48',
  slate300: '#9BA1AC',
  slate200: '#C7CCD4',
  slate50: '#F2F4F7',
} as const;

export interface ThemeColors {
  /** App background. */
  background: string;
  /** Cards, inputs, tiles. */
  surface: string;
  /** A surface that sits on top of another surface (a chip inside a card). */
  surfaceRaised: string;
  /** Hairline dividers and card outlines. */
  border: string;
  /** A stronger border for focus and selection. */
  borderStrong: string;
  text: string;
  textMuted: string;
  textInverse: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  /** A translucent chip background for something sitting ON TOP of a solid accent fill (e.g. the
   *  hero card's "ON DEVICE" badge) — `accentSoft` itself is too close to `accent` to read there. */
  onAccentSoft: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  /** Camera viewport letterboxing. */
  viewport: string;
  overlay: string;
}

export const lightColors: ThemeColors = {
  background: palette.white,
  surface: palette.grey50,
  surfaceRaised: palette.white,
  border: palette.grey200,
  borderStrong: palette.grey300,
  text: palette.ink900,
  textMuted: palette.grey500,
  textInverse: palette.white,
  accent: palette.teal600,
  accentText: palette.white,
  accentSoft: palette.teal50,
  onAccentSoft: 'rgba(255, 255, 255, 0.20)',
  danger: palette.red600,
  dangerSoft: palette.red50,
  warning: palette.amber500,
  viewport: palette.ink900,
  overlay: 'rgba(11, 12, 14, 0.55)',
};

export const darkColors: ThemeColors = {
  background: palette.ink900,
  surface: palette.ink800,
  surfaceRaised: palette.ink700,
  border: palette.ink600,
  borderStrong: palette.ink400,
  text: palette.slate50,
  textMuted: palette.slate300,
  textInverse: palette.ink900,
  accent: palette.teal500,
  accentText: palette.teal900,
  accentSoft: 'rgba(20, 184, 166, 0.14)',
  onAccentSoft: 'rgba(5, 47, 42, 0.18)',
  danger: palette.red400,
  dangerSoft: 'rgba(248, 113, 113, 0.14)',
  warning: palette.amber500,
  viewport: '#000000',
  overlay: 'rgba(0, 0, 0, 0.6)',
};

/** 4pt spacing scale. Everything in the app is a multiple of these. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 56,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 28,
  pill: 999,
} as const;

/**
 * Type scale. System font on both platforms — it is the one typeface that is already tuned for
 * the device's screen and respects the user's accessibility settings.
 */
export const fontFamily = Platform.select({
  ios: 'System',
  default: 'sans-serif',
});

export const fontFamilyMedium = Platform.select({
  ios: 'System',
  default: 'sans-serif-medium',
});

export const typography = {
  display: { fontSize: 30, lineHeight: 36, letterSpacing: -0.6, fontWeight: '700' },
  title: { fontSize: 22, lineHeight: 28, letterSpacing: -0.3, fontWeight: '700' },
  heading: { fontSize: 17, lineHeight: 24, letterSpacing: -0.2, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  label: { fontSize: 13, lineHeight: 18, letterSpacing: 0.1, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  mono: {
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.4,
    fontWeight: '600',
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
} as const;

/** Two elevation steps, no more. Depth is carried by borders, not by heavy shadows. */
export const elevation = {
  none: {},
  card: Platform.select({
    ios: {
      shadowColor: '#0B0C0E',
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    default: { elevation: 1 },
  }),
  floating: Platform.select({
    ios: {
      shadowColor: '#0B0C0E',
      shadowOpacity: 0.14,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
    },
    default: { elevation: 6 },
  }),
} as const;

/** Minimum touch target. Nothing interactive is smaller than this. */
export const HIT_SLOP_SIZE = 44;
