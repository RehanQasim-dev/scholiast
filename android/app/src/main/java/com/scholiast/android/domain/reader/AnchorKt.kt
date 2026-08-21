package com.scholiast.android.domain.reader

/**
 * Pure-JVM Kotlin port of the desktop's cross-surface text-quote anchoring
 * (`shared/anchor.ts`) plus its dependency-free fuzzy matcher
 * (`shared/fuzzy-match.ts`). Zero Android dependencies — this is the contract
 * that lets a highlight made in the Reader resolve on the live web page /
 * Obsidian note and vice versa, through a three-tier fallback:
 *
 *   1. exact `indexOf`
 *   2. whitespace-insensitive match (reports the *real* span)
 *   3. fuzzy edit-distance match, gated by quality thresholds
 *
 * Mapping to the TypeScript source of truth:
 * - [TextQuoteAnchor]           ← anchor.ts:34–47 (`TextQuoteAnchor`)
 * - [CONTEXT_LEN]               ← anchor.ts:83
 * - [buildTextQuoteAnchor]      ← anchor.ts:94–132 (`buildTextQuote`)
 * - [findTextQuote]             ← anchor.ts:181–189
 * - [findTextQuoteRange]        ← anchor.ts:204–214
 * - [findWhitespaceInsensitive] ← anchor.ts:299–330
 * - [findFuzzy]                 ← anchor.ts:233–272 (+ thresholds :222–224)
 * - [collapseWs]                ← anchor.ts:296
 * - [commonPrefixLen]/[commonSuffixLen] ← anchor.ts:163–175
 * - [approxMatch]               ← fuzzy-match.ts:27–105
 * - [trimRange]                 ← src/utils/trim-range.ts (flat-text variant)
 * - [mergeOverlappingRanges]    ← consumer-side grouping semantics (Task 29)
 */

/** Characters of surrounding context captured on each side of a quote. */
const val CONTEXT_LEN = 32

/** Minimum fraction of the (normalized) quote that must survive a fuzzy match. */
private const val FUZZY_MIN_QUOTE_SCORE = 0.74

/** Minimum combined (quote + context) weighted score for a fuzzy match. */
private const val FUZZY_MIN_SCORE = 0.7

/**
 * Portable, structure-independent anchor: the quoted text plus up to
 * [CONTEXT_LEN] characters of context on each side, and an `occurrence` index
 * disambiguating identical quote+context repeats within a document.
 */
data class TextQuoteAnchor(
    val quote: String,
    val prefix: String = "",
    val suffix: String = "",
    val occurrence: Int = 0,
)

// ---------------------------------------------------------------------------
// Pure string core
// ---------------------------------------------------------------------------

/**
 * Build a text-quote anchor for the slice `[start, end)` of `fullText`.
 *
 * Context extension (anchor.ts:99–122): the TS side extends a short prefix/
 * suffix out to the boundaries of the enclosing sentence (via `Intl.Segmenter`,
 * capped at 200 chars, floored at [CONTEXT_LEN]). The JVM has no Segmenter, so
 * sentence boundaries are found by a deterministic scan for `.!?` terminator
 * runs followed by whitespace (or a blank-line paragraph break). When the
 * sentence is shorter than [CONTEXT_LEN] the result is byte-identical to the
 * plain fixed-width context, which is what the TS fixtures exercise.
 *
 * `occurrence` counts equally-scored matches *before* this position
 * (anchor.ts:126–131) so re-resolution lands back here.
 */
fun buildTextQuoteAnchor(fullText: String, start: Int, end: Int): TextQuoteAnchor {
    val quote = fullText.substring(start, end)
    var prefix = fullText.substring(maxOf(0, start - CONTEXT_LEN), start)
    var suffix = fullText.substring(end, minOf(fullText.length, end + CONTEXT_LEN))

    val sentenceStart = sentenceStartBefore(fullText, start)
    if (sentenceStart >= 0) {
        val prefixLen = maxOf(CONTEXT_LEN, minOf(200, start - sentenceStart))
        prefix = fullText.substring(maxOf(0, start - prefixLen), start)
    }
    val sentenceEnd = sentenceEndAfter(fullText, end)
    if (sentenceEnd >= 0) {
        val suffixLen = maxOf(CONTEXT_LEN, minOf(200, sentenceEnd - end))
        suffix = fullText.substring(end, minOf(fullText.length, end + suffixLen))
    }

    // Count how many equally-good (same context score) matches occur before this
    // position — that index is our occurrence (anchor.ts:128–130).
    val probe = TextQuoteAnchor(quote, prefix, suffix, 0)
    val matches = scoredMatches(fullText, probe)
    val best = matches.firstOrNull()?.score ?: 0
    return TextQuoteAnchor(quote, prefix, suffix, matches.count { it.score == best && it.index < start })
}

private class ScoredMatch(val index: Int, val score: Int)

/** All exact-quote positions in `fullText`, scored by how well context matches (anchor.ts:140–154). */
private fun scoredMatches(fullText: String, anchor: TextQuoteAnchor): List<ScoredMatch> {
    if (anchor.quote.isEmpty()) return emptyList()
    val out = mutableListOf<ScoredMatch>()
    var from = 0
    while (true) {
        val index = fullText.indexOf(anchor.quote, from)
        if (index == -1) break
        out.add(ScoredMatch(index, contextScore(fullText, index, anchor.quote.length, anchor.prefix, anchor.suffix)))
        from = index + maxOf(1, anchor.quote.length)
    }
    // Highest context score first; stable by position for equal scores.
    return out.sortedWith(compareByDescending<ScoredMatch> { it.score }.thenBy { it.index })
}

/** Number of matching context characters on both sides (higher = better) (anchor.ts:157–161). */
private fun contextScore(fullText: String, index: Int, quoteLen: Int, prefix: String, suffix: String): Int {
    val before = fullText.substring(maxOf(0, index - prefix.length), index)
    val after = fullText.substring(
        minOf(fullText.length, index + quoteLen),
        minOf(fullText.length, index + quoteLen + suffix.length),
    )
    return commonSuffixLen(before, prefix) + commonPrefixLen(after, suffix)
}

internal fun commonPrefixLen(a: String, b: String): Int {
    val n = minOf(a.length, b.length)
    var i = 0
    while (i < n && a[i] == b[i]) i++
    return i
}

internal fun commonSuffixLen(a: String, b: String): Int {
    val n = minOf(a.length, b.length)
    var i = 0
    while (i < n && a[a.length - 1 - i] == b[b.length - 1 - i]) i++
    return i
}

/**
 * Find the start offset of the best match for `anchor` in `fullText`
 * (anchor.ts:181–189), or `null` when the quote does not occur at all.
 */
fun findTextQuote(fullText: String, anchor: TextQuoteAnchor): Int? {
    val matches = scoredMatches(fullText, anchor)
    val first = matches.firstOrNull() ?: return null
    val best = first.score
    val equallyGood = matches.filter { it.score == best }.sortedBy { it.index }
    val pick = equallyGood[minOf(anchor.occurrence, equallyGood.size - 1)]
    return pick.index
}

/**
 * Find the span of the best match for `anchor` in `fullText` (anchor.ts:204–214):
 * exact → whitespace-insensitive → fuzzy. Returned as an inclusive [IntRange].
 * `null` when the quote can't be located by any tier.
 */
fun findTextQuoteRange(anchor: TextQuoteAnchor, fullText: String): IntRange? {
    val span = findTextQuote(fullText, anchor)?.let { Span(it, it + anchor.quote.length) }
        ?: findWhitespaceInsensitive(fullText, anchor)
        ?: findFuzzy(fullText, anchor)
        ?: return null
    return span.start..span.endInclusive
}

/** Half-open internal span (`end` exclusive), mirroring the TS `{start, end}` shape. */
private class Span(val start: Int, val endExclusive: Int) {
    val endInclusive: Int get() = endExclusive - 1
}

/**
 * Whitespace-insensitive search (anchor.ts:299–330); disambiguates by collapsed
 * context + occurrence, like the exact path, and reports the real original-text
 * span so interior whitespace differences are absorbed without dragging in
 * trailing whitespace.
 */
private fun findWhitespaceInsensitive(fullText: String, anchor: TextQuoteAnchor): Span? {
    val quoteNorm = collapseWs(anchor.quote)
    if (quoteNorm.isEmpty()) return null
    val (norm, map) = normalizeWithMap(fullText)
    val prefixNorm = collapseWs(anchor.prefix)
    val suffixNorm = collapseWs(anchor.suffix)

    val scored = mutableListOf<ScoredMatch>()
    var from = 0
    while (true) {
        val index = norm.indexOf(quoteNorm, from)
        if (index == -1) break
        val before = norm.substring(maxOf(0, index - prefixNorm.length), index)
        val after = norm.substring(
            minOf(norm.length, index + quoteNorm.length),
            minOf(norm.length, index + quoteNorm.length + suffixNorm.length),
        )
        scored.add(ScoredMatch(index, commonSuffixLen(before, prefixNorm) + commonPrefixLen(after, suffixNorm)))
        from = index + maxOf(1, quoteNorm.length)
    }
    scored.sortWith(compareByDescending<ScoredMatch> { it.score }.thenBy { it.index })
    val first = scored.firstOrNull() ?: return null
    val best = first.score
    val equallyGood = scored.filter { it.score == best }.sortedBy { it.index }
    val pick = equallyGood[minOf(anchor.occurrence, equallyGood.size - 1)]

    val startIdx = map.getOrNull(pick.index) ?: return null
    val lastChar = map.getOrNull(pick.index + quoteNorm.length - 1) ?: return null
    return Span(startIdx, lastChar + 1)
}

/**
 * Edit-distance fallback (anchor.ts:233–272). Operates on whitespace-normalized
 * text, weights the quote 0.6 and prefix/suffix context 0.2 each, and rejects
 * anything below the quality thresholds so a bad guess never displaces an
 * honest "unplaced".
 */
private fun findFuzzy(fullText: String, anchor: TextQuoteAnchor): Span? {
    val quoteNorm = collapseWs(anchor.quote)
    if (quoteNorm.length < 4) return null // too short to fuzzy-match safely
    val (norm, map) = normalizeWithMap(fullText)
    val prefixNorm = collapseWs(anchor.prefix)
    val suffixNorm = collapseWs(anchor.suffix)

    // Allow up to ~25% of the quote to differ, capped for very long quotes.
    val maxErrors = minOf(64.0, quoteNorm.length * 0.25).toInt()
    if (maxErrors < 1) return null
    val matches = approxMatch(norm, quoteNorm, maxErrors)
    if (matches.isEmpty()) return null

    var best: Span? = null
    var bestScore = Double.NEGATIVE_INFINITY
    for (m in matches) {
        val quoteScore = 1.0 - m.errors.toDouble() / quoteNorm.length
        if (quoteScore < FUZZY_MIN_QUOTE_SCORE) continue
        // Context similarity; collapseWs again on the slices — they can carry a
        // boundary space that prefixNorm/suffixNorm (already trimmed) lack.
        val before = collapseWs(norm.substring(maxOf(0, m.start - prefixNorm.length - 1), m.start))
        val after = collapseWs(norm.substring(minOf(norm.length, m.end), minOf(norm.length, m.end + suffixNorm.length + 1)))
        val prefixScore = if (prefixNorm.isEmpty()) 1.0 else commonSuffixLen(before, prefixNorm).toDouble() / prefixNorm.length
        val suffixScore = if (suffixNorm.isEmpty()) 1.0 else commonPrefixLen(after, suffixNorm).toDouble() / suffixNorm.length
        val score = 0.6 * quoteScore + 0.2 * prefixScore + 0.2 * suffixScore
        if (score > bestScore) {
            bestScore = score
            best = Span(m.start, m.end)
        }
    }
    if (best == null || bestScore < FUZZY_MIN_SCORE) return null

    val startIdx = map.getOrNull(best.start) ?: return null
    val lastChar = map.getOrNull(best.endInclusive) ?: return null
    return Span(startIdx, lastChar + 1)
}

/** Collapse each whitespace run to a single space, recording each output char's original index (anchor.ts:275–294). */
private fun normalizeWithMap(s: String): Pair<String, IntArray> {
    val sb = StringBuilder(s.length)
    val map = IntArray(s.length)
    var n = 0
    var inWs = false
    for (i in s.indices) {
        val ch = s[i]
        if (isJsWhitespace(ch)) {
            if (!inWs) {
                sb.append(' ')
                map[n++] = i // collapsed run → its first char's original index
                inWs = true
            }
        } else {
            sb.append(ch)
            map[n++] = i
            inWs = false
        }
    }
    return sb.substring(0, n) to map.copyOf(n)
}

/** JS `s.replace(/\s+/g, ' ').trim()` without regex (anchor.ts:296). */
internal fun collapseWs(s: String): String {
    val sb = StringBuilder(s.length)
    var inWs = false
    for (ch in s) {
        if (isJsWhitespace(ch)) {
            if (!inWs) {
                sb.append(' ')
                inWs = true
            }
        } else {
            sb.append(ch)
            inWs = false
        }
    }
    var b = 0
    var e = sb.length
    while (b < e && sb[b] == ' ') b++
    while (e > b && sb[e - 1] == ' ') e--
    return sb.substring(b, e)
}

/**
 * Exactly the character class of the JavaScript `/\s/` regex (used by
 * normalizeWithMap/collapseWs in anchor.ts). Note this includes NBSP
 * (`\u00A0`) and friends, which `Character.isWhitespace` excludes.
 */
internal fun isJsWhitespace(ch: Char): Boolean = when (ch) {
    ' ', '\t', '\n', '\u000B', '\u000C', '\r',
    '\u00A0', '\u1680',
    '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005', '\u2006',
    '\u2007', '\u2008', '\u2009', '\u200A',
    '\u2028', '\u2029', '\u202F', '\u205F', '\u3000', '\uFEFF',
    -> true
    else -> false
}

// ---------------------------------------------------------------------------
// Fuzzy matcher — port of shared/fuzzy-match.ts (banded edit-distance scan)
// ---------------------------------------------------------------------------

private data class ApproxMatchResult(val start: Int, val end: Int, val errors: Int)

private data class EndMatch(val end: Int, val errors: Int)

/**
 * End offsets in `text` of approximate matches of `pattern` whose edit distance
 * is `<= maxErrors` (fuzzy-match.ts:27–78). When `allPositions` is false,
 * contiguous runs of qualifying end positions collapse to their lowest-error
 * position; when true, every qualifying end is returned (reverse pass).
 */
private fun searchEnds(text: String, pattern: String, maxErrors: Int, allPositions: Boolean): List<EndMatch> {
    val m = pattern.length
    val n = text.length
    val out = mutableListOf<EndMatch>()
    if (m == 0) return out

    // Rolling columns of the edit-distance matrix. Row 0 pinned to 0 so the
    // match may start anywhere (substring search). Every cell of `cur` is
    // rewritten before it is read on the next pass, so a reference swap is safe.
    var prev = IntArray(m + 1) { it }
    var cur = IntArray(m + 1)

    var runEnd = -1
    var runErr = Int.MAX_VALUE
    for (j in 1..n) {
        cur[0] = 0
        val tc = text[j - 1]
        for (i in 1..m) {
            val cost = if (pattern[i - 1] == tc) 0 else 1
            var v = prev[i - 1] + cost // substitute / match
            val del = prev[i] + 1 // skip a pattern char (insertion in text)
            if (del < v) v = del
            val ins = cur[i - 1] + 1 // skip a text char (deletion from text)
            if (ins < v) v = ins
            cur[i] = v
        }
        val e = cur[m]
        if (allPositions) {
            if (e <= maxErrors) out.add(EndMatch(j, e))
        } else {
            if (e <= maxErrors && e < runErr) {
                runErr = e
                runEnd = j
            }
            if (runEnd != -1 && e > runErr) {
                out.add(EndMatch(runEnd, runErr))
                runEnd = -1
                runErr = Int.MAX_VALUE
            }
        }
        val tmp = prev
        prev = cur
        cur = tmp
    }
    if (!allPositions && runEnd != -1) out.add(EndMatch(runEnd, runErr))
    return out
}

/**
 * Find approximate matches of `pattern` in `text` allowing up to `maxErrors`
 * edits (fuzzy-match.ts:91–105). Each result carries `start`, `end`, `errors`;
 * the start is recovered by re-running the scan on a reversed window before the
 * end, choosing the longest span so interior edits don't truncate the match.
 */
private fun approxMatch(text: String, pattern: String, maxErrors: Int): List<ApproxMatchResult> {
    if (pattern.isEmpty() || text.isEmpty() || maxErrors < 0) return emptyList()
    val ends = searchEnds(text, pattern, maxErrors, allPositions = false)
    val patRev = pattern.reversed()
    return ends.map { (end, errors) ->
        val minStart = maxOf(0, end - pattern.length - errors)
        val textRev = text.substring(minStart, end).reversed()
        val revEnds = searchEnds(textRev, patRev, errors, allPositions = true)
        var start = end
        for (re in revEnds) {
            val s = end - re.end
            if (s < start) start = s
        }
        ApproxMatchResult(start, end, errors)
    }
}

// ---------------------------------------------------------------------------
// Sentence-boundary scan (JVM stand-in for Intl.Segmenter, anchor.ts:99–122)
// ---------------------------------------------------------------------------

/** Offset just after the last sentence terminator before `pos`, or 0. */
private fun sentenceStartBefore(text: String, pos: Int): Int {
    var i = pos - 1
    while (i >= 0) {
        val c = text[i]
        if (c == '.' || c == '!' || c == '?') {
            if (i + 1 >= pos || isJsWhitespace(text[i + 1])) {
                var k = i + 1
                while (k < pos && isJsWhitespace(text[k])) k++
                return k
            }
        }
        if (c == '\n' && i > 0 && text[i - 1] == '\n') {
            var k = i + 1
            while (k < pos && isJsWhitespace(text[k])) k++
            return k
        }
        i--
    }
    return 0
}

/** Offset just after the first sentence terminator at/after `pos`, or text.length. */
private fun sentenceEndAfter(text: String, pos: Int): Int {
    var i = pos
    while (i < text.length) {
        val c = text[i]
        if (c == '.' || c == '!' || c == '?') {
            if (i + 1 >= text.length || isJsWhitespace(text[i + 1])) {
                var j = i + 1
                while (j < text.length && (text[j] == '.' || text[j] == '!' || text[j] == '?')) j++
                return j
            }
        }
        if (c == '\n' && i + 1 < text.length && text[i + 1] == '\n') return i
        i++
    }
    return text.length
}

// ---------------------------------------------------------------------------
// Selection hygiene + grouping (consumed by Task 29 highlighting)
// ---------------------------------------------------------------------------

/**
 * Tighten `[start, end)` to the nearest non-whitespace characters on both
 * boundaries (flat-text variant of src/utils/trim-range.ts). A triple-click's
 * trailing newline must not get baked into an anchor's quote/offsets.
 * Returns an inclusive [IntRange]; [IntRange.EMPTY] when the span holds no
 * non-whitespace character (the TS DOM version throws RangeError instead).
 */
fun trimRange(text: String, start: Int, end: Int): IntRange {
    if (start < 0 || end > text.length || start >= end) return IntRange.EMPTY
    var s = start
    var e = end - 1
    while (s <= e && isJsWhitespace(text[s])) s++
    while (e >= s && isJsWhitespace(text[e])) e--
    return if (s > e) IntRange.EMPTY else s..e
}

/**
 * Merge overlapping **or adjacent** ranges into a sorted, disjoint list
 * (Task 29 groups multi-block selections through this). Empty ranges dropped.
 */
fun mergeOverlappingRanges(ranges: List<IntRange>): List<IntRange> {
    val sorted = ranges.filter { !it.isEmpty() }.sortedBy { it.first }
    val out = mutableListOf<IntRange>()
    for (r in sorted) {
        val last = out.lastOrNull()
        if (last != null && r.first <= last.last + 1) {
            if (r.last > last.last) out[out.size - 1] = last.first..r.last
        } else {
            out.add(r)
        }
    }
    return out
}
