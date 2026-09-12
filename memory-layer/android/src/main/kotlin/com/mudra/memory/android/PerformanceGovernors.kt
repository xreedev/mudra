package com.mudra.memory.android

import android.content.Context
import android.os.Build
import android.os.PerformanceHintManager
import android.util.Log
import com.mudra.memory.PerformanceGovernor

private const val TAG = "MudraMemoryAdpf"

/** Lookups are microseconds; 2 ms is a frame-safe target that keeps the hint modest. */
const val DEFAULT_HINT_TARGET_NANOS = 2_000_000L

/**
 * ADPF-backed [PerformanceGovernor] when the device supports it, otherwise a no-op.
 *
 * The API-31 types are only touched inside the version check, so [AdpfPerformanceGovernor] is
 * never loaded on an older device.
 */
@JvmOverloads
fun createPerformanceGovernor(
    context: Context,
    targetDurationNanos: Long = DEFAULT_HINT_TARGET_NANOS,
): PerformanceGovernor {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return PerformanceGovernor.NONE
    return try {
        val manager = context.applicationContext
            .getSystemService(PerformanceHintManager::class.java)
            ?: return PerformanceGovernor.NONE
        AdpfPerformanceGovernor(manager, targetDurationNanos)
    } catch (error: RuntimeException) {
        Log.w(TAG, "ADPF unavailable on this device", error)
        PerformanceGovernor.NONE
    }
}
