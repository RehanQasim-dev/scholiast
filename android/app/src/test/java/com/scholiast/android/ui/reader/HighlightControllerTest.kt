package com.scholiast.android.ui.reader

import com.scholiast.android.data.model.LinearBlock
import com.scholiast.android.data.model.PageHighlight
import com.scholiast.android.domain.reader.buildTextQuoteAnchor
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pins the four behaviors downstream tasks depend on (plan §4.2): created
 * highlight shape (anchor + hint riding in extras), multi-block grouping,
 * same-color overlap merging, and the painter's hint-miss → quote-anchor
 * fallback. Nothing else — minimal by design.
 */
class HighlightControllerTest {

    private val blocks = listOf(
        LinearBlock(kind = "p", text = "The quick brown fox jumps over the lazy dog."),
        LinearBlock(kind = "p", text = "Second paragraph carries its own words here."),
    )
    private val t = 1_787_346_000_000L
    private val now = { t }

    // --- 1. creation shape vs plan §4.2 --------------------------------------

    @Test
    fun creationMatchesPlanShape() {
        val text = blocks[0].text
        val start = text.indexOf("brown fox")
        // Deliberately sloppy bounds: trailing whitespace must be trimmed away.
        val sel = listOf(HighlightController.BlockSelection(0, start..start + "brown fox ".length - 1))

        val out = HighlightController.create(blocks, sel, "yellow", now)

        assertEquals(1, out.size)
        val hl = out[0]
        assertEquals(t.toString(), hl.id) // epoch-ms string
        assertEquals("yellow", hl.color)
        assertEquals(t, hl.updatedAt)
        assertNull(HighlightController.groupIdOf(hl)) // single block ⇒ ungrouped

        val extras = hl.extras
        assertEquals("text", extras["type"]!!.jsonPrimitive.content)
        assertEquals("brown fox", extras["content"]!!.jsonPrimitive.content)

        val anchor = extras["anchor"] as JsonObject
        assertEquals("brown fox", anchor["quote"]!!.jsonPrimitive.content)
        assertTrue(anchor["prefix"]!!.jsonPrimitive.content.endsWith("quick "))
        assertTrue(anchor["suffix"]!!.jsonPrimitive.content.startsWith(" jumps"))
        assertEquals(0, anchor["occurrence"]!!.jsonPrimitive.content.toInt())
        assertEquals("web", anchor["surface"]!!.jsonPrimitive.content)

        val hint = extras["hint"] as JsonObject
        assertEquals(0, hint["block"]!!.jsonPrimitive.content.toInt())
        assertEquals(start, hint["start"]!!.jsonPrimitive.content.toInt())
        assertEquals(start + "brown fox".length, hint["end"]!!.jsonPrimitive.content.toInt()) // exclusive

        // The canonical anchor resolves back to the same spot in the block.
        val rebuilt = buildTextQuoteAnchor(text, start, start + "brown fox".length)
        assertEquals(rebuilt, HighlightController.anchorOf(hl))
    }

    // --- 2. grouping across blocks -------------------------------------------

    @Test
    fun multiBlockSelectionGroupsAndGroupOpsWork() {
        val s0 = blocks[0].text.indexOf("brown")
        val s1 = blocks[1].text.indexOf("own words")
        val sel = listOf(
            HighlightController.BlockSelection(0, s0..s0 + "brown fox".length),
            HighlightController.BlockSelection(1, s1..s1 + "own words".length),
        )

        val out = HighlightController.create(blocks, sel, "green", now)
        assertEquals(2, out.size)
        val g = HighlightController.groupIdOf(out[0])
        assertNotNull(g)
        assertEquals(g, HighlightController.groupIdOf(out[1]))
        assertEquals(listOf(t.toString(), (t + 1).toString()), out.map { it.id }) // unique ids
        assertEquals(0, HighlightController.hintOf(out[0])!!.block)
        assertEquals(1, HighlightController.hintOf(out[1])!!.block)

        // Recolor hits every member; delete removes the whole group.
        val recolored = HighlightController.recolor(out, g!!, "red", { t + 5 })
        assertTrue(recolored.all { it.color == "red" && it.updatedAt == t + 5 })
        assertTrue(HighlightController.delete(recolored, g).isEmpty())
    }

    // --- 3. same-color overlap/adjacent merge ---------------------------------

    @Test
    fun overlappingSameColorMergesDifferentColorDoesNot() {
        val text = blocks[0].text
        fun range(word: String) = text.indexOf(word).let { it..it + word.length - 1 }
        val first = HighlightController.create(
            blocks,
            listOf(HighlightController.BlockSelection(0, range("brown fox ju"))),
            "yellow",
            now,
        )
        assertEquals(1, first.size)

        // Overlapping yellow selection absorbs the first piece, keeping its id.
        val merged = HighlightController.create(
            blocks,
            listOf(HighlightController.BlockSelection(0, range("ox jumps"))),
            "yellow",
            { t + 9 },
            existing = first,
        )
        assertEquals(1, merged.size)
        assertEquals(first[0].id, merged[0].id) // oldest survivor keeps identity
        val hint = HighlightController.hintOf(merged[0])!!
        assertEquals(text.indexOf("brown"), hint.start)
        assertEquals(text.indexOf("jumps") + "jumps".length, hint.end) // union span
        assertEquals("brown fox jumps", HighlightController.contentOf(merged[0]))

        // A red overlap must NOT merge into the yellow piece.
        val red = HighlightController.create(
            blocks,
            listOf(HighlightController.BlockSelection(0, range("fox"))),
            "red",
            { t + 10 },
            existing = merged,
        )
        assertEquals(2, red.size)
        assertTrue(red.any { it.color == "yellow" })
        assertTrue(red.any { it.color == "red" })
    }

    // --- 4. hint-miss fallback (painter) ---------------------------------------

    @Test
    fun staleHintFallsBackToQuoteAnchorAndRewritesHint() {
        val text = blocks[0].text
        val start = text.indexOf("lazy dog")
        val anchor = buildTextQuoteAnchor(text, start, start + "lazy dog".length)

        // Hint points at the wrong place (as after a re-extraction shifted offsets).
        val stale = PageHighlight(
            id = "42",
            color = "yellow",
            extras = HighlightController.run {
                kotlinx.serialization.json.buildJsonObject {
                    put("type", kotlinx.serialization.json.JsonPrimitive("text"))
                    put("content", kotlinx.serialization.json.JsonPrimitive(anchor.quote))
                    put("anchor", anchorJson(anchor))
                    put("hint", hintJson(HighlightController.Hint(0, 0, 4))) // "The " — wrong span
                }
            },
        )

        val (hits, rehints) = HighlightPainter.resolve(0, blocks[0], listOf(stale))
        assertEquals(1, hits.size)
        assertEquals(start, hits[0].start)
        assertEquals(start + "lazy dog".length, hits[0].endExclusive)
        assertEquals(listOf(Rehint("42", HighlightController.Hint(0, start, start + "lazy dog".length))), rehints)
    }
}
