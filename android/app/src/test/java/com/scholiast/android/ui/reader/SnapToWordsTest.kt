package com.scholiast.android.ui.reader

import org.junit.Assert.assertEquals
import org.junit.Test

/** Task 33 C: word-boundary snapping for reader selections (minimal set). */
class SnapToWordsTest {

    @Test
    fun `snaps mid-word endpoints out to full words`() {
        // "alpha beta gamma": raw 7..9 ("et") → "beta".
        assertEquals(6 until 10, snapToWords("alpha beta gamma", 7, 9))
    }

    @Test
    fun `whitespace-only range snaps to empty`() {
        val text = "hello world"
        assertEquals(IntRange.EMPTY, snapToWords(text, 5, 6))
    }

    @Test
    fun `clamps out-of-bounds ends to the whole text`() {
        assertEquals(0 until 5, snapToWords("alpha", -4, 99))
    }

    @Test
    fun `punctuation counts as part of a word`() {
        // "(note)" — only whitespace separates words, so the parens join the
        // token and a grab inside it snaps across the whole thing.
        assertEquals(0 until 6, snapToWords("(note)", 3, 4))
    }
}
