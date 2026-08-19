package com.scholiast.android.data.notes

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Note-string format contract: `text<!--timestamp:N--><!--edited:M-->`, ported
 * from `src/utils/video/video-notes.ts` and `shared/merge.ts`. Round-trips and
 * merge-version semantics are pinned here because every editor/rendering task
 * (06/07/08/13) and the sync merge (17) depend on them.
 */
class VideoNoteTest {

    @Test
    fun `makeVideoNote-parse round-trips`() {
        val note = makeVideoNote("First law of thermodynamics", 1712345678901L)
        assertEquals("First law of thermodynamics<!--timestamp:1712345678901-->", note)

        val parsed = parseVideoNote(note)
        assertEquals("First law of thermodynamics", parsed.text)
        assertEquals(1712345678901L, parsed.timestamp)
        assertNull(parsed.edited)
    }

    @Test
    fun `parse extracts both markers`() {
        val parsed = parseVideoNote(
            "Edited note<!--timestamp:1712345679000--><!--edited:1712345679999-->"
        )
        assertEquals("Edited note", parsed.text)
        assertEquals(1712345679000L, parsed.timestamp)
        assertEquals(1712345679999L, parsed.edited)
    }

    @Test
    fun `parse trims whitespace like the TS port`() {
        val parsed = parseVideoNote("  padded text  <!--timestamp:123--> ")
        assertEquals("padded text", parsed.text)
        assertEquals(123L, parsed.timestamp)
    }

    @Test
    fun `parse of a legacy note without markers returns raw text`() {
        val parsed = parseVideoNote("plain legacy comment")
        assertEquals("plain legacy comment", parsed.text)
        assertNull(parsed.timestamp)
        assertNull(parsed.edited)
    }

    @Test
    fun `withEditedMark appends the edited marker and keeps the timestamp id`() {
        val note = makeVideoNote("original", 1712345679000L)
        val edited = withEditedMark(note, 1712345680000L)
        assertEquals(
            "original<!--timestamp:1712345679000--><!--edited:1712345680000-->",
            edited,
        )
        val parsed = parseVideoNote(edited)
        assertEquals("original", parsed.text)
        assertEquals(1712345679000L, parsed.timestamp)
        assertEquals(1712345680000L, parsed.edited)
    }

    @Test
    fun `withEditedMark replaces a previous edited marker (id stays)`() {
        val twice = withEditedMark(
            withEditedMark(makeVideoNote("v2", 1712345679000L), 1712345680000L),
            1712345685000L,
        )
        assertEquals(
            "v2<!--timestamp:1712345679000--><!--edited:1712345685000-->",
            twice,
        )
        // Only one timestamp and one edited marker:
        assertEquals(1, Regex("<!--timestamp:").findAll(twice).count())
        assertEquals(1, Regex("<!--edited:").findAll(twice).count())
    }

    @Test
    fun `withEditedMark on a marker-less note keeps it marker-less on timestamp`() {
        assertEquals(
            "raw text<!--edited:1712345680000-->",
            withEditedMark("raw text", 1712345680000L),
        )
    }

    @Test
    fun `noteId returns the timestamp string, falling back to raw text`() {
        assertEquals("1712345679000", noteId("x<!--timestamp:1712345679000-->"))
        assertEquals("legacy", noteId("legacy"))
    }

    @Test
    fun `noteVersion prefers edited, then timestamp, then zero - merge ts semantics`() {
        assertEquals(
            1712345680000L,
            noteVersion("x<!--timestamp:1712345679000--><!--edited:1712345680000-->"),
        )
        assertEquals(1712345679000L, noteVersion("x<!--timestamp:1712345679000-->"))
        assertEquals(0L, noteVersion("no markers"))
    }
}