import RNFS from 'react-native-fs';
import {
  clearSentenceMemory,
  deleteRememberedSentence,
  getRememberedSentences,
  glossSequenceKey,
  listRememberedSentences,
  MAX_CANDIDATES_PER_SEQUENCE,
  rememberSentenceChoice,
  SENTENCE_MEMORY_PATH,
} from '..';

jest.mock('react-native-fs', () => {
  const files = new Map<string, string>();
  return {
    DocumentDirectoryPath: '/mock-documents',
    __files: files,
    exists: jest.fn(async (path: string) => files.has(path)),
    readFile: jest.fn(async (path: string) => {
      if (!files.has(path)) throw new Error('ENOENT: no such file');
      return files.get(path) as string;
    }),
    writeFile: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    unlink: jest.fn(async (path: string) => {
      files.delete(path);
    }),
    moveFile: jest.fn(async (from: string, to: string) => {
      if (!files.has(from)) throw new Error('ENOENT: no such file');
      files.set(to, files.get(from) as string);
      files.delete(from);
    }),
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFiles = (RNFS as any).__files as Map<string, string>;

beforeEach(() => {
  mockFiles.clear();
  jest.clearAllMocks();
});

describe('glossSequenceKey', () => {
  it('joins tokens in signing order', () => {
    expect(glossSequenceKey(['WHERE', 'HOSPITAL'])).toBe('WHERE HOSPITAL');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(glossSequenceKey([' where ', 'Hospital'])).toBe('WHERE HOSPITAL');
  });

  it('treats a different order as a different key', () => {
    expect(glossSequenceKey(['HOSPITAL', 'WHERE'])).not.toBe(glossSequenceKey(['WHERE', 'HOSPITAL']));
  });
});

describe('getRememberedSentences', () => {
  it('returns [] when nothing has been remembered yet', async () => {
    expect(await getRememberedSentences(['WHERE', 'HOSPITAL'])).toEqual([]);
  });

  it('recovers safely from corrupted JSON instead of throwing', async () => {
    mockFiles.set(SENTENCE_MEMORY_PATH, '{ not valid json');
    await expect(getRememberedSentences(['WHERE', 'HOSPITAL'])).resolves.toEqual([]);
  });

  it('returns [] for an empty gloss sequence', async () => {
    expect(await getRememberedSentences([])).toEqual([]);
  });

  it('reads an old single-sentence-per-sequence file (schema v1) as a one-item list', async () => {
    mockFiles.set(
      SENTENCE_MEMORY_PATH,
      JSON.stringify({ schema: 'sign-sentence-memory-v1', entries: { 'WHERE HOSPITAL': 'Where is the hospital?' } }),
    );
    expect(await getRememberedSentences(['WHERE', 'HOSPITAL'])).toEqual(['Where is the hospital?']);
  });
});

describe('rememberSentenceChoice', () => {
  it('round-trips a choice through getRememberedSentences', async () => {
    await rememberSentenceChoice(['WHERE', 'HOSPITAL'], 'Where is the hospital?');
    expect(await getRememberedSentences(['WHERE', 'HOSPITAL'])).toEqual(['Where is the hospital?']);
  });

  it('is keyed independently per sign sequence', async () => {
    await rememberSentenceChoice(['WHERE', 'HOSPITAL'], 'Where is the hospital?');
    await rememberSentenceChoice(['ME', 'ARRIVED'], 'I have arrived.');
    expect(await getRememberedSentences(['WHERE', 'HOSPITAL'])).toEqual(['Where is the hospital?']);
    expect(await getRememberedSentences(['ME', 'ARRIVED'])).toEqual(['I have arrived.']);
  });

  it('a different choice for the same sequence is ADDED, not replaced, most-recent first', async () => {
    await rememberSentenceChoice(['WHERE', 'HOME'], 'Where is your home?');
    await rememberSentenceChoice(['WHERE', 'HOME'], 'Where am I delivering to?');
    expect(await getRememberedSentences(['WHERE', 'HOME'])).toEqual([
      'Where am I delivering to?',
      'Where is your home?',
    ]);
  });

  it('re-picking an already-remembered sentence bumps it to the front instead of duplicating it', async () => {
    await rememberSentenceChoice(['WHERE', 'HOME'], 'Where is your home?');
    await rememberSentenceChoice(['WHERE', 'HOME'], 'Where am I delivering to?');
    await rememberSentenceChoice(['WHERE', 'HOME'], 'where is your home?'); // same text, different case
    expect(await getRememberedSentences(['WHERE', 'HOME'])).toEqual([
      'where is your home?',
      'Where am I delivering to?',
    ]);
  });

  it(`caps stored sentences per sequence at MAX_CANDIDATES_PER_SEQUENCE (${MAX_CANDIDATES_PER_SEQUENCE}), evicting the least-recently-picked one`, async () => {
    for (let i = 1; i <= MAX_CANDIDATES_PER_SEQUENCE + 1; i++) {
      await rememberSentenceChoice(['GO'], `Option ${i}`);
    }
    const remembered = await getRememberedSentences(['GO']);
    expect(remembered).toHaveLength(MAX_CANDIDATES_PER_SEQUENCE);
    expect(remembered[0]).toBe(`Option ${MAX_CANDIDATES_PER_SEQUENCE + 1}`);
    expect(remembered).not.toContain('Option 1');
  });

  it('ignores an empty gloss sequence or blank sentence', async () => {
    await rememberSentenceChoice([], 'Where is your home?');
    await rememberSentenceChoice(['WHERE', 'HOME'], '   ');
    expect(await getRememberedSentences(['WHERE', 'HOME'])).toEqual([]);
  });

  it('writes to a temp path and moves it into place, not writing the real path directly', async () => {
    await rememberSentenceChoice(['WHERE', 'HOME'], 'Where is your home?');
    expect(RNFS.writeFile).toHaveBeenCalledWith(
      `${SENTENCE_MEMORY_PATH}.tmp`,
      expect.any(String),
      'utf8',
    );
    expect(RNFS.moveFile).toHaveBeenCalledWith(`${SENTENCE_MEMORY_PATH}.tmp`, SENTENCE_MEMORY_PATH);
  });
});

describe('listRememberedSentences', () => {
  it('returns [] when nothing has been remembered yet', async () => {
    expect(await listRememberedSentences()).toEqual([]);
  });

  it('lists one row per remembered sentence, tokens split back out, sorted by key', async () => {
    await rememberSentenceChoice(['WHERE', 'HOME'], 'Where is your home?');
    await rememberSentenceChoice(['ME', 'ARRIVED'], 'I have arrived.');
    const rows = await listRememberedSentences();
    expect(rows.map(({ id: _id, ...rest }) => rest)).toEqual([
      { key: 'ME ARRIVED', tokens: ['ME', 'ARRIVED'], sentence: 'I have arrived.' },
      { key: 'WHERE HOME', tokens: ['WHERE', 'HOME'], sentence: 'Where is your home?' },
    ]);
  });

  it('lists multiple rows sharing a key when a sequence has more than one remembered sentence', async () => {
    await rememberSentenceChoice(['WHERE', 'HOME'], 'Where is your home?');
    await rememberSentenceChoice(['WHERE', 'HOME'], 'Where am I delivering to?');
    const rows = await listRememberedSentences();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.key === 'WHERE HOME')).toBe(true);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2); // distinct ids
    expect(rows.map((row) => row.sentence)).toEqual([
      'Where am I delivering to?',
      'Where is your home?',
    ]);
  });
});

describe('deleteRememberedSentence', () => {
  it('removes one sentence by id, leaving a sibling for the same sequence intact', async () => {
    await rememberSentenceChoice(['WHERE', 'HOME'], 'Where is your home?');
    await rememberSentenceChoice(['WHERE', 'HOME'], 'Where am I delivering to?');
    const [first] = await listRememberedSentences();
    await deleteRememberedSentence(first.id);
    const remaining = await listRememberedSentences();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].sentence).not.toBe(first.sentence);
  });

  it('removes the sequence entirely once its last sentence is removed', async () => {
    await rememberSentenceChoice(['ME', 'ARRIVED'], 'I have arrived.');
    const [only] = await listRememberedSentences();
    await deleteRememberedSentence(only.id);
    expect(await getRememberedSentences(['ME', 'ARRIVED'])).toEqual([]);
    expect(await listRememberedSentences()).toEqual([]);
  });

  it('is a no-op for an id that does not exist', async () => {
    await rememberSentenceChoice(['ME', 'ARRIVED'], 'I have arrived.');
    await expect(deleteRememberedSentence('not-a-real-id')).resolves.toBeUndefined();
    expect(await getRememberedSentences(['ME', 'ARRIVED'])).toEqual(['I have arrived.']);
  });
});

describe('clearSentenceMemory', () => {
  it('removes every remembered entry', async () => {
    await rememberSentenceChoice(['WHERE', 'HOME'], 'Where is your home?');
    await rememberSentenceChoice(['ME', 'ARRIVED'], 'I have arrived.');
    await clearSentenceMemory();
    expect(await listRememberedSentences()).toEqual([]);
  });
});
