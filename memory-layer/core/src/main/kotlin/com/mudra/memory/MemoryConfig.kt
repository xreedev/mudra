package com.mudra.memory

/**
 * Tuning knobs for the memory layer. Defaults are sized for an on-device personal corpus
 * (a few thousand confirmed phrases) on a current flagship (iQOO 15 / Snapdragon 8 Elite class).
 *
 * All limits are enforced defensively: a recognizer glitch that emits 10 000 tokens must not be
 * able to stall the UI thread or blow up the database.
 */
data class MemoryConfig(
    /** Hard cap on tokens per sequence. Anything longer is rejected. */
    val maxTokens: Int = 64,

    /** Hard cap on characters per token (after normalization). */
    val maxTokenLength: Int = 64,

    /** Hard cap on characters of a stored translation. */
    val maxTranslationLength: Int = 1024,

    /** Maximum resident records; the lowest-value unpinned record is evicted past this. */
    val maxRecords: Int = 20_000,

    /** Minimum similarity for a fuzzy match to be returned at all. */
    val fuzzyThreshold: Double = 0.55,

    /** Max fuzzy matches returned from a single lookup. */
    val maxResults: Int = 5,

    /**
     * Candidates that survive the cheap inverted-index stage and get full (order-aware) scoring.
     * Larger = slightly better recall, linearly more work.
     */
    val rescoreCandidates: Int = 48,

    /**
     * A token appearing in more than this fraction of records carries almost no signal
     * (think `ME`); its postings list is skipped during candidate generation unless the query
     * has nothing else to go on.
     */
    val stopTokenDocumentRatio: Double = 0.6,

    /** Enable single-edit repair of unknown query tokens (`TEAA` -> `TEA`). */
    val tokenSpellRepair: Boolean = true,

    /** Only tokens at least this long are eligible for spell repair. */
    val minRepairTokenLength: Int = 4,

    /** Max edit distance used by spell repair. */
    val maxRepairEdits: Int = 1,

    /** Weight of the weighted-Jaccard term in the fuzzy score. */
    val jaccardWeight: Double = 0.45,

    /** Weight of the query-coverage term in the fuzzy score. */
    val coverageWeight: Double = 0.25,

    /** Weight of the order-aware (LCS) term in the fuzzy score. */
    val orderWeight: Double = 0.30,

    /** Initial capacity of the open-addressing exact index. Rounded up to a power of two. */
    val initialIndexCapacity: Int = 1024,
) {
    init {
        require(maxTokens > 0) { "maxTokens must be > 0" }
        require(maxTokenLength > 0) { "maxTokenLength must be > 0" }
        require(maxTranslationLength > 0) { "maxTranslationLength must be > 0" }
        require(maxRecords > 0) { "maxRecords must be > 0" }
        require(fuzzyThreshold > 0.0 && fuzzyThreshold <= 1.0) { "fuzzyThreshold must be in (0,1]" }
        require(maxResults > 0) { "maxResults must be > 0" }
        require(rescoreCandidates > 0) { "rescoreCandidates must be > 0" }
        require(stopTokenDocumentRatio > 0.0 && stopTokenDocumentRatio <= 1.0) {
            "stopTokenDocumentRatio must be in (0,1]"
        }
        require(minRepairTokenLength > 0) { "minRepairTokenLength must be > 0" }
        require(maxRepairEdits >= 0) { "maxRepairEdits must be >= 0" }
        require(initialIndexCapacity > 0) { "initialIndexCapacity must be > 0" }
        val weightSum = jaccardWeight + coverageWeight + orderWeight
        require(weightSum > 0.0) { "fuzzy weights must sum to > 0" }
    }

    internal val weightSum: Double get() = jaccardWeight + coverageWeight + orderWeight
}
