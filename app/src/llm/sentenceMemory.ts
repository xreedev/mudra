import RNFS from 'react-native-fs';

/**
 * Remembers which sentences the user has picked, per exact sign sequence —
 * so the next time the same signs come in, those picks can be resurfaced
 * ahead of fresh LLM guesses instead of asking the user to re-choose every
 * time.
 *
 * A sequence can genuinely mean more than one thing ("ARRIVED HOME" said by
 * the customer vs. the driver), so picking a DIFFERENT sentence for the same
 * signs on a later occasion adds it as another remembered option rather than
 * replacing the earlier one — the same ambiguity `GLOSS_TO_TEXT_OPTIONS_SYSTEM`
 * already asks the LLM to handle, just remembered instead of re-guessed.
 *
 * Deliberately its own small store rather than reusing MemoryScreen's old
 * confirmed-phrase list — this is a quiet, automatic recall keyed by the raw
 * gloss sequence, same on-disk-JSON approach as userGestureStore.ts.
 */
export const SENTENCE_MEMORY_PATH = `${RNFS.DocumentDirectoryPath}/sign_sentence_memory.json`;
const TEMP_PATH = `${SENTENCE_MEMORY_PATH}.tmp`;

/** Total candidate sentences ever shown for one sign sequence (memory +
 *  LLM combined) — also the cap on how many distinct sentences are kept
 *  in memory per sequence, since storing more than could ever be shown is
 *  pointless. Once a sequence has this many remembered, the LLM is never
 *  called for it: memory alone already fills every slot. */
export const MAX_CANDIDATES_PER_SEQUENCE = 3;

interface SentenceMemoryFileV2 {
  schema: 'sign-sentence-memory-v2';
  /** Each sequence's sentences, most-recently-picked first. */
  entries: Record<string, string[]>;
}

/** Signing order matters (the same signs in a different order can mean
 *  something different), so tokens are joined as-is and only case/whitespace
 *  normalized for a forgiving lookup. */
export function glossSequenceKey(tokens: readonly string[]): string {
  return tokens.map((token) => token.trim().toUpperCase()).join(' ');
}

function normalize(sentence: string): string {
  return sentence.trim().toLowerCase();
}

/** Returns `{}` if the file doesn't exist yet or is corrupt — a bad file
 *  must never crash the app, it just means "nothing remembered yet".
 *  Transparently upgrades the earlier one-sentence-per-sequence format
 *  (schema v1, `entries[key]` a single string) into the current array
 *  shape, so an existing on-disk file from before this change still reads
 *  correctly. */
export async function loadSentenceMemory(): Promise<Record<string, string[]>> {
  try {
    const exists = await RNFS.exists(SENTENCE_MEMORY_PATH);
    if (!exists) return {};
    const raw = await RNFS.readFile(SENTENCE_MEMORY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.entries !== 'object' || !parsed.entries) return {};

    const out: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(parsed.entries as Record<string, unknown>)) {
      if (typeof value === 'string') {
        out[key] = [value];
      } else if (Array.isArray(value)) {
        out[key] = value.filter((s): s is string => typeof s === 'string');
      }
    }
    return out;
  } catch {
    return {};
  }
}

async function saveSentenceMemory(entries: Record<string, string[]>): Promise<void> {
  const file: SentenceMemoryFileV2 = { schema: 'sign-sentence-memory-v2', entries };
  await RNFS.writeFile(TEMP_PATH, JSON.stringify(file, null, 2), 'utf8');
  if (await RNFS.exists(SENTENCE_MEMORY_PATH)) {
    await RNFS.unlink(SENTENCE_MEMORY_PATH);
  }
  await RNFS.moveFile(TEMP_PATH, SENTENCE_MEMORY_PATH);
}

/**
 * Records a sentence the user picked for this sign sequence. A sentence
 * that's new for this sequence is added, most-recent first, rather than
 * replacing whatever was remembered before — the same signs can genuinely
 * mean different things on different occasions. Re-picking a sentence
 * that's already remembered just bumps it back to the front instead of
 * duplicating it. The list per sequence is capped at
 * `MAX_CANDIDATES_PER_SEQUENCE`; a new pick past the cap evicts the
 * least-recently-picked one.
 */
export async function rememberSentenceChoice(
  tokens: readonly string[],
  sentence: string,
): Promise<void> {
  const trimmed = sentence.trim();
  if (tokens.length === 0 || !trimmed) return;
  const entries = await loadSentenceMemory();
  const key = glossSequenceKey(tokens);
  const existing = entries[key] ?? [];
  const withoutDuplicate = existing.filter((s) => normalize(s) !== normalize(trimmed));
  entries[key] = [trimmed, ...withoutDuplicate].slice(0, MAX_CANDIDATES_PER_SEQUENCE);
  await saveSentenceMemory(entries);
}

/** Every sentence remembered for this exact sign sequence, most-recently-
 *  picked first — `[]` if nothing has been remembered for it yet. */
export async function getRememberedSentences(tokens: readonly string[]): Promise<string[]> {
  if (tokens.length === 0) return [];
  const entries = await loadSentenceMemory();
  return entries[glossSequenceKey(tokens)] ?? [];
}

export interface RememberedSentenceEntry {
  /** Unique per remembered sentence — what `deleteRememberedSentence` takes. */
  id: string;
  /** The sequence's `glossSequenceKey` — shared by every sentence remembered
   *  for the same signs. */
  key: string;
  tokens: string[];
  sentence: string;
}

function entryId(key: string, sentence: string): string {
  return `${key}␟${sentence}`;
}

/** Every remembered sentence, one row per (sequence, sentence) pair, for a
 *  "Memory" screen to list — a sequence with multiple remembered sentences
 *  produces multiple rows, sorted by key then by their stored (most-recent-
 *  first) order. */
export async function listRememberedSentences(): Promise<RememberedSentenceEntry[]> {
  const entries = await loadSentenceMemory();
  return Object.entries(entries)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([key, sentences]) =>
      sentences.map((sentence) => ({
        id: entryId(key, sentence),
        key,
        tokens: key.split(' ').filter(Boolean),
        sentence,
      })),
    );
}

/** Removes one remembered sentence, by the `id` `listRememberedSentences`
 *  gave it. A no-op if it's already gone. Removes the sequence's entry
 *  entirely once its last sentence is removed. */
export async function deleteRememberedSentence(id: string): Promise<void> {
  const entries = await loadSentenceMemory();
  let changed = false;
  for (const [key, sentences] of Object.entries(entries)) {
    const next = sentences.filter((sentence) => entryId(key, sentence) !== id);
    if (next.length === sentences.length) continue;
    changed = true;
    if (next.length === 0) {
      delete entries[key];
    } else {
      entries[key] = next;
    }
  }
  if (changed) await saveSentenceMemory(entries);
}

/** Forgets every remembered sentence. */
export async function clearSentenceMemory(): Promise<void> {
  await saveSentenceMemory({});
}
