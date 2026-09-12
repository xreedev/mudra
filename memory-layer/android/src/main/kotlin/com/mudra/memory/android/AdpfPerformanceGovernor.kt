package com.mudra.memory.android

import android.os.Build
import android.os.PerformanceHintManager
import android.os.Process
import android.util.Log
import androidx.annotation.RequiresApi
import com.mudra.memory.PerformanceGovernor
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Android Dynamic Performance Framework (ADPF) hints around each lookup.
 *
 * On a current flagship — the iQOO 15's Snapdragon 8 Elite Gen 5 is the target device here —
 * the CPU governor is *reactive*: a burst of work that lasts a few hundred microseconds
 * finishes on a low-frequency efficiency core before the governor notices it should have
 * ramped. `PerformanceHintManager` inverts that. The app declares up front "this thread has
 * ~2 ms of latency-critical work", the platform places it accordingly, and each
 * `reportActualWorkDuration` teaches it how much headroom the session really needs.
 *
 * Practical effect for MUDRA+: the auto-fill lookup that happens the moment a sign is
 * recognized lands in the same frame instead of the next one, and the hint session decays back
 * to nothing when the user is idle, so there is no battery cost for the privilege.
 *
 * Everything degrades to a no-op: the API needs Android 12 (API 31), OEMs may not implement it,
 * and a hint session must never be the reason a translation fails to appear.
 */
@RequiresApi(Build.VERSION_CODES.S)
class AdpfPerformanceGovernor internal constructor(
    private val manager: PerformanceHintManager,
    private val targetDurationNanos: Long,
) : PerformanceGovernor, AutoCloseable {

    /**
     * Hint sessions are bound to the threads they are created for, and lookups can arrive from
     * the camera thread, a coroutine worker, or the main thread — so each gets its own session.
     */
    private val sessions = ThreadLocal.withInitial { createSession() }
    private val created = CopyOnWriteArrayList<PerformanceHintManager.Session>()

    override fun beginWork(): Long {
        // Nothing to do up front beyond making sure this thread has a session; the platform
        // reads the reported durations, not a start marker.
        sessions.get()
        return System.nanoTime()
    }

    override fun endWork(token: Long, actualDurationNanos: Long) {
        if (actualDurationNanos <= 0L) return
        val session = sessions.get() ?: return
        try {
            session.reportActualWorkDuration(actualDurationNanos)
        } catch (error: RuntimeException) {
            Log.w(TAG, "reportActualWorkDuration failed; disabling hints for this thread", error)
            sessions.set(null)
        }
    }

    override fun close() {
        for (session in created) {
            runCatching { session.close() }
        }
        created.clear()
    }

    private fun createSession(): PerformanceHintManager.Session? = try {
        manager.createHintSession(intArrayOf(Process.myTid()), targetDurationNanos)
            ?.also { created.add(it) }
    } catch (error: RuntimeException) {
        Log.w(TAG, "PerformanceHintManager session unavailable", error)
        null
    }

    internal companion object {
        private const val TAG = "MudraMemoryAdpf"
    }
}
