import { buildPrototype, FileBackedPrototypeStore, InMemoryPrototypeStore, type FileIO } from '../src/prototypeStore';
import { cosineSimilarity } from '../src/similarity';

describe('buildPrototype', () => {
  it('averages the enrollment repetitions into a new prototype', () => {
    const reps = [[1, 0], [0.9, 0.1], [1.1, -0.1]];
    const proto = buildPrototype('id1', 'HOSPITAL', reps);
    expect(proto.sampleCount).toBe(3);
    expect(proto.label).toBe('HOSPITAL');
    for (const rep of reps) {
      expect(cosineSimilarity(proto.vector, rep)).toBeGreaterThan(0.95);
    }
  });

  it('folds new samples into an existing prototype as a weighted running average', () => {
    const original = buildPrototype('id1', 'HOSPITAL', [[1, 0], [1, 0], [1, 0]]); // sampleCount 3
    const updated = buildPrototype('id1', 'HOSPITAL', [[1, 0]], original); // +1 more identical sample
    expect(updated.sampleCount).toBe(4);
    // All 4 samples were identical, so the running average should be unchanged.
    expect(updated.vector[0]).toBeCloseTo(1);
    expect(updated.vector[1]).toBeCloseTo(0);
  });

  it('throws when there is nothing to build from', () => {
    expect(() => buildPrototype('id1', 'X', [])).toThrow();
  });
});

describe('InMemoryPrototypeStore', () => {
  it('saves, lists, and removes prototypes', async () => {
    const store = new InMemoryPrototypeStore();
    const p = buildPrototype('id1', 'HOSPITAL', [[1, 0]]);
    await store.save(p);
    expect(await store.list()).toHaveLength(1);
    await store.remove('id1');
    expect(await store.list()).toHaveLength(0);
  });
});

/** Fake FileIO backed by an in-memory string map — proves the store's JSON
 *  read/write logic without needing react-native-fs or a real filesystem. */
function fakeFileIO(): FileIO & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async exists(path) {
      return files.has(path);
    },
    async readFile(path) {
      const v = files.get(path);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    async writeFile(path, contents) {
      files.set(path, contents);
    },
  };
}

describe('FileBackedPrototypeStore', () => {
  it('starts empty when the file does not exist yet', async () => {
    const store = new FileBackedPrototypeStore(fakeFileIO(), '/models/signs.json');
    expect(await store.list()).toEqual([]);
  });

  it('persists across save/list/remove like the in-memory store', async () => {
    const io = fakeFileIO();
    const store = new FileBackedPrototypeStore(io, '/models/signs.json');
    const p = buildPrototype('id1', 'HOSPITAL', [[1, 0]]);
    await store.save(p);

    // A fresh store instance pointed at the same "file" should see it —
    // proves data round-trips through JSON, not just kept in JS memory.
    const store2 = new FileBackedPrototypeStore(io, '/models/signs.json');
    const listed = await store2.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].label).toBe('HOSPITAL');

    await store2.remove('id1');
    expect(await store.list()).toHaveLength(0);
  });

  it('fails safe (empty list) on a corrupt file instead of throwing', async () => {
    const io = fakeFileIO();
    io.files.set('/models/signs.json', 'not valid json{{{');
    const store = new FileBackedPrototypeStore(io, '/models/signs.json');
    expect(await store.list()).toEqual([]);
  });
});
