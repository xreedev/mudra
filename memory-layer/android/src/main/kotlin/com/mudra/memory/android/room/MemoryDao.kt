package com.mudra.memory.android.room

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update

@Dao
interface MemoryDao {

    /** Warm-up read: one sequential scan of the whole table. */
    @Query("SELECT * FROM memories")
    fun loadAll(): List<MemoryEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun insert(entity: MemoryEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun insertAll(entities: List<MemoryEntity>)

    @Update
    fun update(entity: MemoryEntity)

    /** Usage bump only — avoids rewriting the translation on every accepted auto-fill. */
    @Query("UPDATE memories SET use_count = :useCount, last_used_at = :lastUsedAt WHERE id = :id")
    fun touch(id: Long, useCount: Int, lastUsedAt: Long)

    @Query("DELETE FROM memories WHERE id = :id")
    fun deleteById(id: Long)

    @Query("DELETE FROM memories")
    fun deleteAll()

    @Query("SELECT COUNT(*) FROM memories")
    fun count(): Int
}
