package com.mudra.memory.android.room

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import com.mudra.memory.MemoryRecord

/**
 * One confirmed translation on disk.
 *
 * The token sequence is stored as a single `|`-joined string rather than a child table: it is
 * only ever read back whole (warm-up loads the entire corpus into RAM), and one row per memory
 * keeps start-up to a single sequential scan. [com.mudra.memory.TokenNormalizer] strips `|`
 * from tokens, so the join is unambiguous.
 *
 * The primary key is assigned by the in-memory layer, never auto-generated: a confirmed phrase
 * has to be usable the instant it is confirmed, long before the write reaches SQLite.
 */
@Entity(
    tableName = "memories",
    indices = [Index(value = ["sequence"], unique = true)],
)
data class MemoryEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: Long,

    /** Canonical tokens joined with `|`, e.g. `ME|TEA|HOT`. */
    @ColumnInfo(name = "sequence")
    val sequence: String,

    @ColumnInfo(name = "translation")
    val translation: String,

    @ColumnInfo(name = "use_count")
    val useCount: Int,

    @ColumnInfo(name = "created_at")
    val createdAtMillis: Long,

    @ColumnInfo(name = "last_used_at")
    val lastUsedAtMillis: Long,

    @ColumnInfo(name = "pinned")
    val pinned: Boolean,
) {
    fun toRecord(): MemoryRecord = MemoryRecord(
        id = id,
        tokens = if (sequence.isEmpty()) emptyList() else sequence.split(SEPARATOR),
        translation = translation,
        useCount = useCount,
        createdAtMillis = createdAtMillis,
        lastUsedAtMillis = lastUsedAtMillis,
        pinned = pinned,
    )

    companion object {
        const val SEPARATOR = '|'

        fun fromRecord(record: MemoryRecord): MemoryEntity = MemoryEntity(
            id = record.id,
            sequence = record.tokens.joinToString(SEPARATOR.toString()),
            translation = record.translation,
            useCount = record.useCount,
            createdAtMillis = record.createdAtMillis,
            lastUsedAtMillis = record.lastUsedAtMillis,
            pinned = record.pinned,
        )
    }
}
