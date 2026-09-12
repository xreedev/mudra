/**
 * MUDRA+ — UI scaffold.
 *
 * Four destinations, real navigation, real design system, placeholder data. The recognition,
 * call bridge and memory layers plug in behind these screens without changing them.
 */
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { ThemeProvider } from './src/theme';

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <RootNavigator />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
