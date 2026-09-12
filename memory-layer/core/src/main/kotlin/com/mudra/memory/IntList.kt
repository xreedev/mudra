package com.mudra.memory

/** Minimal growable int array — postings lists without boxing every record slot. */
internal class IntList(initialCapacity: Int = 4) {
    var data: IntArray = IntArray(if (initialCapacity < 1) 1 else initialCapacity)
        private set
    var size: Int = 0
        private set

    fun add(value: Int) {
        if (size == data.size) data = data.copyOf(data.size * 2)
        data[size++] = value
    }

    operator fun get(index: Int): Int = data[index]

    fun contains(value: Int): Boolean {
        for (i in 0 until size) if (data[i] == value) return true
        return false
    }

    /** Removes the first occurrence of [value] (order is irrelevant for postings). */
    fun removeValue(value: Int): Boolean {
        for (i in 0 until size) {
            if (data[i] == value) {
                data[i] = data[size - 1]
                size--
                return true
            }
        }
        return false
    }

    fun clear() {
        size = 0
    }

    fun isEmpty(): Boolean = size == 0

    fun toIntArray(): IntArray = data.copyOf(size)
}
