/**
 * Tuning knobs. Defaults are sized for an on-device personal corpus (a few thousand confirmed
 * phrases) on a current flagship.
 *
 * Every limit is enforced defensively: a recognizer glitch that emits 10 000 tokens must not be
 * able to stall the JS thread or bloat the database.
 */
export interface MemoryConfig {
  /** Hard cap on tokens per sequence. */
  maxTokens: number;
  /** Hard cap on characters per token, after normalization. */
  maxTokenLength: number;
  /** Hard cap on characters of a stored translation. */
  maxTranslationLength: number;
  /** Maximum resident memories; past this the lowest-value unpinned memory is evicted. */
  maxRecords: number;
  /** Minimum similarity for a fuzzy match to be returned at all. */
  fuzzyThreshold: number;
  /** Max fuzzy matches returned from one lookup. */
  maxResults: number;
  /** Candidates that survive the inverted-index stage and get full, order-aware scoring. */
  rescoreCandidates: number;
  /**
   * A token in more than this fraction of memories (think `ME`) carries almost no signal; its
   * postings are skipped during candidate generation unless the query has nothing else.
   */
  stopTokenDocumentRatio: number;
  /** Repair unknown query tokens by a single edit (`TEAA` -> `TEA`). */
  tokenSpellRepair: boolean;
  /** Only tokens at least this long are eligible for repair. */
  minRepairTokenLength: number;
  /** Max edit distance used by repair. */
  maxRepairEdits: number;
  /** Weight of the weighted-Jaccard term in the fuzzy score. */
  jaccardWeight: number;
  /** Weight of the query-coverage term. */
  coverageWeight: number;
  /** Weight of the order-aware (LCS) term. */
  orderWeight: number;
}

export const DEFAULT_CONFIG: Readonly<MemoryConfig> = Object.freeze({
  maxTokens: 64,
  maxTokenLength: 64,
  maxTranslationLength: 1024,
  maxRecords: 20000,
  fuzzyThreshold: 0.55,
  maxResults: 5,
  rescoreCandidates: 48,
  stopTokenDocumentRatio: 0.6,
  tokenSpellRepair: true,
  minRepairTokenLength: 4,
  maxRepairEdits: 1,
  jaccardWeight: 0.45,
  coverageWeight: 0.25,
  orderWeight: 0.3,
});

/** Fills in defaults and fails fast on a nonsensical value. */
export function resolveConfig(overrides: Partial<MemoryConfig> = {}): MemoryConfig {
  const config: MemoryConfig = { ...DEFAULT_CONFIG, ...overrides };

  const positive = (name: keyof MemoryConfig) => {
    const value = config[name];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new RangeError(`memory config: ${name} must be a positive number (got ${value})`);
    }
  };
  (
    [
      'maxTokens',
      'maxTokenLength',
      'maxTranslationLength',
      'maxRecords',
      'maxResults',
      'rescoreCandidates',
      'minRepairTokenLength',
    ] as const
  ).forEach(positive);

  if (config.fuzzyThreshold <= 0 || config.fuzzyThreshold > 1) {
    throw new RangeError(`memory config: fuzzyThreshold must be in (0, 1]`);
  }
  if (config.stopTokenDocumentRatio <= 0 || config.stopTokenDocumentRatio > 1) {
    throw new RangeError(`memory config: stopTokenDocumentRatio must be in (0, 1]`);
  }
  if (config.maxRepairEdits < 0) {
    throw new RangeError(`memory config: maxRepairEdits must be >= 0`);
  }
  if (config.jaccardWeight + config.coverageWeight + config.orderWeight <= 0) {
    throw new RangeError(`memory config: fuzzy weights must sum to more than 0`);
  }
  return config;
}

export function weightSum(config: MemoryConfig): number {
  return config.jaccardWeight + config.coverageWeight + config.orderWeight;
}
