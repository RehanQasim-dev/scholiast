package com.scholiast.android.ui.notes

import com.scholiast.android.data.db.LoadedVideoPage
import com.scholiast.android.data.db.VideoPageEntity
import com.scholiast.android.data.model.VideoItem
import com.scholiast.android.data.notes.VideoItemRepository
import com.scholiast.android.data.notes.parseVideoNote
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Notes timeline ViewModel tests (Task 06): ordering, M:SS chip formatting
 * (port of `src/utils/video/video-notes.ts` `formatVideoTime`), and CRUD
 * against a fake [VideoItemRepository]. All VM mutations are suspend and update
 * state in the calling coroutine, so plain `runBlocking` is deterministic —
 * no Main dispatcher / coroutines-test dependency required.
 */
class NotesViewModelTest {

    private companion object {
        val url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    }

    // ---- ordering -----------------------------------------------------------

    @Test
    fun `items are presented in video-time order ascending regardless of repo order`() = runBlocking {
        val repo = FakeVideoItemRepository()
        repo.seed(
            item("note-c", "note", 95.0),
            item("note-a", "note", 12.0),
            item("transcript-b", "transcript", 45.0, quote = "Second law", color = "red"),
        )
        val vm = NotesViewModel(repo, url)
        vm.load()

        assertEquals(listOf("note-a", "transcript-b", "note-c"), vm.state.value.items.map { it.id })
        assertEquals(12.0, vm.state.value.items[0].videoTime, 0.0)
    }

    @Test
    fun `equal video times keep repository order (stable sort)`() = runBlocking {
        val repo = FakeVideoItemRepository()
        repo.seed(item("first", "note", 10.0), item("second", "note", 10.0))
        val vm = NotesViewModel(repo, url)
        vm.load()

        assertEquals(listOf("first", "second"), vm.state.value.items.map { it.id })
    }

    @Test
    fun `load with no page leaves state empty`() = runBlocking {
        val vm = NotesViewModel(FakeVideoItemRepository(), url)
        vm.load()
        assertEquals(emptyList<VideoItem>(), vm.state.value.items)
    }

    // ---- chip formatting (formatVideoTime port) ------------------------------

    @Test
    fun `formatVideoTime renders M-SS and H-MM-SS like the desktop port`() {
        assertEquals("0:00", formatVideoTime(0.0))
        assertEquals("0:59", formatVideoTime(59.0))
        assertEquals("1:05", formatVideoTime(65.0))
        assertEquals("59:59", formatVideoTime(3599.0))
        assertEquals("1:00:00", formatVideoTime(3600.0))
        assertEquals("1:01:01", formatVideoTime(3661.5))
        assertEquals("12:34:56", formatVideoTime(45296.0))
    }

    @Test
    fun `formatVideoTime clamps negatives to 0 like Math max 0 floor`() {
        assertEquals("0:00", formatVideoTime(-3.0))
        assertEquals("0:00", formatVideoTime(-0.1))
    }

    @Test
    fun `formatVideoTime floors fractional seconds before formatting`() {
        assertEquals("1:30", formatVideoTime(90.9))
        assertEquals("0:05", formatVideoTime(5.499))
    }

    // ---- CRUD ----------------------------------------------------------------

    @Test
    fun `addNote creates a kind-note item at the given time with a stamped comment`() = runBlocking {
        val repo = FakeVideoItemRepository()
        val vm = NotesViewModel(repo, url)
        vm.load()

        val stored = vm.addNote("First law of thermodynamics", 83.5)

        assertEquals("note", stored.kind)
        assertEquals(83.5, stored.videoTime, 0.0)
        assertEquals(1, stored.notes.size)
        val parsed = parseVideoNote(stored.notes[0])
        assertEquals("First law of thermodynamics", parsed.text)
        assertNotNull("comment must carry its timestamp id", parsed.timestamp)
        assertEquals(stored, repo.storedItem(stored.id))
        assertEquals(stored, vm.state.value.items.single())
    }

    @Test
    fun `addNote trims the text`() = runBlocking {
        val vm = NotesViewModel(FakeVideoItemRepository(), url)
        val stored = vm.addNote("  padded  ", 10.0)
        assertEquals("padded", parseVideoNote(stored.notes.single()).text)
    }

    @Test
    fun `addReply appends a comment to an existing item's thread`() = runBlocking {
        val repo = FakeVideoItemRepository()
        repo.seed(item("n1", "note", 10.0))
        val vm = NotesViewModel(repo, url)
        vm.load()

        assertTrue(vm.addReply("n1", "Follow-up question"))
        assertTrue(vm.addReply("n1", "Second reply"))

        val stored = vm.state.value.items.single()
        assertEquals(2, stored.notes.size)
        assertEquals("Follow-up question", parseVideoNote(stored.notes[0]).text)
        assertEquals("Second reply", parseVideoNote(stored.notes[1]).text)
        assertTrue(stored.notes[1].contains("<!--timestamp:"))
        assertEquals(stored, repo.storedItem("n1"))
    }

    @Test
    fun `addReply on an unknown item returns false`() = runBlocking {
        val vm = NotesViewModel(FakeVideoItemRepository(), url)
        assertFalse(vm.addReply("missing", "hi"))
    }

    @Test
    fun `addNote sorts the new item into video-time position`() = runBlocking {
        val repo = FakeVideoItemRepository()
        repo.seed(item("t10", "note", 10.0), item("t30", "note", 30.0))
        val vm = NotesViewModel(repo, url)
        vm.load()

        val added = vm.addNote("middle", 20.0)

        assertEquals(listOf("t10", added.id, "t30"), vm.state.value.items.map { it.id })
        assertEquals(20.0, vm.state.value.items[1].videoTime, 0.0)
    }

    @Test
    fun `updateItem replaces the item in state and repository`() = runBlocking {
        val repo = FakeVideoItemRepository()
        repo.seed(item("n1", "note", 10.0, notes = listOf("old<!--timestamp:1-->")))
        val vm = NotesViewModel(repo, url)
        vm.load()

        val edited = vm.state.value.items.single().copy(
            notes = listOf("new text<!--timestamp:1--><!--edited:2-->"),
        )
        val stored = vm.updateItem(edited)

        assertNotNull(stored)
        assertEquals("new text", parseVideoNote(stored!!.notes[0]).text)
        assertEquals("new text", parseVideoNote(vm.state.value.items.single().notes[0]).text)
        assertEquals(2L, parseVideoNote(repo.storedItem("n1")!!.notes[0]).edited)
    }

    @Test
    fun `updateItem on a page without the item returns null and leaves state`() = runBlocking {
        val repo = FakeVideoItemRepository()
        repo.seed(item("n1", "note", 10.0))
        val vm = NotesViewModel(repo, url)
        vm.load()

        assertNull(vm.updateItem(item("ghost", "note", 99.0)))
        assertEquals(listOf("n1"), vm.state.value.items.map { it.id })
    }

    // ---- delete with undo -----------------------------------------------------

    @Test
    fun `deleteItem snapshots first, removes from state and repo, enables undo`() = runBlocking {
        val repo = FakeVideoItemRepository()
        repo.seed(item("a", "note", 10.0), item("b", "note", 20.0))
        val vm = NotesViewModel(repo, url)
        vm.load()

        val deleted = vm.deleteItem("a")

        assertEquals("a", deleted?.id)
        assertEquals(listOf("b"), vm.state.value.items.map { it.id })
        assertTrue(vm.state.value.canUndoDelete)
        assertNull(repo.storedItem("a"))
        assertNotNull(repo.storedItem("b"))
    }

    @Test
    fun `deleteItem of an unknown item returns null and does not enable undo`() = runBlocking {
        val vm = NotesViewModel(FakeVideoItemRepository(), url)
        assertNull(vm.deleteItem("missing"))
        assertFalse(vm.state.value.canUndoDelete)
    }

    @Test
    fun `undoDelete restores the whole page snapshot`() = runBlocking {
        val repo = FakeVideoItemRepository()
        repo.seed(item("a", "note", 10.0), item("b", "note", 20.0))
        val vm = NotesViewModel(repo, url)
        vm.load()

        vm.deleteItem("a")
        assertFalse(vm.state.value.items.any { it.id == "a" })
        vm.undoDelete()

        assertEquals(listOf("a", "b"), vm.state.value.items.map { it.id })
        assertNotNull(repo.storedItem("a"))
        assertFalse(vm.state.value.canUndoDelete)
    }

    @Test
    fun `undoDelete restores the page even when the delete emptied it`() = runBlocking {
        val repo = FakeVideoItemRepository()
        repo.seed(item("only", "note", 10.0))
        val vm = NotesViewModel(repo, url)
        vm.load()

        vm.deleteItem("only")
        assertEquals(emptyList<VideoItem>(), vm.state.value.items)
        vm.undoDelete()

        assertEquals(listOf("only"), vm.state.value.items.map { it.id })
        assertNotNull(repo.storedItem("only"))
    }

    @Test
    fun `undoDelete restores the deleted item's comment thread intact`() = runBlocking {
        val repo = FakeVideoItemRepository()
        repo.seed(
            item(
                "threaded",
                "note",
                10.0,
                notes = listOf(
                    "op<!--timestamp:1-->",
                    "reply<!--timestamp:2-->",
                ),
            ),
        )
        val vm = NotesViewModel(repo, url)
        vm.load()

        vm.deleteItem("threaded")
        vm.undoDelete()

        val restored = repo.storedItem("threaded")
        assertNotNull(restored)
        assertEquals(2, restored!!.notes.size)
        assertEquals("reply", parseVideoNote(restored.notes[1]).text)
        assertTrue(restored.notes[1].contains("<!--timestamp:2-->"))
    }

    @Test
    fun `a second delete replaces the undo snapshot`() = runBlocking {
        val repo = FakeVideoItemRepository()
        repo.seed(item("a", "note", 10.0), item("b", "note", 20.0), item("c", "note", 30.0))
        val vm = NotesViewModel(repo, url)
        vm.load()

        vm.deleteItem("a")
        vm.deleteItem("b")
        vm.undoDelete()

        // Snapshot was taken at the SECOND delete (page held b and c then), so
        // undo restores b and c — a stays deleted.
        assertEquals(listOf("b", "c"), vm.state.value.items.map { it.id })
        assertNotNull(repo.storedItem("b"))
        assertNotNull(repo.storedItem("c"))
        assertNull(repo.storedItem("a"))
    }

    @Test
    fun `undoDelete without a prior delete is a no-op`() = runBlocking {
        val vm = NotesViewModel(FakeVideoItemRepository(), url)
        vm.undoDelete()
        assertEquals(emptyList<VideoItem>(), vm.state.value.items)
    }

    // ---- hooks ----------------------------------------------------------------

    @Test
    fun `delete of a frame item invokes the frame-file delete hook`() = runBlocking {
        val repo = FakeVideoItemRepository()
        repo.seed(item("f1", "frame", 30.0))
        val vm = NotesViewModel(repo, url)
        val deletedIds = mutableListOf<String>()
        vm.frameFileDeleteHook = FrameFileDeleteHook { deletedIds.add(it) }
        vm.load()

        vm.deleteItem("f1")

        assertEquals(listOf("f1"), deletedIds)
    }

    @Test
    fun `delete of a non-frame item does not invoke the frame-file hook`() = runBlocking {
        val repo = FakeVideoItemRepository()
        repo.seed(item("n1", "note", 30.0), item("t1", "transcript", 31.0, quote = "q"))
        val vm = NotesViewModel(repo, url)
        val deletedIds = mutableListOf<String>()
        vm.frameFileDeleteHook = FrameFileDeleteHook { deletedIds.add(it) }

        vm.deleteItem("n1")
        vm.deleteItem("t1")

        assertEquals(emptyList<String>(), deletedIds)
    }

    @Test
    fun `seekTo forwards to the registered seek listener and clamps nothing`() = runBlocking {
        val repo = FakeVideoItemRepository()
        val vm = NotesViewModel(repo, url)
        val seeks = mutableListOf<Double>()
        vm.seekListener = SeekRequestListener { seeks.add(it) }

        vm.seekTo(125.5)
        vm.seekTo(0.0)

        assertEquals(listOf(125.5, 0.0), seeks)
    }

    @Test
    fun `seekTo with no listener wired is a no-op`() = runBlocking {
        val vm = NotesViewModel(FakeVideoItemRepository(), url)
        vm.seekTo(10.0)
    }

    // ---- genVideoId ------------------------------------------------------------

    @Test
    fun `genVideoId produces unique base36 ids`() {
        val ids = (1..50).map { genVideoId() }
        assertEquals(50, ids.toSet().size)
        ids.forEach { assertTrue("base36-ish id: $it", it.matches(Regex("[0-9a-z]+"))) }
    }

    // ---- fixtures ---------------------------------------------------------------

    private fun item(
        id: String,
        kind: String,
        videoTime: Double,
        notes: List<String> = emptyList(),
        quote: String? = null,
        color: String? = null,
    ) = VideoItem(
        id = id,
        kind = kind,
        videoTime = videoTime,
        notes = notes,
        quote = quote,
        color = color,
    )

    /**
     * In-memory [VideoItemRepository] mirroring the Room repo's contract
     * (replace-by-id + `updatedAt` stamp on add, delete-page-on-empty).
     */
    private class FakeVideoItemRepository : VideoItemRepository {
        val pages = mutableMapOf<String, MutableList<VideoItem>>()
        private val now = AtomicLong(1_000_000_000_000L)

        fun seed(vararg items: VideoItem) {
            pages.putIfAbsent(url, mutableListOf())
            pages.getValue(url).addAll(items)
        }

        fun storedItem(id: String): VideoItem? = pages[url]?.firstOrNull { it.id == id }

        override suspend fun upsertPage(
            pageUrl: String,
            videoId: String?,
            title: String?,
        ): VideoPageEntity {
            pages.putIfAbsent(pageUrl, mutableListOf())
            return pageEntity(pageUrl)
        }

        override suspend fun loadPage(pageUrl: String): LoadedVideoPage? {
            val items = pages[pageUrl] ?: return null
            return LoadedVideoPage(
                urlHash = pageUrl,
                url = pageUrl,
                videoId = null,
                title = null,
                items = items,
                updatedAt = 0L,
                snap = null,
                fileId = null,
                headRevisionId = null,
            )
        }

        override suspend fun listRecentPages(limit: Int): List<VideoPageEntity> =
            pages.keys.map(::pageEntity)

        override suspend fun listAllPages(): List<VideoPageEntity> = listRecentPages()

        override suspend fun addItem(pageUrl: String, item: VideoItem): VideoItem {
            val stamped = item.copy(updatedAt = now.incrementAndGet())
            val items = pages.getOrPut(pageUrl) { mutableListOf() }
            val idx = items.indexOfFirst { it.id == stamped.id }
            if (idx >= 0) items[idx] = stamped else items.add(stamped)
            items.sortBy { it.videoTime }
            return stamped
        }

        override suspend fun updateItem(pageUrl: String, item: VideoItem): VideoItem? {
            val items = pages[pageUrl] ?: return null
            val idx = items.indexOfFirst { it.id == item.id }
            if (idx < 0) return null
            val stamped = item.copy(updatedAt = now.incrementAndGet())
            items[idx] = stamped
            return stamped
        }

        override suspend fun deleteItem(pageUrl: String, itemId: String): Boolean {
            val items = pages[pageUrl] ?: return false
            val removed = items.removeAll { it.id == itemId }
            if (items.isEmpty()) pages.remove(pageUrl)
            return removed
        }

        override suspend fun deletePage(pageUrl: String) {
            pages.remove(pageUrl)
        }

        private fun pageEntity(pageUrl: String) = VideoPageEntity(
            urlHash = pageUrl,
            url = pageUrl,
            videoId = null,
            title = null,
            itemsJson = "[]",
            updatedAt = 0L,
            snapJson = null,
            fileId = null,
            headRevisionId = null,
        )
    }
}
