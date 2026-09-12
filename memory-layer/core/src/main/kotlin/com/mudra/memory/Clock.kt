package com.mudra.memory

/** Injectable wall clock so tests can control recency without sleeping. */
fun interface Clock {
    fun nowMillis(): Long

    companion object {
        val SYSTEM: Clock = Clock { System.currentTimeMillis() }
    }
}
