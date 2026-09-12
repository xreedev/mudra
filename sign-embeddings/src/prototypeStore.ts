import { averageVectors } from './similarity';
import type { EmbeddingVector, SignPrototype } from './types';

export interface PrototypeStore {
  list(): Promise<SignPrototype[]>;
  save(prototype: SignPrototype): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Pure in-memory store — used by tests, and a fine default if custom signs
 *  only need to persist for the current app session. */
export class InMemoryPrototypeStore implements PrototypeStore {
  private items = new Map<string, SignPrototype>();

  async list(): Promise<SignPrototype[]> {
    return [...this.items.values()];
  }
  async save(prototype: SignPrototype): Promise<void> {
    this.items.set(prototype.id, prototype);
  }
  async remove(id: string): Promise<void> {
    this.items.delete(id);
  }
}

/** Minimal file-IO surface this store needs — deliberately NOT importing
 *  `react-native-fs` here, so this file has zero RN dependency and can be
 *  unit-tested with a fake. The real app wires this to RNFS
 *  (readFile/writeFile/exists), exactly the pattern already proven working
 *  in llm-testbed for pushing/reading the GGUF model file. */
export interface FileIO {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, contents: string): Promise<void>;
}

/** JSON-file-backed store: one small file, one row per custom sign. Per-user,
 *  per-device — no backend needed (see INTEGRATION.md, Option 1 design). */
export class FileBackedPrototypeStore implements PrototypeStore {
  constructor(private io: FileIO, private path: string) {}

  async list(): Promise<SignPrototype[]> {
    if (!(await this.io.exists(this.path))) return [];
    const raw = await this.io.readFile(this.path);
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return []; // corrupt/empty file — fail safe to "no custom signs yet"
    }
  }

  async save(prototype: SignPrototype): Promise<void> {
    const items = await this.list();
    const idx = items.findIndex((p) => p.id === prototype.id);
    if (idx >= 0) items[idx] = prototype;
    else items.push(prototype);
    await this.io.writeFile(this.path, JSON.stringify(items, null, 2));
  }

  async remove(id: string): Promise<void> {
    const items = (await this.list()).filter((p) => p.id !== id);
    await this.io.writeFile(this.path, JSON.stringify(items, null, 2));
  }
}

/**
 * Build a new prototype from a few enrollment-repetition embeddings, or fold
 * more samples into an EXISTING prototype (running average, weighted by how
 * many samples already went into it) — lets a user add more repetitions
 * later to improve a sign that isn't matching reliably.
 */
export function buildPrototype(
  id: string,
  label: string,
  sampleVectors: EmbeddingVector[],
  existing?: SignPrototype,
): SignPrototype {
  if (sampleVectors.length === 0 && !existing) {
    throw new Error('buildPrototype: need at least one sample for a new prototype');
  }
  if (!existing) {
    return {
      id,
      label,
      vector: averageVectors(sampleVectors),
      sampleCount: sampleVectors.length,
      createdAt: Date.now(),
    };
  }
  // Weighted running average: existing.vector already represents
  // existing.sampleCount samples: fold the new ones in without needing the
  // original raw vectors again.
  const totalCount = existing.sampleCount + sampleVectors.length;
  const dim = existing.vector.length;
  const merged = new Array<number>(dim).fill(0);
  for (let i = 0; i < dim; i++) {
    merged[i] = existing.vector[i] * existing.sampleCount;
  }
  for (const v of sampleVectors) {
    for (let i = 0; i < dim; i++) merged[i] += v[i];
  }
  for (let i = 0; i < dim; i++) merged[i] /= totalCount;

  return { ...existing, label, vector: merged, sampleCount: totalCount };
}
