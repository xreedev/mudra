import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import {
  AppHeader,
  Button,
  Card,
  EmptyState,
  GlossChips,
  Icon,
  IconButton,
  Screen,
  Text,
  TextField,
} from '../components';
import { SEED_MEMORIES, type MemoryPair } from '../data/mock';
import { useTheme } from '../theme';
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

      <View style={[styles.arrowRow, { marginVertical: theme.spacing.sm }]}>
        <View style={[styles.arrowLine, { backgroundColor: theme.colors.border }]} />
        <Icon name="chevron-right" size={14} color={theme.colors.textMuted} />
      </View>

      <Text variant="bodyStrong">{pair.sentence}</Text>

      <View style={[styles.rowMeta, { marginTop: theme.spacing.md }]}>
        <Text variant="caption" tone="muted">
          Used {pair.useCount} {pair.useCount === 1 ? 'time' : 'times'}
        </Text>
        <View style={styles.rowActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={pair.pinned ? 'Unpin phrase' : 'Pin phrase'}
            onPress={onTogglePin}
            hitSlop={10}
            style={styles.rowAction}
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
            hitSlop={10}
            style={styles.rowAction}
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
  arrowRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  arrowLine: { height: StyleSheet.hairlineWidth * 2, width: 18 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  rowAction: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
