import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import {
  darkColors,
  elevation,
  fontFamily,
  fontFamilyMedium,
  lightColors,
  radius,
  spacing,
  typography,
  type ThemeColors,
} from './tokens';

export interface Theme {
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  elevation: typeof elevation;
  fontFamily: string;
  fontFamilyMedium: string;
  isDark: boolean;
}

const ThemeContext = createContext<Theme | null>(null);

/**
 * Follows the system colour scheme. There is no in-app theme switch on purpose: the OS setting
 * is the one the user already made, and honouring it is the accessible default.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';

  const theme = useMemo<Theme>(
    () => ({
      colors: isDark ? darkColors : lightColors,
      spacing,
      radius,
      typography,
      elevation,
      fontFamily: fontFamily ?? 'System',
      fontFamilyMedium: fontFamilyMedium ?? 'System',
      isDark,
    }),
    [isDark],
  );

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside <ThemeProvider>');
  return theme;
}
