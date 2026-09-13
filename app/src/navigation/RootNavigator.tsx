import React from 'react';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AddSignScreen, CallScreen, HomeScreen, MemoryScreen, ReceiveScreen } from '../screens';
import { useTheme } from '../theme';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * A flat stack under Home.
 *
 * Native headers are off everywhere: each screen draws its own `AppHeader` so the title can be
 * left-aligned and typographic, and so the camera screens can go edge to edge. Navigation's own
 * theme is still fed our colours, because it paints the background behind screen transitions.
 */
export function RootNavigator() {
  const theme = useTheme();

  const navigationTheme = {
    ...(theme.isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(theme.isDark ? DarkTheme : DefaultTheme).colors,
      background: theme.colors.background,
      card: theme.colors.background,
      text: theme.colors.text,
      border: theme.colors.border,
      primary: theme.colors.accent,
    },
  };

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Call" component={CallScreen} />
        <Stack.Screen name="Receive" component={ReceiveScreen} />
        <Stack.Screen name="Memory" component={MemoryScreen} />
        <Stack.Screen name="AddSign" component={AddSignScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
