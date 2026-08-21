package com.scholiast.android.ui.reader

import com.scholiast.android.data.model.LinearBlock
import com.scholiast.android.data.model.PageHighlight
import com.scholiast.android.data.notes.noteId
import com.scholiast.android.data.notes.noteVersion
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pins exactly the four behaviors Task 32 mounts (plan §5.5): reply formats
 * (`<!--timestamp:N-->` / `<!--edited:M-->`), whole-thread delete gating at
 * ≥2 replies, recolor propagation across `extras.groupId` pieces, and the
 * undo snapshot round-trip. Minimal by design.
 */
class HighlightActionsControllerTest {

    private val blocks = listOf(
        LinearBlock(kind = "p", text = "The quick brown fox jumps over the lazy dog."),
        LinearBlock(kind = "p", text = "Second paragraph carries its own words here."),
    )
    private val t = 1_787_346_000_000L

    /** Two grouped yellow pieces (one selection across both blocks). */
    private fun grouped(): List<PageHighlight> {
        val s0 = blocks[0].text.indexOf("brown")
        val s1 = blocks[1].text.indexOf("own words")
        return HighlightController.create(
            blocks,
            listOf(
                HighlightController.BlockSelection(0, s0..s0 + "brown fox".length),
                HighlightController.BlockSelection(1, s1..s1 + "own words".length),
            ),
            "yellow",
            { t },
        )
    }

    // --- 1. reply add/edit/delete formats ------------------------------------

    @Test
    fun replyAddEditDeleteFormats() {
        var hls = grouped()
        val gid = HighlightController.groupIdOf(hls[0])!!

        // Add → "text<!--timestamp:N-->" on the representative, stamped.
        hls = HighlightActionsController.addReply(hls, gid, "nice catch", { t + 10 })
        val owner = HighlightActionsController.ownerOf(hls, gid)!!
        assertEquals(listOf("nice catch<!--timestamp:${t + 10}-->"), owner.notes)
        assertEquals(t + 10, owner.updatedAt)
        assertEquals(t + 10, noteId(owner.notes!![0]).toLong())

        // Edit → new text keeps the ORIGINAL timestamp id + gains <!--edited:M-->.
        hls = HighlightActionsController.editReply(hls, gid, 0, "revised thought", { t + 20 })
        val edited = HighlightActionsController.ownerOf(hls, gid)!!.notes!![0]
        assertEquals("revised thought<!--timestamp:${t + 10}--><!--edited:${t + 20}-->", edited)
        assertEquals(t + 10, noteId(edited).toLong())
        assertEquals(t + 20, noteVersion(edited))

        // Delete → entry gone; empty thread stores notes = null.
        hls = HighlightActionsController.deleteReply(hls, gid, 0, { t + 30 })
        assertTrue(HighlightActionsController.ownerOf(hls, gid)!!.notes.isNullOrEmpty())
    }

    // --- 2. whole-thread delete gating ----------------------------------------

    @Test
    fun threadDeleteGating() {
        var hls = grouped()
        val gid = HighlightController.groupIdOf(hls[0])!!

        // 0 replies → blocked, list unchanged.
        val zero = HighlightActionsController.deleteThread(hls, gid)
        assertTrue(zero is HighlightActionsController.ThreadDeleteResult.Blocked)
        assertEquals(HighlightActionsController.DeleteBlockReason.TOO_FEW_REPLIES, (zero as HighlightActionsController.ThreadDeleteResult.Blocked).reason)
        assertEquals(hls, zero.highlights)

        // 1 reply → still gated (deleting that reply IS deleting the thread).
        hls = HighlightActionsController.addReply(hls, gid, "only one", { t + 1 })
        val one = HighlightActionsController.deleteThread(hls, gid)
        assertTrue(one is HighlightActionsController.ThreadDeleteResult.Blocked)
        assertEquals(hls, (one as HighlightActionsController.ThreadDeleteResult.Blocked).highlights)

        // 2 replies → every piece of the group goes.
        hls = HighlightActionsController.addReply(hls, gid, "and two", { t + 2 })
        val two = HighlightActionsController.deleteThread(hls, gid)
        assertTrue(two is HighlightActionsController.ThreadDeleteResult.Deleted)
        assertTrue((two as HighlightActionsController.ThreadDeleteResult.Deleted).highlights.isEmpty())
    }

    // --- 3. recolor propagates across groupId pieces ---------------------------

    @Test
    fun recolorAcrossGroupPieces() {
        val groupedHls = grouped()
        val gid = HighlightController.groupIdOf(groupedHls[0])!!
        // An ungrouped bystander must stay untouched.
        val s = blocks[0].text.indexOf("lazy")
        val standalone = HighlightController.create(
            blocks,
            listOf(HighlightController.BlockSelection(0, s..s + "lazy dog".length)),
            "green",
            { t + 100 },
            existing = groupedHls,
        )

        val out = HighlightActionsController.recolor(standalone, gid, "red", { t + 5 })

        val members = out.filter { HighlightController.groupIdOf(it) == gid }
        assertEquals(2, members.size)
        assertTrue(members.all { it.color == "red" && it.updatedAt == t + 5 })
        val bystander = out.single { it.id !in groupedHls.map { g -> g.id } }
        assertEquals("green", bystander.color)
        assertEquals(t + 100, bystander.updatedAt)
    }

    // --- 4. undo payload round-trip --------------------------------------------

    @Test
    fun undoRoundTrip() {
        var hls = grouped()
        val gid = HighlightController.groupIdOf(hls[0])!!
        hls = HighlightActionsController.addReply(hls, gid, "first", { t + 1 })
        hls = HighlightActionsController.addReply(hls, gid, "second", { t + 2 })

        val snapshot = HighlightActionsController.snapshotForUndo(hls, gid)
        assertNotNull(snapshot)

        val after = HighlightActionsController.deleteThread(hls, gid)
        assertTrue(after is HighlightActionsController.ThreadDeleteResult.Deleted)

        val restored = HighlightActionsController.restore(snapshot!!)
        assertEquals(hls, restored)
        assertNull(HighlightActionsController.snapshotForUndo(hls, "no-such-thread"))
    }
}
