package com.mudra.memory.android

import android.content.Context
import android.os.Process
import android.util.Log
import com.mudra.memory.BackgroundWriteScheduler
import com.mudra.memory.Clock
import com.mudra.memory.MemoryConfig
import com.mudra.memory.MemoryErrorListener
import com.mudra.memory.MemoryLayer
import com.mudra.memory.MemoryLookupResult
import com.mudra.memory.MemoryStats
import com.mudra.memory.MemoryStore
import com.mudra.memory.PerformanceGovernor
import com.mudra.memory.RememberOutcome
import com.mudra.memory.android.room.MudraMemoryDatabase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Android entry point: a [MemoryLayer] wired to Room, a background writer thread, and (where the
 * device supports it) ADPF CPU hints.
 *
 * ```kotlin
 * val memory = MudraMemory.create(context)
 * lifecycleScope.launch { memory.warmUp() }          // once, at start-up
 *
 * // on the recognition path - safe to call from the main thread, it is microseconds:
 * when (val hit = memory.lookup(glossTokens)) {
 *     is MemoryLookupResult.Exact -> prefill(hit.match.translation)
 *     is MemoryLookupResult.Fuzzy -> suggest(hit.matches)
 *     is MemoryLookupResult.Miss  -> Unit                 // nothing stored for this sequence
 * }
 *
 * // after the user confirms the sentence:
 * memory.remember(glossTokens, confirmedSentence)
 * ```
 */
class MudraMemory internal constructor(
    val layer: MemoryLayer,
    private val governor: PerformanceGovernor,
) : AutoCloseable {

    /** Loads the persisted corpus. Suspends on IO; everything after it is in-RAM. */
    suspend fun warmUp(): MemoryLayer.WarmUpResult = withContext(Dispatchers.IO) {
        val result = layer.warmUp()
        Log.i(TAG, "warm-up loaded ${result.loaded} memories (skipped ${result.skipped})")
        result
    }

    /** Fast path — an exact hit is a hash probe, so this is fine on the main thread. */
    fun lookup(tokens: Array<out String?>?): MemoryLookupResult = layer.lookup(tokens)

    fun lookup(tokens: Collection<String?>?): MemoryLookupResult = layer.lookup(tokens)

    /** The stored sentence when the layer is confident, otherwise `null`. */
    fun autoFill(tokens: Array<out String?>?): String? = layer.autoFill(tokens)

    /** Stores a user-confirmed translation. Returns immediately; the write lands off-thread. */
    @JvmOverloads
    fun remember(
        tokens: Array<out String?>?,
        translation: String?,
        pinned: Boolean = false,
    ): RememberOutcome = layer.remember(tokens, translation, pinned)

    /** Records that the user accepted a suggested memory. */
    fun accept(id: Long) = layer.accept(id)

    fun setPinned(id: Long, pinned: Boolean) = layer.setPinned(id, pinned)

    fun forget(tokens: Array<out String?>?): Boolean = layer.forget(tokens)

    fun forgetById(id: Long): Boolean = layer.forgetById(id)

    /** Wipes every stored memory — the "clear my history" switch. */
    suspend fun clear() = withContext(Dispatchers.IO) {
        layer.clear()
        layer.flush()
    }

    fun size(): Int = layer.size()

    fun stats(): MemoryStats = layer.stats()

    /** Call from `onStop`/`onPause` so pending writes reach disk before the process is killed. */
    suspend fun flush(timeoutMillis: Long = 5_000L): Boolean = withContext(Dispatchers.IO) {
        layer.flush(timeoutMillis)
    }

    override fun close() {
        layer.close()
        (governor as? AutoCloseable)?.let { runCatching { it.close() } }
    }

    companion object {
        private const val TAG = "MudraMemory"

        /**
         * Builds the production stack: Room persistence, a background writer at a slightly
         * lowered thread priority (never competing with the camera pipeline), and ADPF hints.
         */
        @JvmOverloads
        fun create(
            context: Context,
            config: MemoryConfig = MemoryConfig(),
            databaseName: String = MudraMemoryDatabaseNames.DEFAULT,
            errorListener: MemoryErrorListener = MemoryErrorListener { operation, error ->
                Log.w(TAG, "memory store failure during $operation", error)
            },
        ): MudraMemory {
            val store = try {
                RoomMemoryStore(MudraMemoryDatabase.open(context, databaseName))
            } catch (error: RuntimeException) {
                // A database that will not open must not stop the user from signing: run the
                // whole layer in RAM for this session instead.
                Log.e(TAG, "could not open the memory database; running in-memory only", error)
                MemoryStore.NONE
            }
            return create(context, store, config, errorListener)
        }

        /** Same, with an explicit store — used by tests and by an "incognito" session. */
        @JvmOverloads
        fun create(
            context: Context,
            store: MemoryStore,
            config: MemoryConfig = MemoryConfig(),
            errorListener: MemoryErrorListener = MemoryErrorListener { operation, error ->
                Log.w(TAG, "memory store failure during $operation", error)
            },
        ): MudraMemory {
            val governor = createPerformanceGovernor(context)
            val layer = MemoryLayer(
                store = store,
                config = config,
                clock = Clock.SYSTEM,
                writeScheduler = BackgroundWriteScheduler(
                    onThreadStart = {
                        // Persistence is never urgent; keep it off the big cores the camera and
                        // the classifier are using.
                        Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)
                    },
                ),
                performanceGovernor = governor,
                errorListener = errorListener,
            )
            return MudraMemory(layer, governor)
        }
    }
}

/** Database file names, kept out of the Room package so callers need not import it. */
object MudraMemoryDatabaseNames {
    const val DEFAULT: String = MudraMemoryDatabase.DEFAULT_NAME
}
