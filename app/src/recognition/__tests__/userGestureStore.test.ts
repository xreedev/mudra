import RNFS from 'react-native-fs';
import {
  FEATURE_VECTOR_LENGTH,
  loadUserGestures,
  saveUserGestures,
  subscribeUserGesturesChanged,
  upsertUserGesture,
  USER_GESTURES_PATH,
} from '..';
import type { GestureTemplate } from '..';

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

/** A minimal template for pure upsert tests — features shape doesn't matter there. */
function template(label: string, feature: number): GestureTemplate {
  return { label, created_at: '2024-01-01T00:00:00.000Z', features: [feature] };
}

/** A template with a real-shaped features array, for round-tripping through
 *  `saveUserGestures`/`loadUserGestures`, which validates feature dimension. */
function validTemplate(label: string, seed: number): GestureTemplate {
  return {
    label,
    created_at: '2024-01-01T00:00:00.000Z',
    features: Array.from({ length: FEATURE_VECTOR_LENGTH }, (_, index) => seed + index * 0.001),
  };
}

beforeEach(() => {
  mockFiles.clear();
  jest.clearAllMocks();
});

describe('upsertUserGesture', () => {
  it('appends a new label', () => {
    const result = upsertUserGesture([template('A', 1)], template('B', 2));
    expect(result.map((t) => t.label)).toEqual(['A', 'B']);
  });

  it('replaces an existing label case-insensitively', () => {
    const updated = template('a', 9);
    const result = upsertUserGesture([template('A', 1), template('B', 2)], updated);
    expect(result).toEqual([updated, template('B', 2)]);
  });

  it('treats surrounding whitespace as the same label too', () => {
    const updated = template(' Arrived ', 9);
    const result = upsertUserGesture([template('ARRIVED', 1)], updated);
    expect(result).toEqual([updated]);
  });

  it('does not mutate the input array', () => {
    const original = [template('A', 1)];
    upsertUserGesture(original, template('A', 5));
    expect(original).toEqual([template('A', 1)]);
  });
});

describe('loadUserGestures', () => {
  it('returns [] when the file does not exist yet', async () => {
    expect(await loadUserGestures()).toEqual([]);
  });

  it('recovers safely from corrupted JSON instead of throwing', async () => {
    mockFiles.set(USER_GESTURES_PATH, '{ this is not valid json');
    await expect(loadUserGestures()).resolves.toEqual([]);
  });

  it('skips invalid records but keeps the valid ones', async () => {
    mockFiles.set(
      USER_GESTURES_PATH,
      JSON.stringify({
        schema: 'custom-gesture-snapshot-v1',
        gestures: [{ label: 'BAD', features: [1, 2, 3] }, validTemplate('GOOD', 1)],
      }),
    );
    const loaded = await loadUserGestures();
    expect(loaded.map((t) => t.label)).toEqual(['GOOD']);
  });
});

describe('saveUserGestures', () => {
  it('round-trips a saved set of gestures through load', async () => {
    const gestures = [validTemplate('A', 1), validTemplate('B', 2)];
    await saveUserGestures(gestures);
    expect(await loadUserGestures()).toEqual(gestures);
  });

  it('writes to a temp path and moves it into place, not writing the real path directly', async () => {
    await saveUserGestures([validTemplate('A', 1)]);
    expect(RNFS.writeFile).toHaveBeenCalledWith(`${USER_GESTURES_PATH}.tmp`, expect.any(String), 'utf8');
    expect(RNFS.moveFile).toHaveBeenCalledWith(`${USER_GESTURES_PATH}.tmp`, USER_GESTURES_PATH);
    expect(mockFiles.has(USER_GESTURES_PATH)).toBe(true);
  });

  it('propagates a write failure to the caller instead of failing silently', async () => {
    (RNFS.writeFile as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    await expect(saveUserGestures([validTemplate('A', 1)])).rejects.toThrow('disk full');
    expect(mockFiles.has(USER_GESTURES_PATH)).toBe(false);
  });
});

describe('subscribeUserGesturesChanged', () => {
  const unsubscribers: Array<() => void> = [];
  function subscribe(listener: () => void) {
    const unsubscribe = subscribeUserGesturesChanged(listener);
    unsubscribers.push(unsubscribe);
    return unsubscribe;
  }

  afterEach(() => {
    unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  });

  it('notifies a subscribed listener when a save completes', async () => {
    const listener = jest.fn();
    subscribe(listener);
    await saveUserGestures([validTemplate('A', 1)]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies every subscribed listener, e.g. multiple mounted screens', async () => {
    const first = jest.fn();
    const second = jest.fn();
    subscribe(first);
    subscribe(second);
    await saveUserGestures([validTemplate('A', 1)]);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops notifying a listener once unsubscribed', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribe(listener);
    unsubscribe();
    await saveUserGestures([validTemplate('A', 1)]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not notify listeners when a save fails', async () => {
    const listener = jest.fn();
    subscribe(listener);
    (RNFS.writeFile as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    await expect(saveUserGestures([validTemplate('A', 1)])).rejects.toThrow('disk full');
    expect(listener).not.toHaveBeenCalled();
  });
});
