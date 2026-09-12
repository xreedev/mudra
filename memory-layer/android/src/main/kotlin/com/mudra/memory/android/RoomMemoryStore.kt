package com.mudra.memory.android

import com.mudra.memory.MemoryRecord
import com.mudra.memory.MemoryStore
import com.mudra.memory.android.room.MemoryEntity
import com.mudra.memory.android.room.MudraMemoryDatabase

/**
 * [MemoryStore] backed by Room/SQLite.
 *
 * Every call here runs on the memory layer's write-behind thread (except [loadAll], which runs
 * once at warm-up), so it is free to block. Exceptions are deliberately *not* swallowed: the
 * layer above counts them, flips into degraded mode, and reports them to the app.
 */
class RoomMemoryStore(
    private val database: MudraMemoryDatabase,
    /** `true` when this store owns the database handle and should close it. */
    private val ownsDatabase: Boolean = true,
) : MemoryStore {

    private val dao = database.memoryDao()

    override fun loadAll(): List<MemoryRecord> = dao.loadAll().map(MemoryEntity::toRecord)

    override fun insert(record: MemoryRecord) = dao.insert(MemoryEntity.fromRecord(record))

    override fun update(record: MemoryRecord) = dao.insert(MemoryEntity.fromRecord(record))

    override fun touch(id: Long, useCount: Int, lastUsedAtMillis: Long) =
        dao.touch(id, useCount, lastUsedAtMillis)

    override fun delete(id: Long) = dao.deleteById(id)

    override fun deleteAll() = dao.deleteAll()

    override fun close() {
        if (ownsDatabase && database.isOpen) database.close()
    }

    /** Row count straight from SQLite — diagnostics only, never on the lookup path. */
    fun persistedCount(): Int = dao.count()
}
