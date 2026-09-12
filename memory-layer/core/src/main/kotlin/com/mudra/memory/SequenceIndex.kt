package com.mudra.memory

/**
 * Open-addressing `hash(tokens) -> slot` map: the O(1) exact-match path.
 *
 * Why not `HashMap<String, Long>`: that forces us to build a joined key string (an allocation
 * plus a copy) on every single lookup, and boxes the value. Here the lookup hashes the token
 * chars in place and touches two primitive arrays, so an exact hit costs one hash plus (almost
 * always) one probe, with zero garbage — which is what keeps the auto-fill path off the GC.
 *
 * Hash collisions are resolved by *verifying tokens*, never by trusting the hash, so a colliding
 * pair of sequences still resolves correctly (see `SequenceIndexTest`).
 *
 * Not thread-safe: [MemoryLayer] owns the lock.
 */
internal class SequenceIndex(
    initialCapacity: Int,
    private val hasher: SequenceHasher = SequenceHasher.FNV1A,
    /** Resolves a slot to its canonical tokens, or `null` if the slot is stale. */
    private val resolver: (Int) -> List<String>?,
) {
    private var hashes = LongArray(tableSizeFor(initialCapacity))
    private var slots = IntArray(hashes.size) { EMPTY }

    /** Live entries. */
    var size: Int = 0
        private set

    /** Live entries + tombstones; drives the growth decision. */
    private var occupied: Int = 0

    fun find(tokens: List<String>): Int {
        val h = hasher.hash(tokens)
        var i = indexFor(h)
        val mask = hashes.size - 1
        var probes = 0
        while (probes <= mask) {
            val slot = slots[i]
            if (slot == EMPTY) return NOT_FOUND
            if (slot >= 0 && hashes[i] == h && resolver(slot) == tokens) return slot
            i = (i + 1) and mask
            probes++
        }
        return NOT_FOUND
    }

    /** Inserts or replaces the slot stored for [tokens]. Returns the previous slot, or -1. */
    fun put(tokens: List<String>, slot: Int): Int {
        require(slot >= 0) { "slot must be >= 0" }
        val h = hasher.hash(tokens)
        val mask = hashes.size - 1
        var i = indexFor(h)
        var firstTomb = -1
        var probes = 0
        while (probes <= mask) {
            val existing = slots[i]
            if (existing == EMPTY) {
                val target = if (firstTomb >= 0) firstTomb else i
                if (firstTomb < 0) occupied++
                hashes[target] = h
                slots[target] = slot
                size++
                growIfNeeded()
                return NOT_FOUND
            }
            if (existing == TOMBSTONE) {
                if (firstTomb < 0) firstTomb = i
            } else if (hashes[i] == h && resolver(existing) == tokens) {
                slots[i] = slot
                return existing
            }
            i = (i + 1) and mask
            probes++
        }
        // Table is full of live/tombstoned entries: grow and retry (cannot recurse twice).
        rehash(tableSizeFor(size * 2 + 1))
        return put(tokens, slot)
    }

    /** Removes [tokens]. Returns the removed slot, or -1 when absent. */
    fun remove(tokens: List<String>): Int {
        val h = hasher.hash(tokens)
        val mask = hashes.size - 1
        var i = indexFor(h)
        var probes = 0
        while (probes <= mask) {
            val slot = slots[i]
            if (slot == EMPTY) return NOT_FOUND
            if (slot >= 0 && hashes[i] == h && resolver(slot) == tokens) {
                slots[i] = TOMBSTONE
                hashes[i] = 0L
                size--
                return slot
            }
            i = (i + 1) and mask
            probes++
        }
        return NOT_FOUND
    }

    fun clear() {
        hashes = LongArray(hashes.size)
        slots = IntArray(hashes.size) { EMPTY }
        size = 0
        occupied = 0
    }

    /** Rebuilds the table from the live entries of [entries] (slot -> tokens). */
    fun rebuild(entries: Iterable<Pair<List<String>, Int>>) {
        clear()
        for ((tokens, slot) in entries) put(tokens, slot)
    }

    internal fun capacity(): Int = hashes.size

    private fun indexFor(hash: Long): Int = (hash.toInt() and (hashes.size - 1))

    private fun growIfNeeded() {
        // Keep at least 30% of the table empty so probing stays short and always terminates.
        if (occupied * 10 >= hashes.size * 7) {
            val target = if (size * 10 >= hashes.size * 5) hashes.size * 2 else hashes.size
            rehash(tableSizeFor(target))
        }
    }

    private fun rehash(newCapacity: Int) {
        val oldHashes = hashes
        val oldSlots = slots
        hashes = LongArray(newCapacity)
        slots = IntArray(newCapacity) { EMPTY }
        size = 0
        occupied = 0
        val mask = newCapacity - 1
        for (i in oldSlots.indices) {
            val slot = oldSlots[i]
            if (slot < 0) continue
            val h = oldHashes[i]
            var j = (h.toInt() and mask)
            while (slots[j] != EMPTY) j = (j + 1) and mask
            hashes[j] = h
            slots[j] = slot
            size++
            occupied++
        }
    }

    companion object {
        const val NOT_FOUND = -1
        private const val EMPTY = -1
        private const val TOMBSTONE = -2

        internal fun tableSizeFor(requested: Int): Int {
            var n = 16
            while (n < requested && n < (1 shl 30)) n = n shl 1
            return n
        }
    }
}
