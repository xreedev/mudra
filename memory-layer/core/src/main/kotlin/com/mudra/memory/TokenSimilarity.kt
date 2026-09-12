package com.mudra.memory

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Sequence-level similarity helpers. Everything here is bounded work on short token arrays
 * (<= [MemoryConfig.maxTokens]) and allocates at most two small rows.
 */
internal object TokenSimilarity {

    /**
     * Length of the longest common subsequence of two token-id sequences.
     * Order-aware, so `ME TEA HOT` scores higher against `ME WANT TEA HOT` than against
     * `HOT TEA ME`, which is exactly the discrimination gloss ordering needs.
     */
    fun lcsLength(a: IntArray, aLen: Int, b: IntArray, bLen: Int): Int {
        if (aLen == 0 || bLen == 0) return 0
        // Iterate over the shorter sequence in the inner dimension to keep the rows small.
        val (x, xLen, y, yLen) = if (aLen <= bLen) {
            Quad(a, aLen, b, bLen)
        } else {
            Quad(b, bLen, a, aLen)
        }
        var previous = IntArray(xLen + 1)
        var current = IntArray(xLen + 1)
        for (i in 1..yLen) {
            val yi = y[i - 1]
            current[0] = 0
            for (j in 1..xLen) {
                current[j] = if (x[j - 1] == yi) {
                    previous[j - 1] + 1
                } else {
                    max(previous[j], current[j - 1])
                }
            }
            val swap = previous
            previous = current
            current = swap
        }
        return previous[xLen]
    }

    /**
     * Levenshtein distance with early exit once the best possible distance exceeds [maxEdits].
     * Used only for repairing unknown query tokens against the vocabulary.
     */
    fun boundedEditDistance(a: String, b: String, maxEdits: Int): Int {
        if (maxEdits < 0) return Int.MAX_VALUE
        if (a == b) return 0
        if (abs(a.length - b.length) > maxEdits) return Int.MAX_VALUE
        if (a.isEmpty()) return b.length
        if (b.isEmpty()) return a.length

        var previous = IntArray(b.length + 1) { it }
        var current = IntArray(b.length + 1)
        for (i in 1..a.length) {
            current[0] = i
            val ai = a[i - 1]
            var rowMin = current[0]
            val from = max(1, i - maxEdits)
            val to = min(b.length, i + maxEdits)
            // Cells outside the diagonal band can never yield a distance <= maxEdits.
            for (j in 1..b.length) {
                current[j] = if (j < from || j > to) {
                    Int.MAX_VALUE / 2
                } else {
                    val substitution = previous[j - 1] + if (ai == b[j - 1]) 0 else 1
                    min(substitution, min(previous[j] + 1, current[j - 1] + 1))
                }
                if (current[j] < rowMin) rowMin = current[j]
            }
            if (rowMin > maxEdits) return Int.MAX_VALUE
            val swap = previous
            previous = current
            current = swap
        }
        val distance = previous[b.length]
        return if (distance > maxEdits) Int.MAX_VALUE else distance
    }

    private data class Quad(val a: IntArray, val aLen: Int, val b: IntArray, val bLen: Int) {
        override fun equals(other: Any?): Boolean = this === other
        override fun hashCode(): Int = System.identityHashCode(this)
    }
}
