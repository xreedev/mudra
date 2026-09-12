import RNFS from 'react-native-fs';
import {
  clearSentenceMemory,
  deleteRememberedSentence,
  getRememberedSentence,
  glossSequenceKey,
  listRememberedSentences,
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

describe('getRememberedSentence', () => {
  it('returns undefined when nothing has been remembered yet', async () => {
    expect(await getRememberedSentence(['WHERE', 'HOSPITAL'])).toBeUndefined();
  });

  it('recovers safely from corrupted JSON instead of throwing', async () => {
    mockFiles.set(SENTENCE_MEMORY_PATH, '{ not valid json');
    await expect(getRememberedSentence(['WHERE', 'HOSPITAL'])).resolves.toBeUndefined();
  });

  it('returns undefined for an empty gloss sequence', async () => {
    expect(await getRememberedSentence([])).toBeUndefined();
  });
});

describe('rememberSentenceChoice', () => {
  it('round-trips a choice through getRememberedSentence', async () => {
    await rememberSentenceChoice(['WHERE', 'HOSPITAL'], 'Where is the hospital?');
    expect(await getRememberedSentence(['WHERE', 'HOSPITAL'])).toBe('Where is the hospital?');
  });

  it('is keyed independently per sign sequence', async () => {
    await rememberSentenceChoice(['WHERE', 'HOSPITAL'], 'Where is the hospital?');
    await rememberSentenceChoice(['ME', 'ARRIVED'], 'I have arrived.');
    expect(await getRememberedSentence(['WHERE', 'HOSPITAL'])).toBe('Where is the hospital?');
    expect(await getRememberedSentence(['ME', 'ARRIVED'])).toBe('I have arrived.');
  });

  it('a later choice for the same sequence replaces the earlier one', async () => {
    await rememberSentenceChoice(['WHERE', 'HOME'], 'Where is your home?');
    await rememberSentenceChoice(['WHERE', 'HOME'], 'Where am I delivering to?');
    expect(await getRememberedSentence(['WHERE', 'HOME'])).toBe('Where am I delivering to?');
  });

  it('ignores an empty gloss sequence or blank sentence', async () => {
    await rememberSentenceChoice([], 'Where is your home?');
    await rememberSentenceChoice(['WHERE', 'HOME'], '   ');
    expect(await getRememberedSentence(['WHERE', 'HOME'])).toBeUndefined();
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

  it('lists every entry with its tokens split back out, sorted by key', async () => {
    await rememberSentenceChoice(['WHERE', 'HOME'], 'Where is your home?');
    await rememberSentenceChoice(['ME', 'ARRIVED'], 'I have arrived.');
    expect(await listRememberedSentences()).toEqual([
      { key: 'ME ARRIVED', tokens: ['ME', 'ARRIVED'], sentence: 'I have arrived.' },
      { key: 'WHERE HOME', tokens: ['WHERE', 'HOME'], sentence: 'Where is your home?' },
    ]);
  });
});

describe('deleteRememberedSentence', () => {
  it('removes one entry, leaving the others', async () => {
    await rememberSentenceChoice(['WHERE', 'HOME'], 'Where is your home?');
    await rememberSentenceChoice(['ME', 'ARRIVED'], 'I have arrived.');
    await deleteRememberedSentence('WHERE HOME');
    expect(await getRememberedSentence(['WHERE', 'HOME'])).toBeUndefined();
    expect(await getRememberedSentence(['ME', 'ARRIVED'])).toBe('I have arrived.');
  });

  it('is a no-op for a key that is not remembered', async () => {
    await rememberSentenceChoice(['ME', 'ARRIVED'], 'I have arrived.');
    await expect(deleteRememberedSentence('NOT THERE')).resolves.toBeUndefined();
    expect(await getRememberedSentence(['ME', 'ARRIVED'])).toBe('I have arrived.');
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
