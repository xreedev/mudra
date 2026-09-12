import RNFS from 'react-native-fs';

/**
 * Remembers which sentence the user picked, per exact sign sequence — so the
 * next time the same signs come in, that pick can be resurfaced ahead of
 * fresh LLM guesses instead of asking the user to re-choose every time.
 *
 * Deliberately its own small store rather than reusing MemoryScreen's
 * confirmed-phrase list: that screen is a user-curated notebook the person
 * edits directly, while this is a quiet, automatic recall keyed by the raw
 * gloss sequence — same on-disk-JSON approach as userGestureStore.ts.
 */
export const SENTENCE_MEMORY_PATH = `${RNFS.DocumentDirectoryPath}/sign_sentence_memory.json`;
const TEMP_PATH = `${SENTENCE_MEMORY_PATH}.tmp`;

interface SentenceMemoryFile {
  schema: 'sign-sentence-memory-v1';
  entries: Record<string, string>;
}

/** Signing order matters (the same signs in a different order can mean
 *  something different), so tokens are joined as-is and only case/whitespace
 *  normalized for a forgiving lookup. */
export function glossSequenceKey(tokens: readonly string[]): string {
  return tokens.map((token) => token.trim().toUpperCase()).join(' ');
}

/** Returns `{}` if the file doesn't exist yet or is corrupt — a bad file
 *  must never crash the app, it just means "nothing remembered yet". */
export async function loadSentenceMemory(): Promise<Record<string, string>> {
  try {
    const exists = await RNFS.exists(SENTENCE_MEMORY_PATH);
    if (!exists) return {};
    const raw = await RNFS.readFile(SENTENCE_MEMORY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.entries === 'object' && parsed.entries ? parsed.entries : {};
  } catch {
    return {};
  }
}

async function saveSentenceMemory(entries: Record<string, string>): Promise<void> {
  const file: SentenceMemoryFile = { schema: 'sign-sentence-memory-v1', entries };
  await RNFS.writeFile(TEMP_PATH, JSON.stringify(file, null, 2), 'utf8');
  if (await RNFS.exists(SENTENCE_MEMORY_PATH)) {
    await RNFS.unlink(SENTENCE_MEMORY_PATH);
  }
  await RNFS.moveFile(TEMP_PATH, SENTENCE_MEMORY_PATH);
}

/** Records the sentence the user picked for this sign sequence. Last pick
 *  wins per sequence — a later, different choice for the same signs replaces
 *  the earlier one rather than accumulating history. */
export async function rememberSentenceChoice(
  tokens: readonly string[],
  sentence: string,
): Promise<void> {
  const trimmed = sentence.trim();
  if (tokens.length === 0 || !trimmed) return;
  const entries = await loadSentenceMemory();
  entries[glossSequenceKey(tokens)] = trimmed;
  await saveSentenceMemory(entries);
}

/** The remembered sentence for this exact sign sequence, if any. */
export async function getRememberedSentence(
  tokens: readonly string[],
): Promise<string | undefined> {
  if (tokens.length === 0) return undefined;
  const entries = await loadSentenceMemory();
  return entries[glossSequenceKey(tokens)];
}
