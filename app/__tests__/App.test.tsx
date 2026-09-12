/**
 * Smoke test for the UI scaffold: every screen has to mount and render its real content with no
 * native camera, no permissions and no data. That is the state a reviewer (and a fresh clone)
 * sees first, so it is the state worth guarding.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { ThemeProvider } from '../src/theme';
import { AddSignScreen } from '../src/screens/AddSignScreen';
import { ChatScreen } from '../src/screens/ChatScreen';
import { HomeScreen } from '../src/screens/HomeScreen';
import { MemoryScreen } from '../src/screens/MemoryScreen';

// The screens take route props only for typing; the scaffold needs nothing from them.
const asScreen = (Component: unknown) => Component as React.FC;

/** Screens are mounted directly: the scaffold's value is in the screens, not the stack. */
function wrap(node: React.ReactElement) {
  return render(
    <ThemeProvider>
      <NavigationContainer>{node}</NavigationContainer>
    </ThemeProvider>,
  );
}

describe('MUDRA+ scaffold', () => {
  it('shows all four destinations on the home screen', () => {
    wrap(React.createElement(asScreen(HomeScreen)));
    expect(screen.getByText('Say it your way.')).toBeTruthy();
    for (const tile of ['Call someone', 'Memory', 'Add custom sign', 'Chatbot']) {
      expect(screen.getByText(tile)).toBeTruthy();
    }
  });

  it('lists confirmed phrase pairs on the memory screen', () => {
    wrap(React.createElement(asScreen(MemoryScreen)));
    expect(screen.getByText('I want hot tea')).toBeTruthy();
    expect(screen.getByText('METFORMIN')).toBeTruthy();
  });

  it('renders the capture flow without a camera present', () => {
    wrap(React.createElement(asScreen(AddSignScreen)));
    expect(screen.getByText('Add custom sign')).toBeTruthy();
    expect(screen.getByLabelText('Capture sign')).toBeTruthy();
  });

  it('renders the chat composer', () => {
    wrap(React.createElement(asScreen(ChatScreen)));
    expect(screen.getByLabelText('Message')).toBeTruthy();
    expect(screen.getByLabelText('Send message')).toBeTruthy();
  });
});
