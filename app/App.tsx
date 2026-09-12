/**
 * MUDRA+ — UI scaffold.
 *
 * Four destinations, real navigation, real design system, placeholder data. The recognition,
 * call bridge and memory layers plug in behind these screens without changing them.
 */
import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { preloadLocalLlm } from './src/llm/useLocalLlm';
import { RootNavigator } from './src/navigation/RootNavigator';
import { ThemeProvider } from './src/theme';

export default function App() {
  // Start loading the on-device LLM (~8-13s: model mmap + warmup) the
  // moment the app opens, not when the user taps into a call — by then
  // they've usually spent that long just looking at the home screen and
  // picking a contact, so CallScreen's useLocalLlm() finds it already
  // ready instead of making the user wait mid-call. See useLocalLlm.ts.
  useEffect(() => {
    preloadLocalLlm();
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <RootNavigator />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
