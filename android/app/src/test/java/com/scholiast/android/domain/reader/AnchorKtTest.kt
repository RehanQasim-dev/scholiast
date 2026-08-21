package com.scholiast.android.domain.reader

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Ports every pure-string fixture from the desktop's `shared/anchor.test.ts`
 * (the DOM/linkedom cases exercise `buildTextMap`/`resolveAnchor`, which are
 * browser-only and out of scope for `AnchorKt.kt`; their string-core essence —
 * whitespace-insensitive resolution reporting the real span — is covered by
 * [whitespaceInsensitiveMatchReportsRealSpan]). The final test pins the two
 * extra semantics Task 29 consumes (`trimRange`, `mergeOverlappingRanges`),
 * which have no TS fixture.
 */
class AnchorKtTest {

    // --- text-quote core (pure) — anchor.test.ts:25–55 -----------------------

    private val text = "The quick brown fox jumps over the lazy dog. The fox is quick."

    @Test
    fun buildsQuoteWithSurroundingContext() {
        val start = text.indexOf("brown fox")
        val q = buildTextQuoteAnchor(text, start, start + "brown fox".length)
        assertEquals("brown fox", q.quote)
        assertTrue(q.prefix.endsWith("quick "))
        assertTrue(q.suffix.startsWith(" jumps"))
        assertEquals(0, q.occurrence)
    }

    @Test
    fun roundTripsAUniqueQuote() {
        val start = text.indexOf("lazy dog")
        val q = buildTextQuoteAnchor(text, start, start + "lazy dog".length)
        assertEquals(start, findTextQuote(text, q))
    }

    @Test
    fun disambiguatesARepeatedQuoteByContextAndOccurrence() {
        val first = text.indexOf("fox")
        val second = text.indexOf("fox", first + 1)
        val q1 = buildTextQuoteAnchor(text, first, first + 3)
        val q2 = buildTextQuoteAnchor(text, second, second + 3)
        assertEquals(first, findTextQuote(text, q1))
        assertEquals(second, findTextQuote(text, q2))
    }

    @Test
    fun returnsNullWhenTheQuoteIsAbsent() {
        assertNull(findTextQuote(text, buildTextQuoteAnchor("cat", 0, 3)))
    }

    // --- whitespace collapse — essence of anchor.test.ts:107–119 -------------

    @Test
    fun whitespaceInsensitiveMatchReportsRealSpan() {
        // Captured on clean single-spaced Markdown (Obsidian's rendered note).
        val clean = "Intro. The shared sentence lives here."
        val start = clean.indexOf("shared sentence lives")
        val q = buildTextQuoteAnchor(clean, start, start + "shared sentence lives".length)

        // Live page: same words but raw newlines, indentation, and run-together spaces.
        val messy = "Intro. The   shared\n    sentence lives here."
        val r = findTextQuoteRange(q, messy)!!
        // The resolved span covers the original (messy) text for those words,
        // at its REAL offsets — not start + normalized length.
        assertEquals(messy.indexOf("shared"), r.first)
        assertEquals(messy.indexOf("lives") + "lives".length - 1, r.last)
        assertEquals("shared sentence lives", collapseWs(messy.substring(r.first, r.last + 1)))
    }

    // --- fuzzy fallback (findTextQuoteRange) — anchor.test.ts:151–176 --------

    private val original = "The quick brown fox jumps over the lazy dog near the river bank."

    @Test
    fun stillExactMatchesAnUnchangedQuote() {
        val start = original.indexOf("brown fox jumps")
        val q = buildTextQuoteAnchor(original, start, start + "brown fox jumps".length)
        val r = findTextQuoteRange(q, original)!!
        assertEquals("brown fox jumps", original.substring(r.first, r.last + 1))
    }

    @Test
    fun recoversAQuoteAfterASingleCharacterEdit() {
        val start = original.indexOf("brown fox jumps")
        val q = buildTextQuoteAnchor(original, start, start + "brown fox jumps".length)
        // Page later "fixes" a character: fox -> box.
        val edited = original.replace("brown fox jumps", "brown box jumps")
        val r = findTextQuoteRange(q, edited)!!
        assertEquals("brown box jumps", edited.substring(r.first, r.last + 1))
    }

    @Test
    fun rejectsAnUnrelatedPassageBelowTheQualityThreshold() {
        val start = original.indexOf("lazy dog")
        val q = buildTextQuoteAnchor(original, start, start + "lazy dog".length)
        val elsewhere = "Completely different content with no similar words at all here."
        assertNull(findTextQuoteRange(q, elsewhere))
    }

    // --- Task 29 contract smoke (no TS fixture; see class doc) ---------------

    @Test
    fun trimRangeAndMergeOverlappingRangesSemantics() {
        assertEquals(2..12, trimRange("  hello world  ", 0, 15))
        assertEquals(6..7, trimRange("abc   def", 3, 8)) // leading ws only
        assertEquals(IntRange.EMPTY, trimRange("   ", 0, 3))

        assertEquals(
            listOf(0..12, 20..25),
            mergeOverlappingRanges(listOf(5..9, 0..4, 20..25, 8..12)),
        )
        assertEquals(listOf(0..9), mergeOverlappingRanges(listOf(0..4, 5..9))) // adjacent merges
        assertEquals(listOf(0..2), mergeOverlappingRanges(listOf(0..2, IntRange.EMPTY)))
    }
}
