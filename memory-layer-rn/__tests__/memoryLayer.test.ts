import { DatabaseSync } from 'node:sqlite';
import {
  InMemoryStore,
  MemoryLayer,
  NO_STORE,
  SqliteMemoryStore,
  createImmediateWriteScheduler,
  type MemoryRecord,
  type MemoryStore,
  type SqlParam,
  type SqliteAdapter,
  type SqlRow,
} from '../src';

/** Controllable clock so recency-dependent behaviour is deterministic. */
function testClock(start = 1000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function layer(options: Partial<ConstructorParameters<typeof MemoryLayer>[0]> = {}) {
  return new MemoryLayer({
    store: new InMemoryStore(),
    clock: testClock().now,
    writeScheduler: createImmediateWriteScheduler(),
    ...options,
  });
}

function seeded() {
  const memory = layer();
  memory.remember(['ME', 'TEA', 'HOT'], 'I want hot tea');
  memory.remember(['ME', 'COFFEE', 'COLD'], 'I want iced coffee');
  memory.remember(['ME', 'NEED', 'METFORMIN', 'ONE', 'STRIP'], 'I need one strip of Metformin');
  memory.remember(['HELP', 'AMBULANCE', 'NOW'], 'I need an ambulance now');
  return memory;
}

describe('store and retrieve', () => {
  it('stores a confirmed translation and returns it exactly', () => {
    const memory = layer();
    expect(memory.remember(['ME', 'TEA', 'HOT'], 'I want hot tea').status).toBe('stored');

    const result = memory.lookup(['ME', 'TEA', 'HOT']);
    expect(result.kind).toBe('exact');
    expect(result.match?.translation).toBe('I want hot tea');
    expect(result.match?.score).toBe(1);
    expect(result.isConfident).toBe(true);
  });

  it('ignores case, punctuation, spacing and junk tokens', () => {
    const memory = layer();
    memory.remember(['thank you', 'BYE'], 'Thank you, goodbye');

    for (const query of [
      ['THANK_YOU', 'BYE'],
      ['thank you', 'bye'],
      [' Thank  You ', 'Bye!'],
      ['thank you', null, '  ', 'bye'],
    ]) {
      expect(memory.autoFill(query)).toBe('Thank you, goodbye');
    }
  });

  it('re-confirming a sequence updates the sentence and keeps one record', () => {
    const clock = testClock();
    const memory = layer({ clock: clock.now });
    const stored = memory.remember(['ME', 'TEA'], 'tea');
    const id = stored.status === 'stored' ? stored.record.id : -1;
    clock.advance(500);

    const updated = memory.remember(['me', 'tea'], 'I would like tea');
    expect(updated).toMatchObject({
      status: 'updated',
      previousTranslation: 'tea',
      record: { id, useCount: 2, lastUsedAt: 1500 },
    });
    expect(memory.size).toBe(1);
    expect(memory.autoFill(['ME', 'TEA'])).toBe('I would like tea');
  });

  it('forget and clear remove memories from memory and storage', async () => {
    const store = new InMemoryStore();
    const memory = layer({ store });
    memory.remember(['ME', 'TEA'], 'tea');
    memory.remember(['ME', 'COFFEE'], 'coffee');

    expect(memory.forget(['me', 'tea'])).toBe(true);
    expect(memory.forget(['me', 'tea'])).toBe(false);
    expect(memory.lookupExact(['ME', 'TEA'])).toBeNull();

    memory.clear();
    await memory.flush();
    expect(memory.size).toBe(0);
    expect(store.size).toBe(0);
    expect(memory.remember(['ME', 'TEA'], 'tea').status).toBe('stored');
  });
});

describe('fuzzy retrieval', () => {
  it('finds the memory through an extra, missing, reordered or mistyped gloss', () => {
    const memory = seeded();
    expect(memory.lookup(['ME', 'WANT', 'TEA', 'HOT']).match?.translation).toBe('I want hot tea');
    expect(memory.lookup(['ME', 'NEED', 'METFORMIN', 'STRIP']).match?.translation).toBe(
      'I need one strip of Metformin',
    );
    expect(memory.lookup(['HOT', 'TEA', 'ME']).match?.translation).toBe('I want hot tea');
    // Classifier emitted METFORMIM instead of METFORMIN.
    expect(memory.lookup(['ME', 'NEED', 'METFORMIM', 'ONE', 'STRIP']).match?.translation).toBe(
      'I need one strip of Metformin',
    );
  });

  it('ranks the correctly ordered memory above a shuffled one', () => {
    const memory = layer();
    memory.remember(['ME', 'TEA', 'HOT', 'PLEASE'], 'ordered');
    memory.remember(['PLEASE', 'HOT', 'TEA', 'ME'], 'shuffled');

    const result = memory.lookup(['ME', 'TEA', 'HOT']);
    expect(result.match?.translation).toBe('ordered');
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0].score).toBeGreaterThan(result.matches[1].score);
  });

  it('misses on an unrelated sequence rather than returning nonsense', () => {
    const memory = seeded();
    const result = memory.lookup(['AIRPORT', 'TAXI', 'LUGGAGE']);
    expect(result).toMatchObject({ kind: 'miss', reason: 'below-threshold' });
    // One shared everyday gloss is not evidence either.
    expect(memory.lookup(['ME', 'AIRPORT', 'TAXI']).kind).toBe('miss');
  });

  it('treats a weak match as a suggestion and a strong one as auto-fillable', () => {
    const memory = seeded();
    const weak = memory.lookup(['ME', 'TEA']);
    expect(weak.kind).toBe('fuzzy');
    expect(weak.isConfident).toBe(false);
    expect(memory.autoFill(['ME', 'TEA'])).toBeNull();

    const strong = memory.lookup(['ME', 'NEED', 'METFORMIN', 'ONE', 'STRIPS']);
    expect(strong.match!.score).toBeGreaterThan(0.9);
    expect(strong.isConfident).toBe(true);
  });

  it('caps results, orders them by score and breaks ties on usage', () => {
    const memory = layer();
    for (let i = 0; i < 20; i++) memory.remember(['ME', 'TEA', `SUGAR${i}`], `variant ${i}`);
    const capped = memory.lookup(['ME', 'TEA'], 3);
    expect(capped.matches).toHaveLength(3);
    const scores = capped.matches.map((match) => match.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);

    const tied = layer();
    tied.remember(['ME', 'WATER', 'COLD'], 'cold water');
    const hot = tied.remember(['ME', 'WATER', 'HOT'], 'hot water');
    const hotId = hot.status === 'stored' ? hot.record.id : -1;
    for (let i = 0; i < 5; i++) tied.accept(hotId);
    expect(tied.lookup(['ME', 'WATER']).match?.translation).toBe('hot water');
  });
});

describe('bad input', () => {
  it('turns empty, null and oversized input into a miss, never a throw', () => {
    const memory = layer();
    memory.remember(['ME', 'TEA'], 'tea');

    for (const query of [null, undefined, [], [null, undefined], ['!!!']]) {
      expect(memory.lookup(query)).toMatchObject({ kind: 'miss', reason: 'empty-input' });
    }

    const tooMany = Array.from({ length: memory.config.maxTokens + 1 }, (_, i) => `T${i}`);
    expect(memory.lookup(tooMany)).toMatchObject({ kind: 'miss', reason: 'invalid-input' });
    expect(memory.lookup(['ME', 'X'.repeat(1_000_000)])).toMatchObject({
      kind: 'miss',
      reason: 'invalid-input',
    });
    expect(memory.forget(null)).toBe(false);
    expect(memory.forgetById(-1)).toBe(false);
    expect(memory.lookupExact(undefined)).toBeNull();
  });

  it('rejects bad writes with a reason and accepts boundary values', () => {
    const memory = layer();
    expect(memory.remember(null, 'x')).toMatchObject({ reason: 'empty-tokens' });
    expect(memory.remember(['ME'], '   ')).toMatchObject({ reason: 'empty-translation' });
    expect(memory.remember(['ME'], 'x'.repeat(2000))).toMatchObject({
      reason: 'translation-too-long',
    });
    expect(memory.remember(['X'.repeat(500)], 'x')).toMatchObject({ reason: 'token-too-long' });
    expect(memory.size).toBe(0);

    const maxTokens = Array.from({ length: memory.config.maxTokens }, (_, i) => `T${i}`);
    expect(
      memory.remember(maxTokens, 'y'.repeat(memory.config.maxTranslationLength)).status,
    ).toBe('stored');
  });

  it('refuses work quietly once closed', async () => {
    const memory = layer();
    memory.remember(['ME', 'TEA'], 'tea');
    await memory.close();

    expect(memory.lookup(['ME', 'TEA'])).toMatchObject({ kind: 'miss', reason: 'invalid-input' });
    expect(memory.remember(['ME', 'TEA'], 'tea')).toMatchObject({ reason: 'closed' });
    expect(memory.accept(1)).toBeNull();
    expect(memory.forgetById(1)).toBe(false);
    memory.clear();
    await memory.close(); // idempotent
  });

  it('rejects a nonsensical config at construction', () => {
    expect(() => new MemoryLayer({ config: { maxTokens: 0 } })).toThrow(RangeError);
    expect(() => new MemoryLayer({ config: { fuzzyThreshold: 1.5 } })).toThrow(RangeError);
    expect(() => new MemoryLayer({ config: { maxRecords: -1 } })).toThrow(RangeError);
  });
});

describe('persistence', () => {
  it('restores memories after a restart', async () => {
    const store = new InMemoryStore();
    const first = layer({ store });
    first.remember(['ME', 'TEA', 'HOT'], 'I want hot tea');
    first.remember(['HELP', 'AMBULANCE'], 'I need an ambulance', { pinned: true });
    await first.flush();

    const second = layer({ store });
    const warmUp = await second.warmUp();
    expect(warmUp).toMatchObject({ loaded: 2, degraded: false });
    expect(second.autoFill(['me', 'tea', 'hot'])).toBe('I want hot tea');
    expect(second.lookupExact(['HELP', 'AMBULANCE'])?.pinned).toBe(true);

    // Ids keep counting up, so a new memory cannot collide with a restored one.
    const stored = second.remember(['ME', 'COFFEE'], 'coffee');
    expect(stored.status === 'stored' && stored.record.id).toBeGreaterThan(2);
  });

  it('skips corrupt rows instead of failing start-up', async () => {
    const rows = [
      { id: 1, tokens: ['ME', 'TEA'], translation: 'tea' },
      { id: 2, tokens: [], translation: 'no tokens' },
      { id: 3, tokens: ['ME'], translation: '   ' },
      { id: 4, tokens: ['ME', 'X'.repeat(500)], translation: 'token too long' },
      { id: 0, tokens: ['BAD', 'ID'], translation: 'id must be positive' },
      { id: 6, tokens: ['me', 'tea'], translation: 'duplicate of row 1', useCount: 9 },
      // Deliberately partial/corrupt rows, as an older build or a half-written row would be.
    ] as unknown as MemoryRecord[];
    const memory = layer({ store: new InMemoryStore(rows) });

    const result = await memory.warmUp();
    expect(result).toMatchObject({ loaded: 1, skipped: 5 });
    expect(memory.size).toBe(1);
    // The duplicate with the higher use count wins, and old rows are re-normalized.
    expect(memory.autoFill(['ME', 'TEA'])).toBe('duplicate of row 1');
  });

  it('degrades to memory-only when storage fails', async () => {
    const failures: string[] = [];
    const broken: MemoryStore = {
      loadAll: async () => {
        throw new Error('database is corrupt');
      },
      insert: async () => {
        throw new Error('disk full');
      },
      update: async () => {},
      touch: async () => {},
      remove: async () => {},
      removeAll: async () => {},
    };
    const memory = layer({
      store: broken,
      onStoreError: (operation) => failures.push(operation),
    });

    expect((await memory.warmUp()).degraded).toBe(true);
    expect(memory.remember(['ME', 'TEA'], 'tea').status).toBe('stored');
    expect(memory.autoFill(['ME', 'TEA'])).toBe('tea');
    await memory.flush();

    expect(memory.isDegraded).toBe(true);
    expect(failures).toEqual(['loadAll', 'insert']);
    expect(memory.stats().storeFailures).toBe(2);
  });

  it('queues every write behind the frame and loses none', async () => {
    const store = new InMemoryStore();
    const memory = new MemoryLayer({ store, clock: testClock().now });
    for (let i = 0; i < 500; i++) memory.remember([`SIGN${i}`], `phrase ${i}`);
    // Nothing has been persisted yet — the writes are behind the current frame.
    expect(store.size).toBeLessThan(500);
    await memory.flush();
    expect(store.size).toBe(500);
  });
});

describe('capacity', () => {
  it('stays bounded and sheds the least useful memory first', () => {
    const clock = testClock();
    const memory = layer({ clock: clock.now, config: { maxRecords: 3 } });
    const keep = memory.remember(['ME', 'TEA'], 'tea');
    const keepId = keep.status === 'stored' ? keep.record.id : -1;
    memory.remember(['ME', 'COFFEE'], 'coffee');
    memory.remember(['ME', 'WATER'], 'water');
    for (let i = 0; i < 5; i++) {
      clock.advance(10);
      memory.accept(keepId);
    }

    clock.advance(10);
    memory.remember(['ME', 'JUICE'], 'juice');
    expect(memory.size).toBe(3);
    expect(memory.stats().evictions).toBe(1);
    expect(memory.lookupExact(['ME', 'TEA'])).not.toBeNull();
    expect(memory.lookupExact(['ME', 'COFFEE'])).toBeNull();
  });

  it('never evicts a pinned memory', () => {
    const memory = layer({ config: { maxRecords: 2 } });
    memory.remember(['HELP', 'AMBULANCE'], 'ambulance', { pinned: true });
    for (let i = 0; i < 50; i++) memory.remember([`SIGN${i}`], `phrase ${i}`);

    expect(memory.size).toBe(2);
    expect(memory.lookupExact(['HELP', 'AMBULANCE'])).not.toBeNull();

    // A fully pinned corpus refuses a new memory rather than dropping an emergency phrase.
    const unpinned = memory.snapshot().find((record) => !record.pinned)!;
    memory.setPinned(unpinned.id, true);
    expect(memory.remember(['MORE'], 'more')).toMatchObject({ reason: 'capacity-exhausted' });
  });
});

describe('sqlite store', () => {
  /** Real SQLite via node:sqlite, shaped like an RN binding adapter. */
  function nodeSqliteAdapter(): SqliteAdapter & { close(): Promise<void> } {
    const db = new DatabaseSync(':memory:');
    return {
      async execute(sql: string, params: readonly SqlParam[] = []): Promise<SqlRow[]> {
        const statement = db.prepare(sql);
        if (/^\s*(select|pragma)/i.test(sql)) {
          return statement.all(...(params as SqlParam[])) as SqlRow[];
        }
        statement.run(...(params as SqlParam[]));
        return [];
      },
      async close() {
        db.close();
      },
    };
  }

  it('round trips a record through real SQL', async () => {
    const store = new SqliteMemoryStore(nodeSqliteAdapter());
    const record: MemoryRecord = {
      id: 7,
      tokens: ['ME', 'TEA', 'HOT'],
      translation: 'I want hot tea',
      useCount: 3,
      createdAt: 100,
      lastUsedAt: 200,
      pinned: true,
    };
    await store.insert(record);
    expect(await store.loadAll()).toEqual([record]);

    await store.touch(7, 5, 999);
    const touched = (await store.loadAll())[0];
    expect(touched).toMatchObject({ useCount: 5, lastUsedAt: 999, translation: 'I want hot tea' });

    // Same sequence under a new id: the unique index collapses it to one row.
    await store.insert({ ...record, id: 8, translation: 'tea again' });
    expect(await store.count()).toBe(1);

    await store.remove(404); // absent id is a no-op
    await store.removeAll();
    expect(await store.loadAll()).toEqual([]);
    await store.close();
  });

  it('persists the layer to sqlite and restores it', async () => {
    const store = new SqliteMemoryStore(nodeSqliteAdapter());
    const first = layer({ store });
    first.remember(['ME', 'TEA', 'HOT'], 'I want hot tea');
    first.remember(['HELP', 'AMBULANCE', 'NOW'], 'I need an ambulance now', { pinned: true });
    await first.flush();
    expect(await store.count()).toBe(2);

    const second = layer({ store });
    expect((await second.warmUp()).loaded).toBe(2);
    expect(second.autoFill(['me', 'tea', 'hot'])).toBe('I want hot tea');
    expect(second.lookupExact(['HELP', 'AMBULANCE', 'NOW'])?.pinned).toBe(true);

    second.forget(['ME', 'TEA', 'HOT']);
    await second.flush();
    expect(await store.count()).toBe(1);
    await store.close();
  });

  it('refuses an unsafe table name', () => {
    expect(() => new SqliteMemoryStore(nodeSqliteAdapter(), { tableName: 'drop; --' })).toThrow();
  });
});

describe('speed', () => {
  const vocabulary = [
    'ME', 'YOU', 'WANT', 'NEED', 'HELP', 'TEA', 'COFFEE', 'HOT', 'COLD', 'PLEASE',
    'NOW', 'DOCTOR', 'PHARMACY', 'METFORMIN', 'STRIP', 'ONE', 'AMBULANCE', 'HOME',
  ];

  function corpus(size: number, seed: number) {
    let state = seed;
    const random = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
    const memory = new MemoryLayer({ store: NO_STORE, config: { maxRecords: size * 2 } });
    const sequences: string[][] = [];
    while (sequences.length < size) {
      const length = 3 + Math.floor(random() * 3);
      const tokens = Array.from(
        { length },
        () => vocabulary[Math.floor(random() * vocabulary.length)],
      );
      tokens.push(`UNIQUE${sequences.length}`);
      if (memory.remember(tokens, `sentence ${sequences.length}`).status === 'stored') {
        sequences.push(tokens);
      }
    }
    return { memory, sequences };
  }

  function timeLookups({ memory, sequences }: ReturnType<typeof corpus>) {
    const iterations = 100_000;
    for (let i = 0; i < iterations / 4; i++) memory.lookup(sequences[i % sequences.length]);
    const startedAt = performance.now();
    let hits = 0;
    for (let i = 0; i < iterations; i++) {
      if (memory.lookup(sequences[i % sequences.length]).kind === 'exact') hits++;
    }
    expect(hits).toBe(iterations);
    return ((performance.now() - startedAt) * 1e6) / iterations; // nanoseconds per lookup
  }

  it('exact lookup cost does not grow with the corpus', () => {
    const small = timeLookups(corpus(1_000, 1));
    const large = timeLookups(corpus(50_000, 2));
    // eslint-disable-next-line no-console
    console.log(
      `exact lookup: 1k corpus = ${small.toFixed(0)}ns/op, 50k corpus = ${large.toFixed(0)}ns/op`,
    );
    // A linear scan would be ~50x slower on the bigger corpus; a Map hit is flat.
    expect(large).toBeLessThan(small * 8 + 2000);
  }, 60_000);
});
