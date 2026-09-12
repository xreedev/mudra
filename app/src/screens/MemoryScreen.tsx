import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import {
  AppHeader,
  Button,
  Card,
  ConfirmModal,
  EmptyState,
  GlossChips,
  Icon,
  IconButton,
  Screen,
  Text,
  TextField,
} from '../components';
import { SEED_MEMORIES, type MemoryPair } from '../data/mock';
import {
  clearSentenceMemory,
  deleteRememberedSentence,
  listRememberedSentences,
  type RememberedSentenceEntry,
} from '../llm';
import { HIT_SLOP_SIZE, useTheme } from '../theme';
import type { ScreenProps } from '../navigation/types';

/**
 * Memory: the pairs of signed input and the sentence the user confirmed for it.
 *
 * Each row shows the gloss sequence as chips above the sentence, because that is the mapping —
 * the signs on top, the English underneath. Search filters both sides, since a user looking for
 * "the tea one" may remember either.
 *
 * State is local to this screen for the scaffold. The shapes match what `@mudra/memory` returns,
 * so wiring the real layer later is a swap of the data source, not a rewrite of the UI.
 */
export function MemoryScreen(_: ScreenProps<'Memory'>) {
  const theme = useTheme();
  const [pairs, setPairs] = useState<MemoryPair[]>(SEED_MEMORIES);
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const [glossDraft, setGlossDraft] = useState('');
  const [sentenceDraft, setSentenceDraft] = useState('');

  // Auto-remembered picks from Call/Talk Aloud (sentenceMemory.ts) — a
  // separate, quiet recall keyed by sign sequence, distinct from the
  // phrases above that the user has explicitly typed or confirmed.
  const [signMemory, setSignMemory] = useState<RememberedSentenceEntry[]>([]);
  const [confirmingClearSignMemory, setConfirmingClearSignMemory] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listRememberedSentences().then((entries) => {
      if (!cancelled) setSignMemory(entries);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const deleteSignMemoryEntry = useCallback((key: string) => {
    setSignMemory((current) => current.filter((entry) => entry.key !== key));
    deleteRememberedSentence(key).catch(() => undefined);
  }, []);

  const clearSignMemory = useCallback(() => {
    setSignMemory([]);
    setConfirmingClearSignMemory(false);
    clearSentenceMemory().catch(() => undefined);
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toUpperCase();
    if (needle.length === 0) return pairs;
    return pairs.filter(
      (pair) =>
        pair.tokens.join(' ').includes(needle) ||
        pair.sentence.toUpperCase().includes(needle),
    );
  }, [pairs, query]);

  const canSave = glossDraft.trim().length > 0 && sentenceDraft.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    const tokens = glossDraft
      .toUpperCase()
      .split(/[\s,|]+/)
      .map((token) => token.trim())
      .filter(Boolean);
    setPairs((current) => [
      { id: String(Date.now()), tokens, sentence: sentenceDraft.trim(), useCount: 0, pinned: false },
      ...current,
    ]);
    setGlossDraft('');
    setSentenceDraft('');
    setComposing(false);
  };

  return (
    <Screen>
      <AppHeader
        title="Memory"
        subtitle={`${pairs.length} confirmed phrases on this device`}
        action={
          <IconButton
            name={composing ? 'close' : 'plus'}
            accessibilityLabel={composing ? 'Cancel new phrase' : 'Add a phrase'}
            variant="surface"
            size={40}
            onPress={() => setComposing(!composing)}
          />
        }
      />

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: theme.spacing['4xl'], gap: theme.spacing.md }}
        ListHeaderComponent={
          <View style={{ gap: theme.spacing.md, paddingBottom: theme.spacing.xs }}>
            {composing ? (
              <Card>
                <Text variant="label" tone="muted">
                  NEW PHRASE
                </Text>
                <View style={{ gap: theme.spacing.md, marginTop: theme.spacing.md }}>
                  <TextField
                    label="Signs"
                    placeholder="ME TEA HOT"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    value={glossDraft}
                    onChangeText={setGlossDraft}
                    hint="One gloss per sign, separated by spaces."
                  />
                  <TextField
                    label="Sentence"
                    placeholder="I want hot tea"
                    value={sentenceDraft}
                    onChangeText={setSentenceDraft}
                    multiline
                  />
                  <Button label="Save phrase" icon="check" block disabled={!canSave} onPress={save} />
                </View>
              </Card>
            ) : null}

            <View style={styles.searchRow}>
              <View style={styles.searchIcon}>
                <Icon name="search" size={18} color={theme.colors.textMuted} />
              </View>
              <TextField
                placeholder="Search signs or sentences"
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
                containerStyle={styles.searchField}
                style={styles.searchInput}
              />
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <MemoryRow
            pair={item}
            onDelete={() => setPairs((current) => current.filter((entry) => entry.id !== item.id))}
            onTogglePin={() =>
              setPairs((current) =>
                current.map((entry) =>
                  entry.id === item.id ? { ...entry, pinned: !entry.pinned } : entry,
                ),
              )
            }
          />
        )}
        ListEmptyComponent={
          query.length > 0 ? (
            <EmptyState
              icon="search"
              title="No matches"
              body={`Nothing saved matches "${query.trim()}".`}
            />
          ) : (
            <EmptyState
              icon="memory"
              title="No phrases yet"
              body="Confirm a sentence on a call and it is saved here for next time."
              action={<Button label="Add one manually" icon="plus" onPress={() => setComposing(true)} />}
            />
          )
        }
        ListFooterComponent={
          signMemory.length > 0 ? (
            <View style={{ gap: theme.spacing.md, marginTop: theme.spacing.xl }}>
              <View style={styles.signMemoryHeader}>
                <View>
                  <Text variant="label" tone="muted">
                    SIGN MEMORY
                  </Text>
                  <Text
                    variant="caption"
                    tone="muted"
                    style={{ marginTop: theme.spacing.xs / 2, maxWidth: 260 }}
                  >
                    Sentences remembered per sign sequence from Call and Talk Aloud.
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear sign memory"
                  onPress={() => setConfirmingClearSignMemory(true)}
                  hitSlop={6}
                  style={styles.clearAllAction}
                >
                  <Text variant="caption" tone="danger">
                    Clear all
                  </Text>
                </Pressable>
              </View>

              {signMemory.map((entry) => (
                <Card key={entry.key} tone="flat">
                  <View style={styles.signMemoryRow}>
                    <View style={[styles.signMemoryText, { gap: theme.spacing.xs }]}>
                      <GlossChips tokens={entry.tokens} size="sm" />
                      <Text variant="body">{entry.sentence}</Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Forget "${entry.sentence}"`}
                      onPress={() => deleteSignMemoryEntry(entry.key)}
                      hitSlop={6}
                      style={[styles.rowAction, { minHeight: HIT_SLOP_SIZE }]}
                    >
                      <Icon name="trash" size={16} color={theme.colors.textMuted} />
                    </Pressable>
                  </View>
                </Card>
              ))}
            </View>
          ) : null
        }
      />

      <ConfirmModal
        visible={confirmingClearSignMemory}
        title="Clear sign memory?"
        message={`This forgets all ${signMemory.length} remembered sentence${signMemory.length === 1 ? '' : 's'}. Call and Talk Aloud will fall back to fresh LLM readings.`}
        confirmLabel="Clear all"
        confirmVariant="danger"
        cancelLabel="Cancel"
        onConfirm={clearSignMemory}
        onCancel={() => setConfirmingClearSignMemory(false)}
      />
    </Screen>
  );
}

function MemoryRow({
  pair,
  onDelete,
  onTogglePin,
}: {
  pair: MemoryPair;
  onDelete: () => void;
  onTogglePin: () => void;
}) {
  const theme = useTheme();

  return (
    <Card>
      <View style={styles.rowTop}>
        <GlossChips tokens={pair.tokens} size="sm" />
      </View>

      <View style={[styles.arrowRow, { marginVertical: theme.spacing.sm, gap: theme.spacing.xs }]}>
        <View style={[styles.arrowLine, { backgroundColor: theme.colors.border }]} />
        <Icon name="chevron-right" size={14} color={theme.colors.textMuted} />
      </View>

      <Text variant="bodyStrong">{pair.sentence}</Text>

      <View style={[styles.rowMeta, { marginTop: theme.spacing.md }]}>
        <Text variant="caption" tone="muted">
          Used {pair.useCount} {pair.useCount === 1 ? 'time' : 'times'}
        </Text>
        <View style={[styles.rowActions, { gap: theme.spacing.lg }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={pair.pinned ? 'Unpin phrase' : 'Pin phrase'}
            onPress={onTogglePin}
            hitSlop={6}
            style={[styles.rowAction, { minHeight: HIT_SLOP_SIZE, gap: theme.spacing.xs }]}
          >
            <Icon
              name="pin"
              size={16}
              color={pair.pinned ? theme.colors.accent : theme.colors.textMuted}
            />
            <Text variant="caption" tone={pair.pinned ? 'accent' : 'muted'}>
              {pair.pinned ? 'Pinned' : 'Pin'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete phrase"
            onPress={onDelete}
            hitSlop={6}
            style={[styles.rowAction, { minHeight: HIT_SLOP_SIZE, gap: theme.spacing.xs }]}
          >
            <Icon name="trash" size={16} color={theme.colors.textMuted} />
          </Pressable>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  searchRow: { justifyContent: 'center' },
  searchField: { flex: 1 },
  searchInput: { paddingLeft: 42 },
  searchIcon: { position: 'absolute', left: 14, zIndex: 1 },
  rowTop: { flexDirection: 'row' },
  arrowRow: { flexDirection: 'row', alignItems: 'center' },
  arrowLine: { height: StyleSheet.hairlineWidth * 2, width: 18 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowActions: { flexDirection: 'row', alignItems: 'center' },
  rowAction: { flexDirection: 'row', alignItems: 'center' },
  signMemoryHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  clearAllAction: { minHeight: HIT_SLOP_SIZE, justifyContent: 'center' },
  signMemoryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  signMemoryText: { flex: 1 },
});
