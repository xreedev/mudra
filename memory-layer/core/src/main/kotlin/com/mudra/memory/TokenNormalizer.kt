package com.mudra.memory

import java.util.Locale

/** Outcome of normalizing a raw recognizer token array. */
sealed interface NormalizationResult {
    @JvmInline
    value class Ok(val tokens: List<String>) : NormalizationResult
    data class Invalid(val reason: RejectReason, val detail: String) : NormalizationResult
}

/**
 * Turns whatever the sign classifier emits into the canonical gloss form used by every index.
 *
 * Rules (deliberately boring and deterministic — the same input must always produce the same key):
 *  - `null` / blank tokens are dropped, never crash the caller (Java interop hands us platform types);
 *  - trimmed and upper-cased with [Locale.ROOT] (never the device locale: Turkish `i` would
 *    otherwise make `SIGN` and `sign` different keys on a Turkish phone);
 *  - internal whitespace collapses to `_` so `"thank you"` and `"THANK_YOU"` share a key;
 *  - characters that are not letters, digits, `_`, `'`, `-` or `+` are dropped
 *    (punctuation from a fingerspelling fallback, stray emoji, control chars).
 */
object TokenNormalizer {

    /** Cheap pre-filter so a pathological raw token is rejected before we allocate anything. */
    private const val RAW_LENGTH_SLACK = 4

    fun normalize(raw: Array<out String?>?, config: MemoryConfig): NormalizationResult =
        normalize(raw?.asList(), config)

    fun normalize(raw: Collection<String?>?, config: MemoryConfig): NormalizationResult {
        if (raw.isNullOrEmpty()) {
            return NormalizationResult.Invalid(RejectReason.EMPTY_TOKENS, "no tokens supplied")
        }
        if (raw.size > config.maxTokens) {
            return NormalizationResult.Invalid(
                RejectReason.TOO_MANY_TOKENS,
                "${raw.size} tokens supplied, max is ${config.maxTokens}",
            )
        }
        val out = ArrayList<String>(raw.size)
        for (token in raw) {
            if (token == null) continue
            if (token.length > config.maxTokenLength * RAW_LENGTH_SLACK) {
                return NormalizationResult.Invalid(
                    RejectReason.TOKEN_TOO_LONG,
                    "raw token of ${token.length} chars exceeds limit",
                )
            }
            val normalized = normalizeToken(token) ?: continue
            if (normalized.length > config.maxTokenLength) {
                return NormalizationResult.Invalid(
                    RejectReason.TOKEN_TOO_LONG,
                    "token '${normalized.take(16)}...' is ${normalized.length} chars, " +
                        "max is ${config.maxTokenLength}",
                )
            }
            out.add(normalized)
        }
        if (out.isEmpty()) {
            return NormalizationResult.Invalid(
                RejectReason.EMPTY_TOKENS,
                "nothing survived normalization",
            )
        }
        return NormalizationResult.Ok(out)
    }

    /** Normalizes one token; returns `null` when nothing meaningful is left. */
    fun normalizeToken(raw: String): String? {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return null
        val sb = StringBuilder(trimmed.length)
        var pendingSeparator = false
        for (ch in trimmed) {
            when {
                ch.isWhitespace() -> pendingSeparator = sb.isNotEmpty()
                ch.isLetterOrDigit() || ch == '_' || ch == '\'' || ch == '-' || ch == '+' -> {
                    if (pendingSeparator) {
                        sb.append('_')
                        pendingSeparator = false
                    }
                    sb.append(ch)
                }
                // Everything else (punctuation, emoji, control characters) is dropped.
                else -> Unit
            }
        }
        if (sb.isEmpty()) return null
        return sb.toString().uppercase(Locale.ROOT)
    }
}
