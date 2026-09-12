package com.mudra.memory

import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadFactory
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * Where persistence work runs. The lookup path never touches disk; writes are handed here and
 * applied off the caller's thread (write-behind), so confirming a phrase costs a map insert.
 */
interface WriteScheduler {
    fun submit(task: Runnable)

    /** Blocks until queued work drains. Returns false on timeout. */
    fun awaitIdle(timeoutMillis: Long): Boolean

    fun close()

    companion object {
        /** Runs writes inline on the calling thread — deterministic, used by tests. */
        val DIRECT: WriteScheduler = object : WriteScheduler {
            override fun submit(task: Runnable) = task.run()
            override fun awaitIdle(timeoutMillis: Long): Boolean = true
            override fun close() = Unit
        }
    }
}

/**
 * Single background thread with a bounded queue. On overflow the write runs on the caller's
 * thread (caller-runs): a full queue must slow the app down, never silently drop a memory the
 * user confirmed.
 */
class BackgroundWriteScheduler(
    queueCapacity: Int = 512,
    threadName: String = "mudra-memory-writer",
    threadPriority: Int = Thread.NORM_PRIORITY - 1,
    /** Hook so Android can call `Process.setThreadPriority` on the writer thread. */
    private val onThreadStart: () -> Unit = {},
) : WriteScheduler {

    private val idleLock = Any()
    private val pending = AtomicLong(0)

    private val executor = ThreadPoolExecutor(
        1, 1, 30L, TimeUnit.SECONDS,
        ArrayBlockingQueue(queueCapacity),
        ThreadFactory { runnable ->
            Thread({
                onThreadStart()
                runnable.run()
            }, threadName).apply {
                isDaemon = true
                priority = threadPriority.coerceIn(Thread.MIN_PRIORITY, Thread.MAX_PRIORITY)
            }
        },
        ThreadPoolExecutor.CallerRunsPolicy(),
    ).apply { allowCoreThreadTimeOut(true) }

    override fun submit(task: Runnable) {
        pending.incrementAndGet()
        try {
            executor.execute {
                try {
                    task.run()
                } finally {
                    decrement()
                }
            }
        } catch (rejected: RuntimeException) {
            // Executor shut down (or rejected outright): do the work inline, never drop it.
            try {
                task.run()
            } finally {
                decrement()
            }
        }
    }

    override fun awaitIdle(timeoutMillis: Long): Boolean {
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMillis)
        synchronized(idleLock) {
            while (pending.get() > 0) {
                val remaining = deadline - System.nanoTime()
                if (remaining <= 0) return false
                @Suppress("PLATFORM_CLASS_MAPPED_TO_KOTLIN")
                (idleLock as Object).wait(
                    TimeUnit.NANOSECONDS.toMillis(remaining).coerceAtLeast(1L),
                )
            }
        }
        return true
    }

    override fun close() {
        executor.shutdown()
        if (!executor.awaitTermination(2, TimeUnit.SECONDS)) executor.shutdownNow()
    }

    private fun decrement() {
        if (pending.decrementAndGet() <= 0L) {
            synchronized(idleLock) {
                @Suppress("PLATFORM_CLASS_MAPPED_TO_KOTLIN")
                (idleLock as Object).notifyAll()
            }
        }
    }
}
