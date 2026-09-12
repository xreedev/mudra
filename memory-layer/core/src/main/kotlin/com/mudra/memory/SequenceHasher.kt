package com.mudra.memory

/**
 * Hashes a canonical token sequence to 64 bits without allocating (no joined key string on the
 * hot path). Pluggable so tests can force hash collisions and prove the index still verifies
 * tokens before returning a hit.
 */
fun interface SequenceHasher {
    fun hash(tokens: List<String>): Long

    companion object {
        /** FNV-1a over the token characters, finished with a SplitMix64-style avalanche. */
        val FNV1A: SequenceHasher = SequenceHasher { tokens ->
            var h = -0x340d631b7bdddcdbL // 14695981039346656037
            for (i in tokens.indices) {
                val token = tokens[i]
                for (j in token.indices) {
                    h = (h xor token[j].code.toLong()) * 0x100000001b3L
                }
                // Separator so ["AB","C"] and ["A","BC"] never collide structurally.
                h = (h xor 0x1FL) * 0x100000001b3L
            }
            mix(h)
        }

        /** SplitMix64 finalizer: cheap avalanche, keeps linear probing from clustering. */
        internal fun mix(value: Long): Long {
            var z = value
            z = (z xor (z ushr 30)) * -0x40a7b892e31b1a47L
            z = (z xor (z ushr 27)) * -0x6b2fb644ecceee15L
            return z xor (z ushr 31)
        }
    }
}
