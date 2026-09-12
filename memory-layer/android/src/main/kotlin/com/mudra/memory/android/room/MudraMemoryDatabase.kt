package com.mudra.memory.android.room

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.sqlite.db.SupportSQLiteDatabase
import java.util.concurrent.Executors

@Database(entities = [MemoryEntity::class], version = 1, exportSchema = true)
abstract class MudraMemoryDatabase : RoomDatabase() {

    abstract fun memoryDao(): MemoryDao

    companion object {
        const val DEFAULT_NAME = "mudra_memory.db"

        /**
         * Opens the memory database tuned for a write-behind workload: many small writes, one
         * big sequential read at start-up.
         *
         *  - **WAL** so a background write never blocks the warm-up read (and vice versa);
         *  - **`synchronous = NORMAL`**, the standard companion to WAL: writes still survive an
         *    app crash, and we trade a fsync-per-commit for throughput. A memory lost to a
         *    kernel panic is re-learnable — the user simply confirms the phrase once more;
         *  - a **dedicated single-threaded executor** so Room's internal work never competes
         *    with the recognition pipeline for the shared AsyncTask pool.
         */
        @JvmOverloads
        fun open(
            context: Context,
            name: String = DEFAULT_NAME,
        ): MudraMemoryDatabase {
            val executor = Executors.newSingleThreadExecutor { runnable ->
                Thread(runnable, "mudra-memory-room").apply { isDaemon = true }
            }
            return Room.databaseBuilder(
                context.applicationContext,
                MudraMemoryDatabase::class.java,
                name,
            )
                .setJournalMode(JournalMode.WRITE_AHEAD_LOGGING)
                .setQueryExecutor(executor)
                .setTransactionExecutor(executor)
                .addCallback(object : Callback() {
                    override fun onOpen(db: SupportSQLiteDatabase) {
                        db.query("PRAGMA synchronous = NORMAL").close()
                    }
                })
                .build()
        }

        /** In-memory database for instrumentation tests. */
        fun inMemory(context: Context): MudraMemoryDatabase =
            Room.inMemoryDatabaseBuilder(context, MudraMemoryDatabase::class.java)
                .allowMainThreadQueries()
                .build()
    }
}
