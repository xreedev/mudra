import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { AppHeader, Card, ConfirmModal, EmptyState, GlossChips, Icon, Screen, Text } from '../components';
import {
  clearSentenceMemory,
  deleteRememberedSentence,
  listRememberedSentences,
  type RememberedSentenceEntry,
} from '../llm';
import { HIT_SLOP_SIZE, useTheme } from '../theme';
import type { ScreenProps } from '../navigation/types';

/**
 * Memory: sentences remembered per sign sequence.
 *
 * Every entry here was picked automatically — the first time a sign sequence's sentence is
 * confirmed on Call or Talk Aloud, it's remembered so the same signs resurface that pick next
 * time instead of asking the person to choose again. There's nothing to compose manually; this
 * screen only reviews and forgets what's already been learned.
 */
export function MemoryScreen(_: ScreenProps<'Memory'>) {
  const theme = useTheme();
  const [signMemory, setSignMemory] = useState<RememberedSentenceEntry[]>([]);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RememberedSentenceEntry | null>(null);

  useEffect(() => {
    let cancelled = false;
    listRememberedSentences().then((entries) => {
      if (!cancelled) setSignMemory(entries);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setSignMemory((current) => current.filter((entry) => entry.id !== id));
    setPendingDelete(null);
    deleteRememberedSentence(id).catch(() => undefined);
  }, [pendingDelete]);

  const clearAll = useCallback(() => {
    setSignMemory([]);
    setConfirmingClear(false);
    clearSentenceMemory().catch(() => undefined);
  }, []);

  return (
    <Screen>
      <AppHeader
        title="Memory"
        subtitle={`${signMemory.length} sentence${signMemory.length === 1 ? '' : 's'} remembered`}
        action={
          signMemory.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear memory"
              onPress={() => setConfirmingClear(true)}
              hitSlop={6}
              style={styles.clearAllAction}
            >
              <Text variant="bodyStrong" tone="danger">
                Clear all
              </Text>
            </Pressable>
          ) : undefined
        }
      />

      <FlatList
        data={signMemory}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: theme.spacing['4xl'], gap: theme.spacing.md }}
        renderItem={({ item }) => (
          <Card>
            <View style={styles.row}>
              <View style={[styles.text, { gap: theme.spacing.xs }]}>
                <GlossChips tokens={item.tokens} size="sm" />
                <Text variant="bodyStrong">{item.sentence}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Forget "${item.sentence}"`}
                onPress={() => setPendingDelete(item)}
                hitSlop={6}
                style={[styles.deleteAction, { minHeight: HIT_SLOP_SIZE }]}
              >
                <Icon name="trash" size={16} color={theme.colors.textMuted} />
              </Pressable>
            </View>
          </Card>
        )}
        ListEmptyComponent={
          <EmptyState
            icon="memory"
            title="Nothing remembered yet"
            body="Sign into a call or Talk Aloud and confirm a sentence — it's saved here so the same signs recall it next time."
          />
        }
      />

      <ConfirmModal
        visible={confirmingClear}
        title="Clear memory?"
        message={`This forgets all ${signMemory.length} remembered sentence${signMemory.length === 1 ? '' : 's'}. Call and Talk Aloud will fall back to fresh LLM readings.`}
        confirmLabel="Clear all"
        confirmVariant="danger"
        cancelLabel="Cancel"
        onConfirm={clearAll}
        onCancel={() => setConfirmingClear(false)}
      />

      <ConfirmModal
        visible={pendingDelete !== null}
        title="Forget this sentence?"
        message={
          pendingDelete
            ? `"${pendingDelete.sentence}" will no longer be remembered for these signs.`
            : ''
        }
        confirmLabel="Forget"
        confirmVariant="danger"
        cancelLabel="Cancel"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  text: { flex: 1 },
  deleteAction: { flexDirection: 'row', alignItems: 'center' },
  clearAllAction: { minHeight: HIT_SLOP_SIZE, justifyContent: 'center' },
});
