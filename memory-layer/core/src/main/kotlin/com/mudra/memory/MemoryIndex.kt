package com.mudra.memory

import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min

/**
 * The whole in-RAM side of the memory layer:
 *
 *  - slot-addressed record table (free slots are recycled so indices stay dense);
 *  - [SequenceIndex] for the O(1) exact path;
 *  - an inverted index (token -> record slots) for fuzzy candidate generation;
 *  - a length-bucketed vocabulary for single-edit repair of misrecognized glosses.
 *
 * Not thread-safe by itself — [MemoryLayer] guards it with a read/write lock, and every
 * per-lookup scratch buffer is thread-local so concurrent readers never share state.
 */
internal class MemoryIndex(
    private val config: MemoryConfig,
    hasher: SequenceHasher = SequenceHasher.FNV1A,
) {
    private val records = ArrayList<MemoryRecord?>()

    /** Token ids in sign order (duplicates kept) — used by the order-aware LCS term. */
    private val sequenceIds = ArrayList<IntArray?>()

    /** Distinct token ids, ascending — used for the weighted set overlap. */
    private val distinctIds = ArrayList<IntArray?>()

    private val freeSlots = IntList()
    private val idToSlot = HashMap<Long, Int>()

    private val exact = SequenceIndex(config.initialIndexCapacity, hasher) { slot ->
        records.getOrNull(slot)?.tokens
    }

    private val tokenIds = HashMap<String, Int>()
    private val tokenText = ArrayList<String>()
    private val postings = ArrayList<IntList>()

    /** token length -> token ids of that length, for the spell-repair scan. */
    private val vocabularyByLength = HashMap<Int, IntList>()

    private val scratch = ThreadLocal.withInitial { Scratch() }

    var size: Int = 0
        private set

    val vocabularySize: Int get() = tokenIds.size

    // ---------------------------------------------------------------- writes

    fun add(record: MemoryRecord): Int {
        val slot = allocateSlot()
        val seq = IntArray(record.tokens.size)
        for (i in record.tokens.indices) {
            seq[i] = internToken(record.tokens[i])
        }
        val distinct = seq.distinctSorted()
        records[slot] = record
        sequenceIds[slot] = seq
        distinctIds[slot] = distinct
        for (tid in distinct) postings[tid].add(slot)
        exact.put(record.tokens, slot)
        idToSlot[record.id] = slot
        size++
        return slot
    }

    /** Replaces the record in [slot]; tokens must be unchanged (callers only edit payload). */
    fun replace(slot: Int, record: MemoryRecord) {
        val existing = records[slot] ?: error("slot $slot is free")
        require(existing.tokens == record.tokens) { "replace() cannot change tokens" }
        if (existing.id != record.id) {
            idToSlot.remove(existing.id)
            idToSlot[record.id] = slot
        }
        records[slot] = record
    }

    fun removeSlot(slot: Int): MemoryRecord? {
        val record = records.getOrNull(slot) ?: return null
        val distinct = distinctIds[slot]
        if (distinct != null) {
            for (tid in distinct) {
                val list = postings[tid]
                list.removeValue(slot)
                if (list.isEmpty()) releaseToken(tid)
            }
        }
        exact.remove(record.tokens)
        idToSlot.remove(record.id)
        records[slot] = null
        sequenceIds[slot] = null
        distinctIds[slot] = null
        freeSlots.add(slot)
        size--
        return record
    }

    fun clear() {
        records.clear()
        sequenceIds.clear()
        distinctIds.clear()
        freeSlots.clear()
        idToSlot.clear()
        exact.clear()
        tokenIds.clear()
        tokenText.clear()
        postings.clear()
        vocabularyByLength.clear()
        size = 0
    }

    // ---------------------------------------------------------------- reads

    fun findExact(tokens: List<String>): MemoryRecord? {
        val slot = exact.find(tokens)
        return if (slot == SequenceIndex.NOT_FOUND) null else records[slot]
    }

    fun slotOfId(id: Long): Int = idToSlot[id] ?: SequenceIndex.NOT_FOUND

    fun recordAt(slot: Int): MemoryRecord? = records.getOrNull(slot)

    fun allRecords(): List<MemoryRecord> = records.filterNotNull()

    /** Lowest-value unpinned slot, using frequency first and recency as the tie-break. */
    fun evictionCandidate(): Int {
        var best = SequenceIndex.NOT_FOUND
        var bestUse = Int.MAX_VALUE
        var bestSeen = Long.MAX_VALUE
        for (slot in records.indices) {
            val record = records[slot] ?: continue
            if (record.pinned) continue
            val seen = max(record.lastUsedAtMillis, record.createdAtMillis)
            if (record.useCount < bestUse || (record.useCount == bestUse && seen < bestSeen)) {
                best = slot
                bestUse = record.useCount
                bestSeen = seen
            }
        }
        return best
    }

    /**
     * Two-stage fuzzy search.
     *
     * Stage 1 walks the inverted index and keeps the [MemoryConfig.rescoreCandidates] best
     * candidates by IDF-weighted token overlap (a bounded min-heap, no sorting of the full
     * posting set). Stage 2 scores only those candidates precisely, including the order-aware
     * LCS term that is too expensive to run over the whole corpus.
     */
    fun search(queryTokens: List<String>, limit: Int, threshold: Double): List<MemoryMatch> {
        if (size == 0 || queryTokens.isEmpty()) return emptyList()
        val s = scratch.get()
        s.ensureCapacity(records.size, config.rescoreCandidates)
        s.nextGeneration()

        val n = size.toDouble()
        val unknownIdf = ln(1.0 + n)

        // --- resolve query tokens -> ids (with optional single-edit repair) ------------
        val querySeq = s.querySeq(queryTokens.size)
        var wQ = 0.0
        var knownCount = 0
        for (i in queryTokens.indices) {
            val token = queryTokens[i]
            var tid = tokenIds[token] ?: -1
            if (tid < 0 && config.tokenSpellRepair) tid = repair(token)
            querySeq[i] = tid
            if (tid >= 0) {
                if (!s.queryHas(tid)) {
                    s.markQuery(tid)
                    val weight = idf(postings[tid].size, n)
                    s.addQueryToken(tid, weight)
                    wQ += weight
                    knownCount++
                }
            } else {
                wQ += unknownIdf
            }
        }
        if (knownCount == 0) return emptyList()
        s.sortQueryTokens()

        // --- stage 1: candidate generation ---------------------------------------------
        val stopDf = max(1.0, config.stopTokenDocumentRatio * n)
        var scanned = 0
        for (k in 0 until s.queryCount) {
            val tid = s.queryIds[k]
            val list = postings[tid]
            // Skip a token that is in nearly every memory (`ME`) unless it is all we have.
            if (knownCount > 1 && list.size > stopDf) continue
            val weight = s.queryWeights[k]
            for (p in 0 until list.size) {
                s.accumulate(list[p], weight)
                scanned++
            }
        }
        if (s.touchedCount == 0) {
            // Every query token was a stop token: scan them anyway rather than miss.
            for (k in 0 until s.queryCount) {
                val tid = s.queryIds[k]
                val list = postings[tid]
                val weight = s.queryWeights[k]
                for (p in 0 until list.size) {
                    s.accumulate(list[p], weight)
                    scanned++
                }
            }
        }
        val candidateCount = s.selectTopCandidates()
        if (candidateCount == 0) return emptyList()

        // --- stage 2: precise scoring of the surviving candidates ----------------------
        val results = ArrayList<MemoryMatch>(candidateCount)
        for (c in 0 until candidateCount) {
            val slot = s.candidateSlots[c]
            val record = records[slot] ?: continue
            val recordDistinct = distinctIds[slot] ?: continue
            val recordSeq = sequenceIds[slot] ?: continue

            var overlap = 0.0
            var wR = 0.0
            var qi = 0
            for (tid in recordDistinct) {
                val weight = idf(postings[tid].size, n)
                wR += weight
                while (qi < s.queryCount && s.queryIds[qi] < tid) qi++
                if (qi < s.queryCount && s.queryIds[qi] == tid) overlap += weight
            }
            val union = wQ + wR - overlap
            val jaccard = if (union <= 0.0) 0.0 else overlap / union
            val coverage = if (wQ <= 0.0) 0.0 else overlap / wQ
            val lcs = TokenSimilarity.lcsLength(
                querySeq, queryTokens.size, recordSeq, recordSeq.size,
            )
            val order = lcs.toDouble() / max(queryTokens.size, recordSeq.size).toDouble()
            val score = (
                config.jaccardWeight * jaccard +
                    config.coverageWeight * coverage +
                    config.orderWeight * order
                ) / config.weightSum
            if (score >= threshold) {
                results.add(MemoryMatch(record, score.coerceIn(0.0, 1.0), MatchKind.FUZZY))
            }
        }
        s.lastScanned = scanned
        if (results.isEmpty()) return emptyList()
        results.sortWith(MATCH_ORDER)
        return if (results.size > limit) results.subList(0, limit).toList() else results
    }

    /** Records touched by the last stage-1 scan on this thread (diagnostics / tests). */
    fun lastScannedPostings(): Int = scratch.get().lastScanned

    // ---------------------------------------------------------------- internals

    private fun allocateSlot(): Int {
        if (!freeSlots.isEmpty()) {
            val slot = freeSlots[freeSlots.size - 1]
            freeSlots.removeValue(slot)
            return slot
        }
        records.add(null)
        sequenceIds.add(null)
        distinctIds.add(null)
        return records.size - 1
    }

    private fun internToken(token: String): Int {
        tokenIds[token]?.let { return it }
        val id = tokenText.size
        tokenIds[token] = id
        tokenText.add(token)
        postings.add(IntList())
        vocabularyByLength.getOrPut(token.length) { IntList() }.add(id)
        return id
    }

    /**
     * Drops a token whose postings list emptied. The id itself is retired (not reused) so that
     * every live `IntArray` of token ids stays valid; `tokenText` keeps a tombstone entry.
     */
    private fun releaseToken(tid: Int) {
        val text = tokenText[tid]
        if (text.isEmpty()) return
        tokenIds.remove(text)
        vocabularyByLength[text.length]?.removeValue(tid)
        tokenText[tid] = ""
    }

    private fun repair(token: String): Int {
        if (token.length < config.minRepairTokenLength || config.maxRepairEdits <= 0) return -1
        var bestId = -1
        var bestDistance = Int.MAX_VALUE
        var bestDf = -1
        val from = token.length - config.maxRepairEdits
        val to = token.length + config.maxRepairEdits
        for (len in from..to) {
            val bucket = vocabularyByLength[len] ?: continue
            for (i in 0 until bucket.size) {
                val tid = bucket[i]
                val candidate = tokenText[tid]
                if (candidate.isEmpty()) continue
                val distance = TokenSimilarity.boundedEditDistance(
                    token, candidate, config.maxRepairEdits,
                )
                if (distance == Int.MAX_VALUE) continue
                val df = postings[tid].size
                if (distance < bestDistance || (distance == bestDistance && df > bestDf)) {
                    bestId = tid
                    bestDistance = distance
                    bestDf = df
                }
            }
        }
        return bestId
    }

    private fun idf(df: Int, n: Double): Double = ln(1.0 + n / (1.0 + df.toDouble()))

    private fun IntArray.distinctSorted(): IntArray {
        val copy = copyOf()
        copy.sort()
        var write = 0
        for (i in copy.indices) {
            if (i == 0 || copy[i] != copy[i - 1]) copy[write++] = copy[i]
        }
        return copy.copyOf(write)
    }

    /**
     * Per-thread scratch space. Generation stamping means we never clear the weight array
     * between lookups — an important detail when the corpus is large and lookups are frequent.
     */
    private inner class Scratch {
        var weights = DoubleArray(0)
        var stamps = IntArray(0)
        var generation = 0
        var lastScanned = 0

        /** Slots touched during stage 1, in first-touch order. */
        private var touched = IntArray(0)
        var touchedCount = 0
            private set

        /** Min-heap of the K best candidates, filled once stage 1 has final weights. */
        var candidateSlots = IntArray(0)
        private var candidateWeights = DoubleArray(0)
        private var heapSize = 0

        var queryIds = IntArray(0)
        var queryWeights = DoubleArray(0)
        var queryCount = 0
        private var querySeqBuffer = IntArray(0)
        private var queryStamps = IntArray(0)

        fun ensureCapacity(slots: Int, k: Int) {
            if (weights.size < slots) {
                val target = max(slots, max(16, weights.size * 2))
                weights = DoubleArray(target)
                stamps = IntArray(target)
                touched = IntArray(target)
                generation = 0
            }
            if (queryStamps.size < tokenText.size) {
                queryStamps = IntArray(max(tokenText.size, max(16, queryStamps.size * 2)))
            }
            if (candidateSlots.size != k) {
                candidateSlots = IntArray(k)
                candidateWeights = DoubleArray(k)
            }
            if (queryIds.size < config.maxTokens) {
                queryIds = IntArray(config.maxTokens)
                queryWeights = DoubleArray(config.maxTokens)
            }
        }

        fun nextGeneration() {
            generation++
            if (generation == Int.MAX_VALUE) {
                stamps.fill(0)
                queryStamps.fill(0)
                generation = 1
            }
            touchedCount = 0
            heapSize = 0
            queryCount = 0
            lastScanned = 0
        }

        fun querySeq(length: Int): IntArray {
            if (querySeqBuffer.size < length) querySeqBuffer = IntArray(max(length, 16))
            return querySeqBuffer
        }

        fun queryHas(tid: Int): Boolean = queryStamps[tid] == generation

        fun markQuery(tid: Int) {
            queryStamps[tid] = generation
        }

        fun addQueryToken(tid: Int, weight: Double) {
            queryIds[queryCount] = tid
            queryWeights[queryCount] = weight
            queryCount++
        }

        /** Insertion sort by token id — `queryCount` is <= maxTokens and usually < 8. */
        fun sortQueryTokens() {
            for (i in 1 until queryCount) {
                val id = queryIds[i]
                val weight = queryWeights[i]
                var j = i - 1
                while (j >= 0 && queryIds[j] > id) {
                    queryIds[j + 1] = queryIds[j]
                    queryWeights[j + 1] = queryWeights[j]
                    j--
                }
                queryIds[j + 1] = id
                queryWeights[j + 1] = weight
            }
        }

        /** Adds [weight] to [slot]'s running overlap, remembering the slot on first touch. */
        fun accumulate(slot: Int, weight: Double) {
            if (stamps[slot] != generation) {
                stamps[slot] = generation
                weights[slot] = weight
                touched[touchedCount++] = slot
            } else {
                weights[slot] += weight
            }
        }

        /**
         * Keeps the K highest-weight touched slots in [candidateSlots]. One O(T log K) pass over
         * final weights — cheaper and simpler than maintaining a heap under mutating weights.
         */
        fun selectTopCandidates(): Int {
            heapSize = 0
            val k = candidateSlots.size
            for (i in 0 until touchedCount) {
                val slot = touched[i]
                val weight = weights[slot]
                if (heapSize < k) {
                    candidateSlots[heapSize] = slot
                    candidateWeights[heapSize] = weight
                    heapSize++
                    siftUp(heapSize - 1)
                } else if (weight > candidateWeights[0]) {
                    candidateSlots[0] = slot
                    candidateWeights[0] = weight
                    siftDown(0)
                }
            }
            return heapSize
        }

        private fun siftUp(start: Int) {
            var i = start
            while (i > 0) {
                val parent = (i - 1) / 2
                if (candidateWeights[parent] <= candidateWeights[i]) break
                swap(parent, i)
                i = parent
            }
        }

        private fun siftDown(start: Int) {
            var i = start
            while (true) {
                val left = i * 2 + 1
                val right = left + 1
                var smallest = i
                if (left < heapSize && candidateWeights[left] < candidateWeights[smallest]) {
                    smallest = left
                }
                if (right < heapSize && candidateWeights[right] < candidateWeights[smallest]) {
                    smallest = right
                }
                if (smallest == i) return
                swap(smallest, i)
                i = smallest
            }
        }

        private fun swap(a: Int, b: Int) {
            val slot = candidateSlots[a]
            candidateSlots[a] = candidateSlots[b]
            candidateSlots[b] = slot
            val weight = candidateWeights[a]
            candidateWeights[a] = candidateWeights[b]
            candidateWeights[b] = weight
        }
    }

    companion object {
        /**
         * Best score first; ties broken by how often the memory was used, then by recency,
         * then by id so results are fully deterministic (tests depend on this).
         */
        internal val MATCH_ORDER: Comparator<MemoryMatch> = Comparator { a, b ->
            var cmp = b.score.compareTo(a.score)
            if (cmp != 0) return@Comparator cmp
            cmp = b.record.useCount.compareTo(a.record.useCount)
            if (cmp != 0) return@Comparator cmp
            cmp = b.record.lastUsedAtMillis.compareTo(a.record.lastUsedAtMillis)
            if (cmp != 0) return@Comparator cmp
            a.record.id.compareTo(b.record.id)
        }
    }
}
