import { weightSum, type MemoryConfig } from './config';
import { sequenceKey } from './normalize';
import { boundedEditDistance, lcsLength } from './similarity';
import type { MemoryMatch, MemoryRecord } from './types';

const NOT_FOUND = -1;

/**
 * The whole in-memory side of the layer:
 *
 *  - a slot-addressed record table (freed slots are recycled so indices stay dense);
 *  - a `Map` from canonical sequence key to slot — the O(1) exact path;
 *  - an inverted index (token -> record slots) for fuzzy candidate generation;
 *  - a length-bucketed vocabulary for single-edit repair of misrecognized glosses.
 *
 * JavaScript is single-threaded, so unlike the Kotlin original there are no locks here: a
 * lookup cannot be interleaved with a write. What remains is the same two-stage search.
 */
export class MemoryIndex {
  private readonly config: MemoryConfig;

  private readonly records: (MemoryRecord | null)[] = [];
  /** Token ids in sign order (duplicates kept) — feeds the order-aware LCS term. */
  private readonly sequenceIds: (Int32Array | null)[] = [];
  /** Distinct token ids, ascending — feeds the weighted set overlap. */
  private readonly distinctIds: (Int32Array | null)[] = [];
  private readonly freeSlots: number[] = [];

  /** Canonical `ME|TEA|HOT` -> slot. The exact path is one Map hit. */
  private readonly exact = new Map<string, number>();
  private readonly idToSlot = new Map<number, number>();

  private readonly tokenIds = new Map<string, number>();
  private readonly tokenText: string[] = [];
  private readonly postings: number[][] = [];
  /** token length -> token ids of that length, for the repair scan. */
  private readonly vocabularyByLength = new Map<number, number[]>();

  // Per-lookup scratch, reused across calls. Generation stamping means the weight array is
  // never cleared between lookups.
  private weights = new Float64Array(0);
  private stamps = new Int32Array(0);
  private touched = new Int32Array(0);
  private generation = 0;
  private querySeq = new Int32Array(0);

  size = 0;

  constructor(config: MemoryConfig) {
    this.config = config;
  }

  get vocabularySize(): number {
    return this.tokenIds.size;
  }

  // ------------------------------------------------------------------ writes

  add(record: MemoryRecord): number {
    const slot = this.allocateSlot();
    const sequence = new Int32Array(record.tokens.length);
    for (let i = 0; i < record.tokens.length; i++) {
      sequence[i] = this.internToken(record.tokens[i]);
    }
    const distinct = distinctSorted(sequence);
    this.records[slot] = record;
    this.sequenceIds[slot] = sequence;
    this.distinctIds[slot] = distinct;
    for (let i = 0; i < distinct.length; i++) this.postings[distinct[i]].push(slot);
    this.exact.set(sequenceKey(record.tokens), slot);
    this.idToSlot.set(record.id, slot);
    this.size++;
    return slot;
  }

  /** Replaces the record in `slot`. Tokens must be unchanged — callers only edit the payload. */
  replace(slot: number, record: MemoryRecord): void {
    const existing = this.records[slot];
    if (!existing) throw new Error(`memory index: slot ${slot} is free`);
    this.records[slot] = record;
    if (existing.id !== record.id) {
      this.idToSlot.delete(existing.id);
      this.idToSlot.set(record.id, slot);
    }
  }

  removeSlot(slot: number): MemoryRecord | null {
    const record = this.records[slot];
    if (!record) return null;
    const distinct = this.distinctIds[slot];
    if (distinct) {
      for (let i = 0; i < distinct.length; i++) {
        const tid = distinct[i];
        const list = this.postings[tid];
        const at = list.indexOf(slot);
        if (at >= 0) {
          list[at] = list[list.length - 1];
          list.pop();
        }
        if (list.length === 0) this.releaseToken(tid);
      }
    }
    this.exact.delete(sequenceKey(record.tokens));
    this.idToSlot.delete(record.id);
    this.records[slot] = null;
    this.sequenceIds[slot] = null;
    this.distinctIds[slot] = null;
    this.freeSlots.push(slot);
    this.size--;
    return record;
  }

  clear(): void {
    this.records.length = 0;
    this.sequenceIds.length = 0;
    this.distinctIds.length = 0;
    this.freeSlots.length = 0;
    this.exact.clear();
    this.idToSlot.clear();
    this.tokenIds.clear();
    this.tokenText.length = 0;
    this.postings.length = 0;
    this.vocabularyByLength.clear();
    this.size = 0;
  }

  // ------------------------------------------------------------------ reads

  findExact(tokens: readonly string[]): MemoryRecord | null {
    const slot = this.exact.get(sequenceKey(tokens));
    return slot === undefined ? null : this.records[slot];
  }

  slotOfId(id: number): number {
    const slot = this.idToSlot.get(id);
    return slot === undefined ? NOT_FOUND : slot;
  }

  recordAt(slot: number): MemoryRecord | null {
    return this.records[slot] ?? null;
  }

  allRecords(): MemoryRecord[] {
    const out: MemoryRecord[] = [];
    for (const record of this.records) if (record) out.push(record);
    return out;
  }

  /** Lowest-value unpinned slot: frequency first, recency as the tie-break. */
  evictionCandidate(): number {
    let best = NOT_FOUND;
    let bestUse = Infinity;
    let bestSeen = Infinity;
    for (let slot = 0; slot < this.records.length; slot++) {
      const record = this.records[slot];
      if (!record || record.pinned) continue;
      const seen = Math.max(record.lastUsedAt, record.createdAt);
      if (record.useCount < bestUse || (record.useCount === bestUse && seen < bestSeen)) {
        best = slot;
        bestUse = record.useCount;
        bestSeen = seen;
      }
    }
    return best;
  }

  /**
   * Two-stage fuzzy search.
   *
   * Stage 1 walks the inverted index and accumulates IDF-weighted token overlap per record.
   * Stage 2 takes only the `rescoreCandidates` best of those and scores them precisely,
   * including the order-aware LCS term that would be too expensive over the whole corpus.
   */
  search(queryTokens: readonly string[], limit: number, threshold: number): MemoryMatch[] {
    if (this.size === 0 || queryTokens.length === 0) return [];
    this.ensureScratch(this.records.length, queryTokens.length);
    this.generation++;

    const n = this.size;
    const unknownIdf = Math.log(1 + n);

    // --- resolve query tokens -> ids, repairing unknown ones -------------------------
    const querySeq = this.querySeq;
    const queryIds: number[] = [];
    const queryWeights: number[] = [];
    const seen = new Set<number>();
    let wQ = 0;
    for (let i = 0; i < queryTokens.length; i++) {
      const token = queryTokens[i];
      let tid = this.tokenIds.get(token) ?? NOT_FOUND;
      if (tid === NOT_FOUND && this.config.tokenSpellRepair) tid = this.repair(token);
      querySeq[i] = tid;
      if (tid === NOT_FOUND) {
        wQ += unknownIdf;
      } else if (!seen.has(tid)) {
        seen.add(tid);
        const weight = idf(this.postings[tid].length, n);
        queryIds.push(tid);
        queryWeights.push(weight);
        wQ += weight;
      }
    }
    if (queryIds.length === 0) return [];

    // Sorted by token id so stage 2 can merge against a record's sorted distinct ids.
    const order = queryIds.map((_, i) => i).sort((a, b) => queryIds[a] - queryIds[b]);
    const sortedIds = order.map((i) => queryIds[i]);
    const sortedWeights = order.map((i) => queryWeights[i]);

    // --- stage 1: candidate generation ----------------------------------------------
    const stopDf = Math.max(1, this.config.stopTokenDocumentRatio * n);
    let touchedCount = this.accumulate(sortedIds, sortedWeights, stopDf, sortedIds.length > 1);
    if (touchedCount === 0) {
      // Every query token was a stop token: scan them anyway rather than miss.
      touchedCount = this.accumulate(sortedIds, sortedWeights, Infinity, false);
    }
    if (touchedCount === 0) return [];

    const candidates = this.topCandidates(touchedCount, this.config.rescoreCandidates);

    // --- stage 2: precise scoring ----------------------------------------------------
    const sum = weightSum(this.config);
    const results: MemoryMatch[] = [];
    for (const slot of candidates) {
      const record = this.records[slot];
      const recordDistinct = this.distinctIds[slot];
      const recordSequence = this.sequenceIds[slot];
      if (!record || !recordDistinct || !recordSequence) continue;

      let overlap = 0;
      let wR = 0;
      let qi = 0;
      for (let i = 0; i < recordDistinct.length; i++) {
        const tid = recordDistinct[i];
        const weight = idf(this.postings[tid].length, n);
        wR += weight;
        while (qi < sortedIds.length && sortedIds[qi] < tid) qi++;
        if (qi < sortedIds.length && sortedIds[qi] === tid) overlap += weight;
      }

      const union = wQ + wR - overlap;
      const jaccard = union <= 0 ? 0 : overlap / union;
      const coverage = wQ <= 0 ? 0 : overlap / wQ;
      const lcs = lcsLength(querySeq, queryTokens.length, recordSequence, recordSequence.length);
      const orderScore = lcs / Math.max(queryTokens.length, recordSequence.length);
      const score =
        (this.config.jaccardWeight * jaccard +
          this.config.coverageWeight * coverage +
          this.config.orderWeight * orderScore) /
        sum;

      if (score >= threshold) {
        results.push({
          record,
          score: Math.min(1, Math.max(0, score)),
          kind: 'fuzzy',
          translation: record.translation,
          id: record.id,
        });
      }
    }

    if (results.length === 0) return [];
    results.sort(compareMatches);
    return results.length > limit ? results.slice(0, limit) : results;
  }

  // ------------------------------------------------------------------ internals

  private allocateSlot(): number {
    const recycled = this.freeSlots.pop();
    if (recycled !== undefined) return recycled;
    this.records.push(null);
    this.sequenceIds.push(null);
    this.distinctIds.push(null);
    return this.records.length - 1;
  }

  private internToken(token: string): number {
    const existing = this.tokenIds.get(token);
    if (existing !== undefined) return existing;
    const id = this.tokenText.length;
    this.tokenIds.set(token, id);
    this.tokenText.push(token);
    this.postings.push([]);
    const bucket = this.vocabularyByLength.get(token.length);
    if (bucket) bucket.push(id);
    else this.vocabularyByLength.set(token.length, [id]);
    return id;
  }

  /**
   * Drops a token whose postings emptied. The id itself is retired rather than reused, so every
   * live token-id array stays valid; `tokenText` keeps an empty tombstone.
   */
  private releaseToken(tid: number): void {
    const text = this.tokenText[tid];
    if (text.length === 0) return;
    this.tokenIds.delete(text);
    const bucket = this.vocabularyByLength.get(text.length);
    if (bucket) {
      const at = bucket.indexOf(tid);
      if (at >= 0) {
        bucket[at] = bucket[bucket.length - 1];
        bucket.pop();
      }
    }
    this.tokenText[tid] = '';
  }

  private repair(token: string): number {
    const { minRepairTokenLength, maxRepairEdits } = this.config;
    if (token.length < minRepairTokenLength || maxRepairEdits <= 0) return NOT_FOUND;
    let bestId = NOT_FOUND;
    let bestDistance = Infinity;
    let bestDf = -1;
    for (let length = token.length - maxRepairEdits; length <= token.length + maxRepairEdits; length++) {
      const bucket = this.vocabularyByLength.get(length);
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const tid = bucket[i];
        const candidate = this.tokenText[tid];
        if (candidate.length === 0) continue;
        const distance = boundedEditDistance(token, candidate, maxRepairEdits);
        if (distance === Infinity) continue;
        const df = this.postings[tid].length;
        if (distance < bestDistance || (distance === bestDistance && df > bestDf)) {
          bestId = tid;
          bestDistance = distance;
          bestDf = df;
        }
      }
    }
    return bestId;
  }

  /** Adds each token's weight to every record containing it. Returns the touched-slot count. */
  private accumulate(
    ids: readonly number[],
    weights: readonly number[],
    stopDf: number,
    skipStopTokens: boolean,
  ): number {
    let touchedCount = 0;
    for (let k = 0; k < ids.length; k++) {
      const list = this.postings[ids[k]];
      if (skipStopTokens && list.length > stopDf) continue;
      const weight = weights[k];
      for (let p = 0; p < list.length; p++) {
        const slot = list[p];
        if (this.stamps[slot] !== this.generation) {
          this.stamps[slot] = this.generation;
          this.weights[slot] = weight;
          this.touched[touchedCount++] = slot;
        } else {
          this.weights[slot] += weight;
        }
      }
    }
    return touchedCount;
  }

  /** The `k` highest-weight touched slots. */
  private topCandidates(touchedCount: number, k: number): number[] {
    const slots: number[] = new Array(touchedCount);
    for (let i = 0; i < touchedCount; i++) slots[i] = this.touched[i];
    if (touchedCount <= k) return slots;
    slots.sort((a, b) => this.weights[b] - this.weights[a]);
    return slots.slice(0, k);
  }

  private ensureScratch(slots: number, queryLength: number): void {
    if (this.weights.length < slots) {
      const size = Math.max(slots, Math.max(16, this.weights.length * 2));
      this.weights = new Float64Array(size);
      this.stamps = new Int32Array(size);
      this.touched = new Int32Array(size);
      this.generation = 0;
    }
    if (this.querySeq.length < queryLength) {
      this.querySeq = new Int32Array(Math.max(queryLength, 16));
    }
    if (this.generation === 0x7fffffff) {
      this.stamps.fill(0);
      this.generation = 0;
    }
  }
}

/**
 * Best score first; ties break by how often the memory was used, then recency, then id, so
 * results are fully deterministic.
 */
export function compareMatches(a: MemoryMatch, b: MemoryMatch): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.record.useCount !== a.record.useCount) return b.record.useCount - a.record.useCount;
  if (b.record.lastUsedAt !== a.record.lastUsedAt) return b.record.lastUsedAt - a.record.lastUsedAt;
  return a.record.id - b.record.id;
}

function idf(df: number, n: number): number {
  return Math.log(1 + n / (1 + df));
}

function distinctSorted(source: Int32Array): Int32Array {
  const copy = Int32Array.from(source);
  copy.sort();
  let write = 0;
  for (let i = 0; i < copy.length; i++) {
    if (i === 0 || copy[i] !== copy[i - 1]) copy[write++] = copy[i];
  }
  return copy.slice(0, write);
}
