package com.mudra.memory

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.util.Random
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * The memory layer's test suite: store, retrieve, survive bad input, survive a broken database,
 * and stay fast.
 */
class MemoryLayerTest {

    private fun layer(
        config: MemoryConfig = MemoryConfig(),
        store: MemoryStore = InMemoryMemoryStore(),
        clock: Clock = TestClock(1_000L),
    ) = MemoryLayer(store = store, config = config, clock = clock)

    private fun seeded(): MemoryLayer = layer().apply {
        remember(arrayOf("ME", "TEA", "HOT"), "I want hot tea")
        remember(arrayOf("ME", "COFFEE", "COLD"), "I want iced coffee")
        remember(arrayOf("ME", "NEED", "METFORMIN", "ONE", "STRIP"), "I need one strip of Metformin")
        remember(arrayOf("HELP", "AMBULANCE", "NOW"), "I need an ambulance now")
    }

    // ------------------------------------------------------------------ store and retrieve

    @Test
    fun `stores a confirmed translation and returns it exactly`() {
        val memory = layer()
        assertTrue(
            memory.remember(arrayOf("ME", "TEA", "HOT"), "I want hot tea") is RememberOutcome.Stored,
        )

        val result = memory.lookup(arrayOf("ME", "TEA", "HOT"))
        assertTrue(result is MemoryLookupResult.Exact)
        assertEquals("I want hot tea", result.best!!.translation)
        assertEquals(1.0, result.best!!.score, 0.0)
        assertEquals(MatchKind.EXACT, result.best!!.kind)
        assertTrue(result.isConfident)
        memory.close()
    }

    @Test
    fun `retrieval ignores case, punctuation, spacing and junk tokens`() {
        val memory = layer()
        memory.remember(arrayOf("thank you", "BYE"), "Thank you, goodbye")

        for (query in listOf(
            arrayOf("THANK_YOU", "BYE"),
            arrayOf("thank you", "bye"),
            arrayOf(" Thank  You ", "Bye!"),
            arrayOf("thank you", null, "  ", "bye"),
        )) {
            assertEquals(
                "failed for ${query.toList()}",
                "Thank you, goodbye",
                memory.autoFill(query),
            )
        }
        memory.close()
    }

    @Test
    fun `re-confirming a sequence updates the sentence and keeps one record`() {
        val clock = TestClock(1_000L)
        val memory = layer(clock = clock)
        val id = (memory.remember(arrayOf("ME", "TEA"), "tea") as RememberOutcome.Stored).record.id
        clock.advance(500)

        val updated = memory.remember(arrayOf("me", "tea"), "I would like tea")
        assertTrue(updated is RememberOutcome.Updated)
        assertEquals("tea", (updated as RememberOutcome.Updated).previousTranslation)
        assertEquals(id, updated.record.id)
        assertEquals(2, updated.record.useCount)
        assertEquals(1, memory.size())
        assertEquals("I would like tea", memory.autoFill(arrayOf("ME", "TEA")))
        memory.close()
    }

    @Test
    fun `forget and clear remove memories from ram and storage`() {
        val store = InMemoryMemoryStore()
        val memory = layer(store = store)
        memory.remember(arrayOf("ME", "TEA"), "tea")
        memory.remember(arrayOf("ME", "COFFEE"), "coffee")

        assertTrue(memory.forget(arrayOf("me", "tea")))
        assertFalse(memory.forget(arrayOf("me", "tea")))
        assertNull(memory.lookupExact(arrayOf("ME", "TEA")))

        memory.clear()
        assertEquals(0, memory.size())
        assertEquals(0, store.size())
        // Still usable after a wipe.
        assertTrue(memory.remember(arrayOf("ME", "TEA"), "tea") is RememberOutcome.Stored)
        memory.close()
    }

    // ------------------------------------------------------------------ fuzzy retrieval

    @Test
    fun `near misses still find the memory`() {
        val memory = seeded()
        // An extra gloss, a dropped gloss, reordered glosses, and a one-letter recognition error.
        assertEquals(
            "I want hot tea",
            memory.lookup(arrayOf("ME", "WANT", "TEA", "HOT")).best!!.translation,
        )
        assertEquals(
            "I need one strip of Metformin",
            memory.lookup(arrayOf("ME", "NEED", "METFORMIN", "STRIP")).best!!.translation,
        )
        assertEquals(
            "I want hot tea",
            memory.lookup(arrayOf("HOT", "TEA", "ME")).best!!.translation,
        )
        assertEquals(
            "I need one strip of Metformin",
            memory.lookup(arrayOf("ME", "NEED", "METFORMIM", "ONE", "STRIP")).best!!.translation,
        )
        memory.close()
    }

    @Test
    fun `gloss order affects ranking`() {
        val memory = layer()
        memory.remember(arrayOf("ME", "TEA", "HOT", "PLEASE"), "ordered")
        memory.remember(arrayOf("PLEASE", "HOT", "TEA", "ME"), "shuffled")

        val result = memory.lookup(arrayOf("ME", "TEA", "HOT"))
        assertEquals("ordered", result.best!!.translation)
        assertEquals(2, result.allMatches.size)
        assertTrue(result.allMatches[0].score > result.allMatches[1].score)
        memory.close()
    }

    @Test
    fun `an unrelated sequence misses instead of returning nonsense`() {
        val memory = seeded()
        val result = memory.lookup(arrayOf("AIRPORT", "TAXI", "LUGGAGE"))
        assertTrue("got $result", result is MemoryLookupResult.Miss)
        assertEquals(MissReason.BELOW_THRESHOLD, (result as MemoryLookupResult.Miss).reason)
        // One shared everyday gloss is not evidence either.
        assertTrue(memory.lookup(arrayOf("ME", "AIRPORT", "TAXI")) is MemoryLookupResult.Miss)
        memory.close()
    }

    @Test
    fun `a weak match is a suggestion, a strong one auto fills`() {
        val memory = seeded()
        val weak = memory.lookup(arrayOf("ME", "TEA"))
        assertTrue(weak is MemoryLookupResult.Fuzzy)
        assertFalse(weak.isConfident)
        assertNull(memory.autoFill(arrayOf("ME", "TEA")))

        val strong = memory.lookup(arrayOf("ME", "NEED", "METFORMIN", "ONE", "STRIPS"))
        assertTrue("score was ${strong.best!!.score}", strong.best!!.score > 0.9)
        assertTrue(strong.isConfident)
        memory.close()
    }

    @Test
    fun `results are capped, ordered by score, and break ties on usage`() {
        val memory = layer()
        repeat(20) { i -> memory.remember(arrayOf("ME", "TEA", "SUGAR$i"), "variant $i") }
        val capped = memory.lookup(arrayOf("ME", "TEA"), limit = 3)
        assertEquals(3, capped.allMatches.size)
        assertEquals(capped.allMatches.map { it.score }.sortedDescending(), capped.allMatches.map { it.score })

        val tied = layer()
        tied.remember(arrayOf("ME", "WATER", "COLD"), "cold water")
        val hot = tied.remember(arrayOf("ME", "WATER", "HOT"), "hot water") as RememberOutcome.Stored
        repeat(5) { tied.accept(hot.record.id) }
        assertEquals("hot water", tied.lookup(arrayOf("ME", "WATER")).best!!.translation)
        memory.close()
        tied.close()
    }

    // ------------------------------------------------------------------ bad input

    @Test
    fun `empty, null and oversized input is a value, never a crash`() {
        val memory = layer()
        memory.remember(arrayOf("ME", "TEA"), "tea")

        for (query in listOf<Array<String?>?>(null, arrayOf(), arrayOf(null, null), arrayOf("!!!"))) {
            val result = memory.lookup(query)
            assertEquals(MissReason.EMPTY_INPUT, (result as MemoryLookupResult.Miss).reason)
        }

        val tooMany = Array<String?>(memory.config.maxTokens + 1) { "T$it" }
        assertEquals(
            MissReason.INVALID_INPUT,
            (memory.lookup(tooMany) as MemoryLookupResult.Miss).reason,
        )
        val monster = arrayOf("ME", "X".repeat(1_000_000))
        assertEquals(
            MissReason.INVALID_INPUT,
            (memory.lookup(monster) as MemoryLookupResult.Miss).reason,
        )
        assertFalse(memory.forget(null as Array<String?>?))
        assertFalse(memory.forgetById(-1L))
        assertNull(memory.lookupExact(null))
        memory.close()
    }

    @Test
    fun `writes are rejected with a reason instead of throwing`() {
        val memory = layer()
        assertEquals(
            RejectReason.EMPTY_TOKENS,
            (memory.remember(null as Array<String?>?, "x") as RememberOutcome.Rejected).reason,
        )
        assertEquals(
            RejectReason.EMPTY_TRANSLATION,
            (memory.remember(arrayOf("ME"), "   ") as RememberOutcome.Rejected).reason,
        )
        assertEquals(
            RejectReason.TRANSLATION_TOO_LONG,
            (memory.remember(arrayOf("ME"), "x".repeat(2_000)) as RememberOutcome.Rejected).reason,
        )
        assertEquals(
            RejectReason.TOKEN_TOO_LONG,
            (memory.remember(arrayOf("X".repeat(500)), "x") as RememberOutcome.Rejected).reason,
        )
        assertEquals(0, memory.size())

        // Boundary values are accepted.
        assertTrue(
            memory.remember(
                Array<String?>(memory.config.maxTokens) { "T$it" },
                "y".repeat(memory.config.maxTranslationLength),
            ) is RememberOutcome.Stored,
        )
        memory.close()
    }

    @Test
    fun `a closed layer refuses work quietly`() {
        val memory = layer()
        memory.remember(arrayOf("ME", "TEA"), "tea")
        memory.close()

        assertEquals(
            MissReason.INVALID_INPUT,
            (memory.lookup(arrayOf("ME", "TEA")) as MemoryLookupResult.Miss).reason,
        )
        assertEquals(
            RejectReason.CLOSED,
            (memory.remember(arrayOf("ME", "TEA"), "tea") as RememberOutcome.Rejected).reason,
        )
        assertNull(memory.accept(1L))
        assertFalse(memory.forgetById(1L))
        memory.clear()
        memory.close() // idempotent
    }

    // ------------------------------------------------------------------ persistence

    @Test
    fun `memories survive a restart`() {
        val store = InMemoryMemoryStore()
        val first = MemoryLayer(store = store, writeScheduler = BackgroundWriteScheduler())
        first.remember(arrayOf("ME", "TEA", "HOT"), "I want hot tea")
        first.remember(arrayOf("HELP", "AMBULANCE"), "I need an ambulance", pinned = true)
        assertTrue(first.flush())
        first.close()

        val second = layer(store = store)
        val warmUp = second.warmUp()
        assertEquals(2, warmUp.loaded)
        assertFalse(warmUp.degraded)
        assertEquals("I want hot tea", second.autoFill(arrayOf("me", "tea", "hot")))
        assertTrue(second.lookupExact(arrayOf("HELP", "AMBULANCE"))!!.pinned)
        // Ids keep counting up, so a new memory cannot collide with a restored one.
        val stored = second.remember(arrayOf("ME", "COFFEE"), "coffee") as RememberOutcome.Stored
        assertTrue(stored.record.id > 2L)
        second.close()
    }

    @Test
    fun `warm up skips corrupt rows instead of failing start up`() {
        val store = InMemoryMemoryStore(
            listOf(
                MemoryRecord(1, listOf("ME", "TEA"), "tea"),
                MemoryRecord(2, emptyList(), "no tokens"),
                MemoryRecord(3, listOf("ME"), "   "),
                MemoryRecord(4, listOf("ME", "X".repeat(500)), "token too long"),
                MemoryRecord(0, listOf("BAD", "ID"), "id must be positive"),
                MemoryRecord(6, listOf("me", "tea"), "duplicate of row 1", useCount = 9),
            ),
        )
        val memory = layer(store = store)
        val result = memory.warmUp()
        assertEquals(1, result.loaded)
        assertEquals(5, result.skipped)
        assertEquals(1, memory.size())
        // The duplicate with the higher use count wins, and old rows are re-normalized.
        assertEquals("duplicate of row 1", memory.autoFill(arrayOf("ME", "TEA")))
        memory.close()
    }

    @Test
    fun `a failing database degrades to memory only instead of breaking the app`() {
        val failures = CopyOnWriteArrayList<String>()
        val memory = MemoryLayer(
            store = FailingStore,
            errorListener = { operation, _ -> failures.add(operation) },
        )
        assertTrue(memory.warmUp().degraded)
        assertTrue(memory.remember(arrayOf("ME", "TEA"), "tea") is RememberOutcome.Stored)
        assertEquals("tea", memory.autoFill(arrayOf("ME", "TEA")))
        assertTrue(memory.isDegraded)
        assertEquals(listOf("loadAll", "insert"), failures)
        assertEquals(2L, memory.stats().storeFailures)
        memory.close()
    }

    @Test
    fun `background writes all reach the store, even past the queue size`() {
        val store = InMemoryMemoryStore()
        val memory = MemoryLayer(
            store = store,
            writeScheduler = BackgroundWriteScheduler(queueCapacity = 8),
        )
        repeat(500) { i -> memory.remember(arrayOf("SIGN$i"), "phrase $i") }
        assertTrue(memory.flush(10_000))
        assertEquals(500, store.size())
        memory.close()
    }

    // ------------------------------------------------------------------ capacity

    @Test
    fun `the corpus stays bounded and sheds the least useful memory first`() {
        val clock = TestClock(1_000L)
        val memory = layer(config = MemoryConfig(maxRecords = 3), clock = clock)
        val keep = memory.remember(arrayOf("ME", "TEA"), "tea") as RememberOutcome.Stored
        memory.remember(arrayOf("ME", "COFFEE"), "coffee")
        memory.remember(arrayOf("ME", "WATER"), "water")
        repeat(5) {
            clock.advance(10)
            memory.accept(keep.record.id)
        }

        clock.advance(10)
        memory.remember(arrayOf("ME", "JUICE"), "juice")
        assertEquals(3, memory.size())
        assertEquals(1L, memory.stats().evictions)
        assertNotNull(memory.lookupExact(arrayOf("ME", "TEA")))
        assertNull(memory.lookupExact(arrayOf("ME", "COFFEE")))
        memory.close()
    }

    @Test
    fun `pinned memories are never evicted`() {
        val memory = layer(config = MemoryConfig(maxRecords = 2))
        memory.remember(arrayOf("HELP", "AMBULANCE"), "ambulance", pinned = true)
        repeat(50) { i -> memory.remember(arrayOf("SIGN$i"), "phrase $i") }
        assertEquals(2, memory.size())
        assertNotNull(memory.lookupExact(arrayOf("HELP", "AMBULANCE")))

        // A fully pinned corpus refuses new memories rather than dropping an emergency phrase.
        memory.setPinned(memory.snapshot().first { !it.pinned }.id, true)
        assertEquals(
            RejectReason.CAPACITY_EXHAUSTED,
            (memory.remember(arrayOf("MORE"), "more") as RememberOutcome.Rejected).reason,
        )
        memory.close()
    }

    // ------------------------------------------------------------------ concurrency and speed

    @Test
    fun `concurrent readers and writers stay consistent`() {
        val memory = MemoryLayer(
            store = InMemoryMemoryStore(),
            writeScheduler = BackgroundWriteScheduler(),
            clock = TestClock(1_000L),
        )
        val threads = 8
        val perThread = 400
        val errors = CopyOnWriteArrayList<Throwable>()
        val pool = Executors.newFixedThreadPool(threads)
        val done = CountDownLatch(threads)

        repeat(threads) { t ->
            pool.execute {
                try {
                    repeat(perThread) { i ->
                        val tokens = arrayOf("T$t", "SIGN$i", "TAIL")
                        memory.remember(tokens, "phrase $t-$i")
                        val hit = memory.lookup(tokens)
                        check(hit is MemoryLookupResult.Exact) { "expected exact, got $hit" }
                        check(hit.best!!.translation == "phrase $t-$i") { "wrong translation" }
                        memory.lookup(arrayOf("T$t", "SIGN$i"))
                    }
                } catch (error: Throwable) {
                    errors.add(error)
                } finally {
                    done.countDown()
                }
            }
        }
        assertTrue(done.await(120, TimeUnit.SECONDS))
        pool.shutdown()
        assertEquals(emptyList<Throwable>(), errors)
        assertEquals(threads * perThread, memory.size())
        memory.close()
    }

    @Test
    fun `exact lookup cost does not grow with the corpus`() {
        val small = corpus(1_000, seed = 1L)
        val large = corpus(50_000, seed = 2L)
        val smallNanos = timeLookups(small)
        val largeNanos = timeLookups(large)

        println("exact lookup: 1k corpus = ${smallNanos}ns/op, 50k corpus = ${largeNanos}ns/op")
        // A linear scan would be ~50x slower on the bigger corpus; hashing is flat.
        assertTrue(
            "lookup scaled with corpus size: ${smallNanos}ns -> ${largeNanos}ns",
            largeNanos < smallNanos * 8 + 2_000,
        )
        small.first.close()
        large.first.close()
    }

    // ------------------------------------------------------------------ helpers

    private fun corpus(size: Int, seed: Long): Pair<MemoryLayer, List<Array<String>>> {
        val vocabulary = listOf(
            "ME", "YOU", "WANT", "NEED", "HELP", "TEA", "COFFEE", "HOT", "COLD", "PLEASE",
            "NOW", "DOCTOR", "PHARMACY", "METFORMIN", "STRIP", "ONE", "AMBULANCE", "HOME",
        )
        val random = Random(seed)
        val memory = MemoryLayer(
            store = MemoryStore.NONE,
            config = MemoryConfig(maxRecords = size * 2),
            clock = TestClock(1L),
        )
        val sequences = ArrayList<Array<String>>(size)
        while (sequences.size < size) {
            val length = 3 + random.nextInt(3)
            val tokens = Array(length) { vocabulary[random.nextInt(vocabulary.size)] } +
                "UNIQUE${sequences.size}"
            if (memory.remember(tokens, "sentence ${sequences.size}") is RememberOutcome.Stored) {
                sequences.add(tokens)
            }
        }
        return memory to sequences
    }

    private fun timeLookups(corpus: Pair<MemoryLayer, List<Array<String>>>): Long {
        val (memory, sequences) = corpus
        val random = Random(11L)
        val iterations = 200_000
        repeat(iterations / 4) { memory.lookup(sequences[random.nextInt(sequences.size)]) }
        val startedAt = System.nanoTime()
        var hits = 0
        repeat(iterations) {
            if (memory.lookup(sequences[random.nextInt(sequences.size)])
                is MemoryLookupResult.Exact
            ) {
                hits++
            }
        }
        assertEquals(iterations, hits)
        return (System.nanoTime() - startedAt) / iterations
    }

    /** Stands in for a corrupt or full database. */
    private object FailingStore : MemoryStore {
        override fun loadAll(): List<MemoryRecord> = throw IOException("database is corrupt")
        override fun insert(record: MemoryRecord) = throw IOException("disk full")
        override fun update(record: MemoryRecord) = throw IOException("disk full")
        override fun touch(id: Long, useCount: Int, lastUsedAtMillis: Long) =
            throw IOException("disk full")
        override fun delete(id: Long) = throw IOException("disk full")
        override fun deleteAll() = throw IOException("disk full")
    }
}

/** Controllable clock so recency-dependent behaviour is deterministic. */
class TestClock(private var now: Long = 0L) : Clock {
    override fun nowMillis(): Long = now
    fun advance(millis: Long) {
        now += millis
    }
}
