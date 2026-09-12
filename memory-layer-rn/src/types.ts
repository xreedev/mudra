/**
 * One confirmed translation memory: the canonical ASL gloss sequence and the English sentence
 * the user confirmed for it.
 *
 * `tokens` is always in canonical form (see `normalizeTokens`), so a lookup never has to
 * re-normalize the corpus.
 */
export interface MemoryRecord {
  readonly id: number;
  readonly tokens: readonly string[];
  readonly translation: string;
  readonly useCount: number;
  readonly createdAt: number;
  readonly lastUsedAt: number;
  readonly pinned: boolean;
}

/** How a match was produced: an identical sequence, or a similar one. */
export type MatchKind = 'exact' | 'fuzzy';

/** A scored memory returned by a lookup. */
export interface MemoryMatch {
  readonly record: MemoryRecord;
  /** 1 for an exact hit; otherwise the similarity in `(0, 1]`. */
  readonly score: number;
  readonly kind: MatchKind;
  /** Shortcut for `record.translation`. */
  readonly translation: string;
  /** Shortcut for `record.id`. */
  readonly id: number;
}

/** Why a lookup produced no usable memory. */
export type MissReason =
  /** Input was empty, blank, or nothing survived normalization. */
  | 'empty-input'
  /** Input broke a config limit (too many tokens, token too long). */
  | 'invalid-input'
  /** Nothing stored yet. */
  | 'empty-corpus'
  /** Candidates existed but none reached `fuzzyThreshold`. */
  | 'below-threshold';

export interface ExactHit {
  readonly kind: 'exact';
  readonly match: MemoryMatch;
  readonly matches: readonly MemoryMatch[];
  readonly isConfident: true;
}

export interface FuzzyHit {
  readonly kind: 'fuzzy';
  /** Best first; always non-empty. */
  readonly matches: readonly MemoryMatch[];
  readonly match: MemoryMatch;
  /** `true` when the best score is at or above `CONFIDENT_SCORE`. */
  readonly isConfident: boolean;
}

export interface Miss {
  readonly kind: 'miss';
  readonly reason: MissReason;
  readonly detail?: string;
  readonly matches: readonly [];
  readonly match: null;
  readonly isConfident: false;
}

/**
 * Result of a lookup. A miss is a value, never a thrown error — the caller decides what to do
 * when nothing is stored for a sequence.
 */
export type LookupResult = ExactHit | FuzzyHit | Miss;

/** Fuzzy score at or above which a match is treated as good as an exact hit. */
export const CONFIDENT_SCORE = 0.92;

/** Why a write was refused. */
export type RejectReason =
  | 'empty-tokens'
  | 'too-many-tokens'
  | 'token-too-long'
  | 'empty-translation'
  | 'translation-too-long'
  /** At `maxRecords` and every resident memory is pinned. */
  | 'capacity-exhausted'
  /** The layer has been closed. */
  | 'closed';

export interface Stored {
  readonly status: 'stored';
  readonly record: MemoryRecord;
}

export interface Updated {
  readonly status: 'updated';
  readonly record: MemoryRecord;
  readonly previousTranslation: string;
}

export interface Rejected {
  readonly status: 'rejected';
  readonly reason: RejectReason;
  readonly detail?: string;
}

/** Result of `remember`. */
export type RememberOutcome = Stored | Updated | Rejected;

/** Snapshot of layer counters — cheap to take, safe to log. */
export interface MemoryStats {
  readonly records: number;
  readonly vocabulary: number;
  readonly exactHits: number;
  readonly fuzzyHits: number;
  readonly misses: number;
  readonly writes: number;
  readonly evictions: number;
  readonly storeFailures: number;
  /** `true` when persistence failed and the layer is running in memory only. */
  readonly degraded: boolean;
  readonly lastLookupMs: number;
}

/** Outcome of `warmUp`; `skipped` rows were corrupt or broke the current config. */
export interface WarmUpResult {
  readonly loaded: number;
  readonly skipped: number;
  readonly degraded: boolean;
}

/**
 * Persistence socket.
 *
 * The layer is the id authority (ids are assigned in memory so an auto-fill never waits on
 * storage), so an implementation must honour the id it is given rather than generating one.
 * Every method may reject — the layer catches, counts, and degrades to in-memory rather than
 * losing the session.
 */
export interface MemoryStore {
  /** Called once on warm-up. Returns every persisted memory. */
  loadAll(): Promise<MemoryRecord[]>;
  /** Insert a brand new record (its id is already assigned). */
  insert(record: MemoryRecord): Promise<void>;
  /** Replace an existing record wholesale. */
  update(record: MemoryRecord): Promise<void>;
  /** Cheap usage bump, so the common path does not rewrite the translation. */
  touch(id: number, useCount: number, lastUsedAt: number): Promise<void>;
  remove(id: number): Promise<void>;
  removeAll(): Promise<void>;
  close?(): Promise<void>;
}

/** Injectable clock so tests control recency without waiting. */
export type Clock = () => number;

/** Reported when persistence misbehaves, so the app can surface "memory is read-only" in UI. */
export type MemoryErrorListener = (operation: string, error: unknown) => void;
