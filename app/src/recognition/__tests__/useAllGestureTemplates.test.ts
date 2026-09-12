import RNFS from 'react-native-fs';
import { renderHook, waitFor } from '@testing-library/react-native';
import { FEATURE_VECTOR_LENGTH, useAllGestureTemplates } from '..';
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

describe('useAllGestureTemplates', () => {
  it('makes a saved custom gesture immediately available to a second, already-mounted instance', async () => {
    // Models the real scenario: AddSignScreen (adder) records a sign while
    // CallScreen (viewer) is already mounted in the background — the new
    // sign must reach `viewer` without a remount/app restart.
    const adder = renderHook(() => useAllGestureTemplates());
    const viewer = renderHook(() => useAllGestureTemplates());

    await waitFor(() => expect(adder.result.current.loading).toBe(false));
    await waitFor(() => expect(viewer.result.current.loading).toBe(false));

    await adder.result.current.addOrUpdate(validTemplate('NEW_SIGN', 1));

    await waitFor(() =>
      expect(viewer.result.current.templates.some((t) => t.label === 'NEW_SIGN')).toBe(true),
    );
  });

  it('serializes concurrent addOrUpdate calls instead of interleaving writes', async () => {
    const hook = renderHook(() => useAllGestureTemplates());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    // Two "taps" fired back-to-back, as a double-tap on Save would produce.
    await Promise.all([
      hook.result.current.addOrUpdate(validTemplate('A', 1)),
      hook.result.current.addOrUpdate(validTemplate('B', 2)),
    ]);

    const labels = hook.result.current.userTemplates.map((t) => t.label).sort();
    expect(labels).toEqual(['A', 'B']);
    // Whatever the file ends up holding must be the fully-merged result of
    // both writes, not just whichever one finished writing last.
    const savedLabels = JSON.parse(mockFiles.get('/mock-documents/user_added_custom_gestures.json') as string)
      .gestures.map((g: GestureTemplate) => g.label)
      .sort();
    expect(savedLabels).toEqual(['A', 'B']);
  });

  it('rejects the caller on a save failure without losing already-saved gestures', async () => {
    const hook = renderHook(() => useAllGestureTemplates());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    await hook.result.current.addOrUpdate(validTemplate('A', 1));

    (RNFS.writeFile as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    await expect(hook.result.current.addOrUpdate(validTemplate('B', 2))).rejects.toThrow('disk full');

    expect(hook.result.current.userTemplates.map((t) => t.label)).toEqual(['A']);
  });

  it('clearAll removes every user-recorded gesture but keeps the bundled ones', async () => {
    const hook = renderHook(() => useAllGestureTemplates());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const bundledCount = hook.result.current.templates.length;

    await hook.result.current.addOrUpdate(validTemplate('A', 1));
    await hook.result.current.addOrUpdate(validTemplate('B', 2));
    await hook.result.current.clearAll();

    expect(hook.result.current.userTemplates).toEqual([]);
    expect(hook.result.current.templates).toHaveLength(bundledCount);
    expect(await loadUserGesturesFromDisk()).toEqual([]);
  });

  it('propagates the underlying save error to callers of clearAll', async () => {
    const hook = renderHook(() => useAllGestureTemplates());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    await hook.result.current.addOrUpdate(validTemplate('A', 1));

    (RNFS.writeFile as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    await expect(hook.result.current.clearAll()).rejects.toThrow('disk full');
  });

  it('clearAll joins the same save queue as addOrUpdate instead of racing it', async () => {
    const hook = renderHook(() => useAllGestureTemplates());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    await Promise.all([hook.result.current.addOrUpdate(validTemplate('A', 1)), hook.result.current.clearAll()]);

    expect(hook.result.current.userTemplates).toEqual([]);
    expect(await loadUserGesturesFromDisk()).toEqual([]);
  });
});

function loadUserGesturesFromDisk(): Promise<GestureTemplate[]> {
  const raw = mockFiles.get('/mock-documents/user_added_custom_gestures.json');
  return Promise.resolve(raw ? (JSON.parse(raw).gestures as GestureTemplate[]) : []);
}
