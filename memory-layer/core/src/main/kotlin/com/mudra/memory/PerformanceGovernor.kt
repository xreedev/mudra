package com.mudra.memory

/**
 * Hook for platform CPU hints around a latency-critical lookup.
 *
 * On the iQOO 15 (Snapdragon 8 Elite Gen 5, Android 16) the Android Dynamic Performance
 * Framework lets an app declare a target duration for a work session so the scheduler places
 * the thread on a prime core and ramps the DVFS governor *before* the work runs, instead of
 * reacting after the frame is already late. The core module stays pure Kotlin, so the actual
 * `PerformanceHintManager` session lives in the `:android` module and plugs in here.
 */
interface PerformanceGovernor {

    /** Called before a lookup. Returns a token passed back to [endWork]. */
    fun beginWork(): Long = 0L

    /** Called after a lookup with the measured duration so the platform can adapt. */
    fun endWork(token: Long, actualDurationNanos: Long) = Unit

    companion object {
        val NONE: PerformanceGovernor = object : PerformanceGovernor {}
    }
}

/** Reported when persistence misbehaves, so the app can surface "memory is read-only" in UI. */
fun interface MemoryErrorListener {
    fun onStoreFailure(operation: String, error: Throwable)

    companion object {
        val IGNORE: MemoryErrorListener = MemoryErrorListener { _, _ -> }
    }
}
