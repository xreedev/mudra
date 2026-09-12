package com.mudra.memory.android

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.mudra.memory.MemoryLayer
import com.mudra.memory.MemoryRecord
import com.mudra.memory.RememberOutcome
import com.mudra.memory.WriteScheduler
import com.mudra.memory.android.room.MemoryEntity
import com.mudra.memory.android.room.MudraMemoryDatabase
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Room-backed persistence, run on the JVM through Robolectric. Retrieval logic is covered by the
 * `:core` suite; what matters here is that rows survive a round trip through SQLite intact.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class RoomMemoryStoreTest {

    private lateinit var database: MudraMemoryDatabase
    private lateinit var store: RoomMemoryStore

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = MudraMemoryDatabase.inMemory(context)
        store = RoomMemoryStore(database, ownsDatabase = false)
    }

    @After
    fun tearDown() {
        database.close()
    }

    @Test
    fun `a record round trips through sqlite unchanged`() {
        val record = MemoryRecord(
            id = 7L,
            tokens = listOf("ME", "TEA", "HOT"),
            translation = "I want hot tea",
            useCount = 3,
            createdAtMillis = 100L,
            lastUsedAtMillis = 200L,
            pinned = true,
        )
        assertEquals("ME|TEA|HOT", MemoryEntity.fromRecord(record).sequence)

        store.insert(record)
        assertEquals(listOf(record), store.loadAll())
    }

    @Test
    fun `touch, update and delete keep the table single valued per sequence`() {
        store.insert(MemoryRecord(1L, listOf("ME", "TEA"), "tea", 1, 10L, 10L))

        store.touch(1L, useCount = 5, lastUsedAtMillis = 999L)
        var loaded = store.loadAll().single()
        assertEquals(5, loaded.useCount)
        assertEquals(999L, loaded.lastUsedAtMillis)
        assertEquals("tea", loaded.translation) // a usage bump never rewrites the sentence

        store.update(loaded.copy(translation = "I would like tea"))
        loaded = store.loadAll().single()
        assertEquals("I would like tea", loaded.translation)

        // Same sequence under a different id: the unique index collapses it to one row.
        store.insert(MemoryRecord(2L, listOf("ME", "TEA"), "tea again", 1, 2L, 2L))
        assertEquals(1, store.persistedCount())

        store.delete(404L) // absent id is a no-op, not an error
        store.deleteAll()
        assertTrue(store.loadAll().isEmpty())
    }

    @Test
    fun `the layer persists to room and restores from it`() {
        val first = MemoryLayer(store = store, writeScheduler = WriteScheduler.DIRECT)
        assertTrue(
            first.remember(arrayOf("ME", "TEA", "HOT"), "I want hot tea") is RememberOutcome.Stored,
        )
        first.remember(arrayOf("HELP", "AMBULANCE", "NOW"), "I need an ambulance now", pinned = true)

        val second = MemoryLayer(store = store, writeScheduler = WriteScheduler.DIRECT)
        assertEquals(2, second.warmUp().loaded)
        assertEquals("I want hot tea", second.autoFill(arrayOf("me", "tea", "hot")))
        assertTrue(second.lookupExact(arrayOf("HELP", "AMBULANCE", "NOW"))!!.pinned)

        assertTrue(second.forget(arrayOf("ME", "TEA", "HOT")))
        assertEquals(1, store.persistedCount())

        val third = MemoryLayer(store = store, writeScheduler = WriteScheduler.DIRECT)
        third.warmUp()
        assertNull(third.lookupExact(arrayOf("ME", "TEA", "HOT")))
    }
}
