package com.mudra.memory

/**
 * Persistence socket. The engine is the id authority (ids are assigned in RAM so an auto-fill
 * never waits on disk), so implementations must honour the id they are given rather than
 * generating their own.
 *
 * Implementations may be called from a background writer thread; they must be safe for
 * single-threaded sequential use and may throw — [MemoryLayer] catches, counts, and degrades
 * to in-memory-only rather than losing the user's session.
 */
interface MemoryStore {

    /** Called once on warm-up. Return every persisted memory. */
    fun loadAll(): List<MemoryRecord>

    /** Insert a brand new record (its id is already assigned). */
    fun insert(record: MemoryRecord)

    /** Replace an existing record wholesale. */
    fun update(record: MemoryRecord)

    /** Cheap usage bump; separated so the common path can avoid rewriting the translation. */
    fun touch(id: Long, useCount: Int, lastUsedAtMillis: Long)

    fun delete(id: Long)

    fun deleteAll()

    fun close() {}

    companion object {
        /** A store that persists nothing — useful for tests and for a privacy "incognito" mode. */
        val NONE: MemoryStore = object : MemoryStore {
            override fun loadAll(): List<MemoryRecord> = emptyList()
            override fun insert(record: MemoryRecord) = Unit
            override fun update(record: MemoryRecord) = Unit
            override fun touch(id: Long, useCount: Int, lastUsedAtMillis: Long) = Unit
            override fun delete(id: Long) = Unit
            override fun deleteAll() = Unit
        }
    }
}

/** Simple in-RAM store; the reference implementation the JVM tests run against. */
class InMemoryMemoryStore(initial: List<MemoryRecord> = emptyList()) : MemoryStore {
    private val rows = LinkedHashMap<Long, MemoryRecord>()

    init {
        initial.forEach { rows[it.id] = it }
    }

    @Synchronized
    override fun loadAll(): List<MemoryRecord> = rows.values.toList()

    @Synchronized
    override fun insert(record: MemoryRecord) {
        rows[record.id] = record
    }

    @Synchronized
    override fun update(record: MemoryRecord) {
        rows[record.id] = record
    }

    @Synchronized
    override fun touch(id: Long, useCount: Int, lastUsedAtMillis: Long) {
        val existing = rows[id] ?: return
        rows[id] = existing.copy(useCount = useCount, lastUsedAtMillis = lastUsedAtMillis)
    }

    @Synchronized
    override fun delete(id: Long) {
        rows.remove(id)
    }

    @Synchronized
    override fun deleteAll() {
        rows.clear()
    }

    @Synchronized
    fun size(): Int = rows.size
}
