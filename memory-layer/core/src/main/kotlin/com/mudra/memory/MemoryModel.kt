package com.mudra.memory

/**
 * A single confirmed translation memory: an ASL gloss token sequence and the English
 * sentence the user confirmed for it.
 *
 * `tokens` is always stored in *canonical* form (see [TokenNormalizer]); the raw tokens the
 * recognizer produced are never stored, so lookups never have to re-normalize the corpus.
 */
data class MemoryRecord(
    val id: Long,
    val tokens: List<String>,
    val translation: String,
    val useCount: Int = 0,
    val createdAtMillis: Long = 0L,
    val lastUsedAtMillis: Long = 0L,
    val pinned: Boolean = false,
) {
    /** Stable human/debug readable key, e.g. `ME|TEA|HOT`. Not used on the hot path. */
    val sequenceKey: String get() = tokens.joinToString("|")
}

/** How a match was produced. */
enum class MatchKind {
    /** O(1) hash hit: the normalized token sequence is identical. */
    EXACT,

    /** Token-set / order similarity above the configured threshold. */
    FUZZY,
}

/** A scored memory returned by [MemoryLayer.lookup]. */
data class MemoryMatch(
    val record: MemoryRecord,
    /** 1.0 for [MatchKind.EXACT]; otherwise the fuzzy similarity in `(0, 1]`. */
    val score: Double,
    val kind: MatchKind,
) {
    val translation: String get() = record.translation
    val id: Long get() = record.id
}

/** Why a lookup produced no usable memory. */
enum class MissReason {
    /** Input was empty, blank, or contained nothing that survived normalization. */
    EMPTY_INPUT,

    /** Input violated a [MemoryConfig] limit (too many tokens, token too long, ...). */
    INVALID_INPUT,

    /** Nothing stored yet. */
    EMPTY_CORPUS,

    /** Candidates existed but none reached [MemoryConfig.fuzzyThreshold]. */
    BELOW_THRESHOLD,
}

/** Result of a memory lookup. Never throws on the hot path — misses are values, not exceptions. */
sealed interface MemoryLookupResult {

    /** The exact sequence was seen before. Returned in O(1). */
    data class Exact(val match: MemoryMatch) : MemoryLookupResult

    /** Similar sequences found, best first. Always non-empty. */
    data class Fuzzy(val matches: List<MemoryMatch>) : MemoryLookupResult

    /** No usable memory — the caller should fall through to the LLM. */
    data class Miss(
        val reason: MissReason,
        /** Populated for [MissReason.INVALID_INPUT] / diagnostics. */
        val detail: String? = null,
    ) : MemoryLookupResult

    /** Best match, or `null` for a miss. */
    val best: MemoryMatch?
        get() = when (this) {
            is Exact -> match
            is Fuzzy -> matches.firstOrNull()
            is Miss -> null
        }

    /** All matches, best first (empty for a miss). */
    val allMatches: List<MemoryMatch>
        get() = when (this) {
            is Exact -> listOf(match)
            is Fuzzy -> matches
            is Miss -> emptyList()
        }

    /**
     * `true` when the layer is confident enough for the caller to auto-fill the stored
     * sentence directly; otherwise the matches are suggestions only.
     */
    val isConfident: Boolean
        get() = when (this) {
            is Exact -> true
            is Fuzzy -> matches.first().score >= CONFIDENT_SCORE
            is Miss -> false
        }

    companion object {
        /** Fuzzy score at or above which a match is treated as good as an exact hit. */
        const val CONFIDENT_SCORE: Double = 0.92
    }
}

/** Why a write was refused. */
enum class RejectReason {
    EMPTY_TOKENS,
    TOO_MANY_TOKENS,
    TOKEN_TOO_LONG,
    EMPTY_TRANSLATION,
    TRANSLATION_TOO_LONG,
    /** Store is at [MemoryConfig.maxRecords] and every resident record is pinned. */
    CAPACITY_EXHAUSTED,
    /** The layer has been closed. */
    CLOSED,
}

/** Result of [MemoryLayer.remember]. */
sealed interface RememberOutcome {
    data class Stored(val record: MemoryRecord) : RememberOutcome
    data class Updated(val record: MemoryRecord, val previousTranslation: String) : RememberOutcome
    data class Rejected(val reason: RejectReason, val detail: String? = null) : RememberOutcome

    val recordOrNull: MemoryRecord?
        get() = when (this) {
            is Stored -> record
            is Updated -> record
            is Rejected -> null
        }
}

/** Snapshot of layer counters — cheap to take, safe to log. */
data class MemoryStats(
    val records: Int,
    val vocabulary: Int,
    val exactHits: Long,
    val fuzzyHits: Long,
    val misses: Long,
    val writes: Long,
    val evictions: Long,
    val storeFailures: Long,
    /** `true` when persistence failed and the layer is running in-memory only. */
    val degraded: Boolean,
    val lastLookupNanos: Long,
)
