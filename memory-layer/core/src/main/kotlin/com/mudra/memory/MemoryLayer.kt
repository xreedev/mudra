package com.mudra.memory

import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.locks.ReentrantReadWriteLock
import kotlin.concurrent.read
import kotlin.concurrent.write

/**
 * On-device translation memory for the MUDRA+ ASL pipeline.
 *
 * ```
 * ME|TEA|HOT  ->  "I want hot tea"
 * ```
 *
 * The contract the rest of the app relies on:
 *
 *  - **exact hits are O(1)** — one hash of the token characters and a single probe, no disk,
 *    no allocation, so the auto-fill can be rendered in the same frame as the recognition;
 *  - **near hits are cheap** — an inverted index narrows the corpus to a few dozen candidates
 *    before anything order-aware runs;
 *  - **a miss is a value, not an exception** — the caller decides what to do with it;
 *  - **writes never block a lookup** — persistence is write-behind on a background thread, and
 *    if the database fails the layer keeps serving from RAM in degraded mode.
 *
 * Thread-safe: many concurrent lookups, exclusive writes.
 */
class MemoryLayer @JvmOverloads constructor(
    private val store: MemoryStore = MemoryStore.NONE,
    val config: MemoryConfig = MemoryConfig(),
    private val clock: Clock = Clock.SYSTEM,
    private val writeScheduler: WriteScheduler = WriteScheduler.DIRECT,
    private val performanceGovernor: PerformanceGovernor = PerformanceGovernor.NONE,
    private val errorListener: MemoryErrorListener = MemoryErrorListener.IGNORE,
    hasher: SequenceHasher = SequenceHasher.FNV1A,
) : AutoCloseable {

    private val index = MemoryIndex(config, hasher)
    private val lock = ReentrantReadWriteLock()
    private val nextId = AtomicLong(1L)

    private val exactHits = AtomicLong()
    private val fuzzyHits = AtomicLong()
    private val misses = AtomicLong()
    private val writes = AtomicLong()
    private val evictions = AtomicLong()
    private val storeFailures = AtomicLong()
    private val lastLookupNanos = AtomicLong()

    private val degraded = AtomicBoolean(false)
    private val closed = AtomicBoolean(false)

    /** Outcome of [warmUp]; `skipped` rows were corrupt or violated the current config. */
    data class WarmUpResult(val loaded: Int, val skipped: Int, val degraded: Boolean)

    /**
     * Loads the persisted corpus into RAM. Call once at app start (off the main thread).
     * A corrupt or over-long row is skipped rather than failing start-up, and a store that
     * throws leaves the layer running in-memory only.
     */
    fun warmUp(): WarmUpResult {
        if (closed.get()) return WarmUpResult(0, 0, degraded.get())
        val persisted = try {
            store.loadAll()
        } catch (error: Throwable) {
            noteStoreFailure("loadAll", error)
            return WarmUpResult(0, 0, true)
        }
        var loaded = 0
        var skipped = 0
        lock.write {
            index.clear()
            var maxId = 0L
            for (row in persisted) {
                val normalized = TokenNormalizer.normalize(row.tokens, config)
                if (normalized !is NormalizationResult.Ok || row.translation.isBlank()) {
                    skipped++
                    continue
                }
                if (row.translation.length > config.maxTranslationLength || row.id <= 0L) {
                    skipped++
                    continue
                }
                val record = row.copy(tokens = normalized.tokens)
                val existing = index.findExact(record.tokens)
                if (existing != null) {
                    // Duplicate sequence in storage: keep the more-used / newer row.
                    if (prefers(record, existing)) {
                        val slot = index.slotOfId(existing.id)
                        if (slot != SequenceIndex.NOT_FOUND) index.removeSlot(slot)
                        index.add(record)
                    }
                    skipped++
                } else {
                    index.add(record)
                    loaded++
                }
                if (record.id > maxId) maxId = record.id
            }
            nextId.set(maxId + 1L)
        }
        return WarmUpResult(loaded, skipped, degraded.get())
    }

    // ------------------------------------------------------------------ retrieval

    /**
     * Looks up a recognized gloss sequence. Never throws; never touches disk.
     *
     * @param tokens raw recognizer output, e.g. `["me", "tea", "hot"]` (case/punctuation free).
     * @param limit  max fuzzy matches to return (clamped to [MemoryConfig.maxResults]).
     */
    @JvmOverloads
    fun lookup(tokens: Array<out String?>?, limit: Int = config.maxResults): MemoryLookupResult =
        lookup(tokens?.asList(), limit)

    @JvmOverloads
    fun lookup(tokens: Collection<String?>?, limit: Int = config.maxResults): MemoryLookupResult {
        if (closed.get()) {
            misses.incrementAndGet()
            return MemoryLookupResult.Miss(MissReason.INVALID_INPUT, "layer is closed")
        }
        val normalized = when (val result = TokenNormalizer.normalize(tokens, config)) {
            is NormalizationResult.Ok -> result.tokens
            is NormalizationResult.Invalid -> {
                misses.incrementAndGet()
                val reason = if (result.reason == RejectReason.EMPTY_TOKENS) {
                    MissReason.EMPTY_INPUT
                } else {
                    MissReason.INVALID_INPUT
                }
                return MemoryLookupResult.Miss(reason, result.detail)
            }
        }
        val effectiveLimit = limit.coerceIn(1, config.maxResults)
        val token = performanceGovernor.beginWork()
        val startedAt = System.nanoTime()
        try {
            return lock.read {
                val exact = index.findExact(normalized)
                if (exact != null) {
                    exactHits.incrementAndGet()
                    return@read MemoryLookupResult.Exact(MemoryMatch(exact, 1.0, MatchKind.EXACT))
                }
                if (index.size == 0) {
                    misses.incrementAndGet()
                    return@read MemoryLookupResult.Miss(MissReason.EMPTY_CORPUS)
                }
                val matches = index.search(normalized, effectiveLimit, config.fuzzyThreshold)
                if (matches.isEmpty()) {
                    misses.incrementAndGet()
                    MemoryLookupResult.Miss(MissReason.BELOW_THRESHOLD)
                } else {
                    fuzzyHits.incrementAndGet()
                    MemoryLookupResult.Fuzzy(matches)
                }
            }
        } finally {
            val elapsed = System.nanoTime() - startedAt
            lastLookupNanos.set(elapsed)
            performanceGovernor.endWork(token, elapsed)
        }
    }

    /**
     * Convenience for the auto-fill path: the stored English sentence when the layer is
     * confident about the sequence, otherwise `null`.
     */
    fun autoFill(tokens: Array<out String?>?): String? {
        val result = lookup(tokens, 1)
        return if (result.isConfident) result.best?.translation else null
    }

    /** Exact-only lookup — the strict O(1) path, no fuzzy fallback. */
    fun lookupExact(tokens: Array<out String?>?): MemoryRecord? {
        if (closed.get()) return null
        val normalized = TokenNormalizer.normalize(tokens, config)
        if (normalized !is NormalizationResult.Ok) return null
        return lock.read { index.findExact(normalized.tokens) }
    }

    // ------------------------------------------------------------------ writes

    /**
     * Stores (or reinforces) a user-confirmed translation. This is the only way memories are
     * created: the confirmation gate in the UI is what makes a translation trustworthy.
     */
    @JvmOverloads
    fun remember(
        tokens: Array<out String?>?,
        translation: String?,
        pinned: Boolean = false,
    ): RememberOutcome = remember(tokens?.asList(), translation, pinned)

    @JvmOverloads
    fun remember(
        tokens: Collection<String?>?,
        translation: String?,
        pinned: Boolean = false,
    ): RememberOutcome {
        if (closed.get()) return RememberOutcome.Rejected(RejectReason.CLOSED, "layer is closed")
        val normalized = when (val result = TokenNormalizer.normalize(tokens, config)) {
            is NormalizationResult.Ok -> result.tokens
            is NormalizationResult.Invalid ->
                return RememberOutcome.Rejected(result.reason, result.detail)
        }
        val text = translation?.trim()
        if (text.isNullOrEmpty()) {
            return RememberOutcome.Rejected(RejectReason.EMPTY_TRANSLATION, "translation is blank")
        }
        if (text.length > config.maxTranslationLength) {
            return RememberOutcome.Rejected(
                RejectReason.TRANSLATION_TOO_LONG,
                "${text.length} chars, max is ${config.maxTranslationLength}",
            )
        }
        val now = clock.nowMillis()
        return lock.write {
            val existing = index.findExact(normalized)
            if (existing != null) {
                val slot = index.slotOfId(existing.id)
                val updated = existing.copy(
                    translation = text,
                    useCount = existing.useCount + 1,
                    lastUsedAtMillis = now,
                    pinned = existing.pinned || pinned,
                )
                index.replace(slot, updated)
                writes.incrementAndGet()
                persist("update") { store.update(updated) }
                RememberOutcome.Updated(updated, existing.translation)
            } else {
                if (index.size >= config.maxRecords && !evictOne()) {
                    return@write RememberOutcome.Rejected(
                        RejectReason.CAPACITY_EXHAUSTED,
                        "all ${config.maxRecords} records are pinned",
                    )
                }
                val record = MemoryRecord(
                    id = nextId.getAndIncrement(),
                    tokens = normalized,
                    translation = text,
                    useCount = 1,
                    createdAtMillis = now,
                    lastUsedAtMillis = now,
                    pinned = pinned,
                )
                index.add(record)
                writes.incrementAndGet()
                persist("insert") { store.insert(record) }
                RememberOutcome.Stored(record)
            }
        }
    }

    /**
     * Marks a returned memory as actually used (the user accepted the auto-fill). Feeds the
     * ranking tie-break and the eviction policy. Returns the updated record, or `null` if it
     * is gone.
     */
    fun accept(id: Long): MemoryRecord? {
        if (closed.get()) return null
        val now = clock.nowMillis()
        return lock.write {
            val slot = index.slotOfId(id)
            if (slot == SequenceIndex.NOT_FOUND) return@write null
            val existing = index.recordAt(slot) ?: return@write null
            val updated = existing.copy(useCount = existing.useCount + 1, lastUsedAtMillis = now)
            index.replace(slot, updated)
            persist("touch") { store.touch(id, updated.useCount, now) }
            updated
        }
    }

    /** Pins a memory so eviction can never reclaim it (emergency phrases). */
    fun setPinned(id: Long, pinned: Boolean): MemoryRecord? {
        if (closed.get()) return null
        return lock.write {
            val slot = index.slotOfId(id)
            if (slot == SequenceIndex.NOT_FOUND) return@write null
            val existing = index.recordAt(slot) ?: return@write null
            val updated = existing.copy(pinned = pinned)
            index.replace(slot, updated)
            persist("update") { store.update(updated) }
            updated
        }
    }

    /** Removes the memory for an exact token sequence. */
    fun forget(tokens: Array<out String?>?): Boolean = forget(tokens?.asList())

    fun forget(tokens: Collection<String?>?): Boolean {
        if (closed.get()) return false
        val normalized = TokenNormalizer.normalize(tokens, config)
        if (normalized !is NormalizationResult.Ok) return false
        return lock.write {
            val existing = index.findExact(normalized.tokens) ?: return@write false
            forgetLocked(existing.id)
        }
    }

    fun forgetById(id: Long): Boolean {
        if (closed.get()) return false
        return lock.write { forgetLocked(id) }
    }

    /** Wipes every memory, in RAM and on disk. */
    fun clear() {
        if (closed.get()) return
        lock.write {
            index.clear()
            nextId.set(1L)
            persist("deleteAll") { store.deleteAll() }
        }
    }

    /** Bulk seed (onboarding phrase packs, restore from backup). Returns how many were stored. */
    fun rememberAll(entries: Map<out Collection<String?>, String>): Int =
        entries.count { (tokens, translation) -> remember(tokens, translation) !is RememberOutcome.Rejected }

    // ------------------------------------------------------------------ introspection

    fun size(): Int = lock.read { index.size }

    /** Immutable snapshot of every memory — export, debugging, tests. */
    fun snapshot(): List<MemoryRecord> = lock.read { index.allRecords() }

    fun stats(): MemoryStats = lock.read {
        MemoryStats(
            records = index.size,
            vocabulary = index.vocabularySize,
            exactHits = exactHits.get(),
            fuzzyHits = fuzzyHits.get(),
            misses = misses.get(),
            writes = writes.get(),
            evictions = evictions.get(),
            storeFailures = storeFailures.get(),
            degraded = degraded.get(),
            lastLookupNanos = lastLookupNanos.get(),
        )
    }

    /** `true` once a persistence call has failed; the layer then serves from RAM only. */
    val isDegraded: Boolean get() = degraded.get()

    /** Waits for write-behind persistence to drain (tests, `onPause`, backup). */
    @JvmOverloads
    fun flush(timeoutMillis: Long = 5_000L): Boolean = writeScheduler.awaitIdle(timeoutMillis)

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        writeScheduler.awaitIdle(2_000L)
        writeScheduler.close()
        try {
            store.close()
        } catch (error: Throwable) {
            noteStoreFailure("close", error)
        }
        lock.write { index.clear() }
    }

    // ------------------------------------------------------------------ internals

    /** Caller must hold the write lock. */
    private fun forgetLocked(id: Long): Boolean {
        val slot = index.slotOfId(id)
        if (slot == SequenceIndex.NOT_FOUND) return false
        index.removeSlot(slot) ?: return false
        persist("delete") { store.delete(id) }
        return true
    }

    /** Caller must hold the write lock. Returns false when everything resident is pinned. */
    private fun evictOne(): Boolean {
        val slot = index.evictionCandidate()
        if (slot == SequenceIndex.NOT_FOUND) return false
        val removed = index.removeSlot(slot) ?: return false
        evictions.incrementAndGet()
        persist("delete") { store.delete(removed.id) }
        return true
    }

    private inline fun persist(operation: String, crossinline body: () -> Unit) {
        writeScheduler.submit {
            try {
                body()
            } catch (error: Throwable) {
                noteStoreFailure(operation, error)
            }
        }
    }

    private fun noteStoreFailure(operation: String, error: Throwable) {
        storeFailures.incrementAndGet()
        degraded.set(true)
        try {
            errorListener.onStoreFailure(operation, error)
        } catch (ignored: Throwable) {
            // A listener must never be able to take the memory layer down with it.
        }
    }

    private fun prefers(candidate: MemoryRecord, existing: MemoryRecord): Boolean =
        candidate.useCount > existing.useCount ||
            (candidate.useCount == existing.useCount &&
                candidate.lastUsedAtMillis > existing.lastUsedAtMillis)
}
