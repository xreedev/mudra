import React, { useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader, IconButton, Screen, Text } from '../components';
import { SEED_CHAT, type ChatMessage } from '../data/mock';
import { useTheme } from '../theme';
import type { ScreenProps } from '../navigation/types';

/**
 * Chatbot.
 *
 * A plain message list and a composer — no typing indicators, no avatars, no reactions. The
 * assistant's turns are the ones the user will read under pressure, so they get the higher
 * contrast surface and the full text width; the user's own turns are tinted and inset.
 *
 * Replies here are canned. There is no model behind this screen in the scaffold, and the
 * composer deliberately does not pretend otherwise.
 */
export function ChatScreen(_: ScreenProps<'Chat'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const list = useRef<FlatList<ChatMessage>>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(SEED_CHAT);
  const [draft, setDraft] = useState('');

  const send = () => {
    const body = draft.trim();
    if (body.length === 0) return;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setMessages((current) => [
      ...current,
      { id: `${Date.now()}-user`, author: 'user', body, time },
      {
        id: `${Date.now()}-bot`,
        author: 'assistant',
        body: 'This is a placeholder reply — the assistant is not wired up in this build.',
        time,
      },
    ]);
    setDraft('');
    requestAnimationFrame(() => list.current?.scrollToEnd({ animated: true }));
  };

  return (
    <Screen>
      <AppHeader title="Chatbot" subtitle="Help phrasing what you want to say" />

      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.bottom + theme.spacing.md}
      >
        <FlatList
          ref={list}
          data={messages}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingVertical: theme.spacing.md, gap: theme.spacing.md }}
          renderItem={({ item }) => <Bubble message={item} />}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
        />

        <View
          style={[
            styles.composer,
            {
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surfaceRaised,
              borderRadius: theme.radius.xl,
              paddingLeft: theme.spacing.lg,
              paddingRight: theme.spacing.xs,
              marginBottom: theme.spacing.sm,
              gap: theme.spacing.sm,
            },
          ]}
        >
          <TextInput
            accessibilityLabel="Message"
            placeholder="Ask for a phrase..."
            placeholderTextColor={theme.colors.textMuted}
            selectionColor={theme.colors.accent}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={send}
            returnKeyType="send"
            multiline
            style={[
              styles.input,
              theme.typography.body,
              { color: theme.colors.text, paddingVertical: theme.spacing.md },
            ]}
          />
          <IconButton
            name="send"
            accessibilityLabel="Send message"
            variant={draft.trim().length > 0 ? 'accent' : 'surface'}
            size={40}
            disabled={draft.trim().length === 0}
            onPress={send}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** The tucked corner that points a bubble at its author. */
const TAIL_RADIUS = 6;

function Bubble({ message }: { message: ChatMessage }) {
  const theme = useTheme();
  const mine = message.author === 'user';

  return (
    <View style={[styles.bubbleRow, mine ? styles.mine : styles.theirs]}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: mine ? theme.colors.accentSoft : theme.colors.surface,
            borderColor: mine ? 'transparent' : theme.colors.border,
            borderRadius: theme.radius.lg,
            borderBottomRightRadius: mine ? TAIL_RADIUS : theme.radius.lg,
            borderBottomLeftRadius: mine ? theme.radius.lg : TAIL_RADIUS,
            padding: theme.spacing.md,
          },
        ]}
      >
        <Text variant="body">{message.body}</Text>
        <Text variant="caption" tone="muted" style={styles.time}>
          {message.time}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bubbleRow: { flexDirection: 'row' },
  mine: { justifyContent: 'flex-end' },
  theirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '86%', borderWidth: StyleSheet.hairlineWidth * 2, gap: 4 },
  time: { alignSelf: 'flex-end' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  input: { flex: 1, maxHeight: 120 },
});
