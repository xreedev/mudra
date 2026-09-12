import type { MemoryRecord, MemoryStore } from '../types';

/** Persists nothing beyond the process. The reference store the test suite runs against. */
export class InMemoryStore implements MemoryStore {
  private readonly rows = new Map<number, MemoryRecord>();

  constructor(initial: readonly MemoryRecord[] = []) {
    for (const record of initial) this.rows.set(record.id, record);
  }

  async loadAll(): Promise<MemoryRecord[]> {
    return [...this.rows.values()];
  }

  async insert(record: MemoryRecord): Promise<void> {
    this.rows.set(record.id, record);
  }

  async update(record: MemoryRecord): Promise<void> {
    this.rows.set(record.id, record);
  }

  async touch(id: number, useCount: number, lastUsedAt: number): Promise<void> {
    const existing = this.rows.get(id);
    if (existing) this.rows.set(id, { ...existing, useCount, lastUsedAt });
  }

  async remove(id: number): Promise<void> {
    this.rows.delete(id);
  }

  async removeAll(): Promise<void> {
    this.rows.clear();
  }

  get size(): number {
    return this.rows.size;
  }
}
