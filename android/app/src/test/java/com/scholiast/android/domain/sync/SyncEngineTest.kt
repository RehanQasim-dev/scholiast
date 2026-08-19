package com.scholiast.android.domain.sync

import com.scholiast.android.data.model.FrameImage
import com.scholiast.android.data.model.PageTombstones
import com.scholiast.android.data.model.ScholiastJson
import com.scholiast.android.data.model.VideoItem
import com.scholiast.android.data.model.VideoPage
import com.scholiast.android.data.normalize.Normalize
import com.scholiast.android.domain.sync.merge.PageFileName
import com.scholiast.android.ui.frame.FrameStore
import java.nio.file.Files
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The reconcile loop against an in-memory fake Drive: targeted push, full
 * reconcile with the in-sync skip, 3-way merge outcomes (both devices'
 * comments kept, tombstones honored/resurrected), frame blob upload/pull, the
 * 412 → pull → merge → re-PUT path, and mid-IO edit pickup.
 */
class SyncEngineTest {

    private val NOW = 1_000_000L

    // --- fakes ---------------------------------------------------------------

    /** In-memory Drive: folders of text files + blob bytes, with a call log. */
    private class FakeDriveApi : DriveApi {
        val calls = mutableListOf<String>()
        val folders = mutableMapOf<DriveFolder, LinkedHashMap<String, DriveFileMeta>>()
        val contents = mutableMapOf<String, String>()
        val blobs = mutableMapOf<String, ByteArray>()
        private val byId = mutableMapOf<String, DriveFileMeta>()
        private var nextId = 0
        private var nextRev = 0

        /**
         * Fired at the START of every updateFile, before the CAS check — used
         * to simulate a remote that moves between our find and our PUT, which
         * is exactly the 412 race. Tests disarm it themselves.
         */
        var updateHook: (() -> Unit)? = null

        /** Fired on every createTextFile. */
        var createHook: ((DriveFolder, String) -> Unit)? = null

        private fun nextMeta(name: String): DriveFileMeta {
            val meta = DriveFileMeta(id = "f${nextId++}", name = name, headRevisionId = "r${nextRev++}")
            byId[meta.id] = meta
            return meta
        }

        fun seedRemote(folder: DriveFolder, name: String, content: String): DriveFileMeta {
            val meta = nextMeta(name)
            folders.getOrPut(folder) { LinkedHashMap() }[name] = meta
            contents[meta.id] = content
            return meta
        }

        /** Simulate another device's write: bump the revision, swap the content. */
        fun remoteWrite(folder: DriveFolder, name: String, content: String) {
            val current = folders[folder]?.get(name) ?: return
            val meta = current.copy(headRevisionId = "r${nextRev++}")
            byId[meta.id] = meta
            folders[folder]!![name] = meta
            contents[meta.id] = content
        }

        override suspend fun listFolder(folder: DriveFolder, pageToken: String?): DriveFilePage {
            calls.add("list:${folder.path}")
            return DriveFilePage(folders[folder]?.values?.toList() ?: emptyList())
        }

        override suspend fun findInFolder(folder: DriveFolder, fileName: String): DriveFileMeta? {
            calls.add("find:${folder.path}:$fileName")
            return folders[folder]?.get(fileName)
        }

        override suspend fun createTextFile(folder: DriveFolder, fileName: String, content: String): DriveFileMeta {
            calls.add("create:${folder.path}:$fileName")
            val meta = nextMeta(fileName)
            folders.getOrPut(folder) { LinkedHashMap() }[fileName] = meta
            contents[meta.id] = content
            createHook?.invoke(folder, fileName)
            return meta
        }

        override suspend fun updateFile(fileId: String, content: String, ifMatchRevision: String?): DriveFileMeta {
            calls.add("update:$fileId")
            updateHook?.invoke()
            val current = byId[fileId] ?: error("update of unknown file $fileId")
            if (ifMatchRevision != null && current.headRevisionId != ifMatchRevision) {
                throw SyncConflictException("CAS conflict on $fileId (have ${current.headRevisionId}, expected $ifMatchRevision)")
            }
            val meta = current.copy(headRevisionId = "r${nextRev++}")
            byId[fileId] = meta
            contents[fileId] = content
            val entry = folders.entries.first { it.value.containsKey(current.name) }
            entry.value[current.name!!] = meta
            return meta
        }

        override suspend fun downloadText(fileId: String): String {
            calls.add("download:$fileId")
            return contents[fileId] ?: error("no content for $fileId")
        }

        override suspend fun uploadBlob(folder: DriveFolder, fileName: String, bytes: ByteArray, mimeType: String): DriveFileMeta {
            calls.add("upload:${folder.path}:$fileName")
            val meta = nextMeta(fileName)
            folders.getOrPut(folder) { LinkedHashMap() }[fileName] = meta
            blobs[meta.id] = bytes
            return meta
        }

        override suspend fun downloadBlob(fileId: String): ByteArray {
            calls.add("blobget:$fileId")
            return blobs[fileId] ?: error("no blob for $fileId")
        }

        override suspend fun deleteFile(fileId: String) {
            calls.add("delete:$fileId")
        }

        override suspend fun wipeAppData(): Int = 0
    }

    /** In-memory PageStore keyed by normalized url. */
    private class FakePageStore : PageStore {
        val pages = mutableMapOf<String, PageSnapshot>()

        override suspend fun load(url: String): PageSnapshot {
            val key = Normalize.normalizeUrl(url)
            return pages[key] ?: PageSnapshot(key, null, null, emptyList(), null, null, null)
        }

        override suspend fun listAllUrls(): List<String> = pages.keys.toList()

        override suspend fun saveReconciled(url: String, merged: VideoPage, outMeta: DriveFileMeta) {
            val key = Normalize.normalizeUrl(url)
            pages[key] = PageSnapshot(
                url = key,
                videoId = merged.videoId,
                title = merged.title,
                items = merged.videoItems,
                snap = merged,
                fileId = outMeta.id,
                headRevisionId = outMeta.headRevisionId,
            )
        }
    }

    // --- builders --------------------------------------------------------------

    private fun item(
        id: String,
        updatedAt: Long,
        notes: List<String> = emptyList(),
        frame: FrameImage? = null,
    ): VideoItem = VideoItem(
        id = id,
        kind = if (frame != null) "frame" else "note",
        videoTime = 0.0,
        frame = frame,
        notes = notes,
        updatedAt = updatedAt,
    )

    private fun note(text: String, ts: Long, edited: Long? = null): String =
        "$text<!--timestamp:$ts-->" + (edited?.let { "<!--edited:$it-->" } ?: "")

    private fun record(
        url: String,
        items: List<VideoItem> = emptyList(),
        title: String? = null,
        videoId: String? = null,
        tombstones: PageTombstones = PageTombstones(),
    ): VideoPage = VideoPage(
        version = 2,
        url = url,
        title = title,
        videoId = videoId,
        videoItems = items,
        tombstones = tombstones,
    )

    private fun engine(
        drive: DriveApi,
        store: FakePageStore,
        frames: FrameStore = frameStore(),
        now: Long = NOW,
    ): SyncEngine = SyncEngine(drive = drive, pageStore = store, frameStore = frames, now = { now })

    private fun frameStore(): FrameStore =
        FrameStore(Files.createTempDirectory("scholiast-frames").toFile())

    // --- tests -----------------------------------------------------------------

    @Test
    fun `targeted push reconciles only the changed page`() = runBlocking {
        val drive = FakeDriveApi()
        val store = FakePageStore()
        val engine = engine(drive, store)

        val url1 = "https://youtube.com/watch?v=aaa"
        val url2 = "https://youtube.com/watch?v=bbb"
        val key1 = Normalize.normalizeUrl(url1)
        val key2 = Normalize.normalizeUrl(url2)
        store.pages[key1] = PageSnapshot(key1, "aaa", "A", listOf(item("v1", 10)), null, null, null)
        store.pages[key2] = PageSnapshot(key2, "bbb", "B", listOf(item("v2", 10)), null, null, null)

        val result = engine.syncChanged(listOf(url1))

        assertTrue(result.ok)
        assertEquals(1, result.reconciled)
        val name1 = PageFileName.of(key1)
        val name2 = PageFileName.of(key2)
        assertTrue("url1 uploaded: ${drive.calls}", drive.calls.any { it == "create:pages:$name1" })
        assertTrue("url2 untouched: ${drive.calls}", drive.calls.none { it.contains(name2) })
        val page1 = store.pages[key1]!!
        assertNotNull(page1.snap)
        assertNotNull(page1.fileId)
        assertNotNull(page1.headRevisionId)
        assertEquals(listOf("v1"), page1.items.map { it.id })
        assertNull("url2 must keep its pre-sync state", store.pages[key2]!!.fileId)
    }

    @Test
    fun `unchanged page is skipped with zero network during full reconcile`() = runBlocking {
        val drive = FakeDriveApi()
        val store = FakePageStore()
        val engine = engine(drive, store)

        val key1 = Normalize.normalizeUrl("https://youtube.com/watch?v=aaa")
        val v1 = item("v1", 10)
        val rec = record(key1, listOf(v1), title = "A", videoId = "aaa")
        val meta = drive.seedRemote(DriveFolder.PAGES, PageFileName.of(key1), ScholiastJson.encode(rec))
        store.pages[key1] = PageSnapshot(key1, "aaa", "A", listOf(v1), rec, meta.id, meta.headRevisionId)

        val key2 = Normalize.normalizeUrl("https://youtube.com/watch?v=bbb")
        store.pages[key2] = PageSnapshot(key2, "bbb", "B", listOf(item("v2", 5)), null, null, null)

        val result = engine.syncAll()

        assertEquals(1, result.skipped)
        assertEquals(1, result.reconciled)
        assertTrue(result.ok)
        // The in-sync page cost exactly zero targeted network: no find/download
        // for its file name or id — only the shared folder listing happened.
        assertTrue(
            "no network for the in-sync page: ${drive.calls}",
            drive.calls.none { it.contains(PageFileName.of(key1)) || it.contains(meta.id) },
        )
        val reconciled = store.pages[key2]!!
        assertNotNull(reconciled.snap)
        assertNotNull(reconciled.fileId)
    }

    @Test
    fun `merge keeps comments from both devices on the same item`() = runBlocking {
        val drive = FakeDriveApi()
        val store = FakePageStore()
        val engine = engine(drive, store)

        val key = Normalize.normalizeUrl("https://youtube.com/watch?v=aaa")
        val base = record(key, listOf(item("v1", 10, listOf(note("base", 100)))), title = "A", videoId = "aaa")
        store.pages[key] = PageSnapshot(
            key, "aaa", "A",
            listOf(item("v1", 30, listOf(note("base", 100), note("from-local", 200)))),
            base, null, null,
        )
        drive.seedRemote(
            DriveFolder.PAGES, PageFileName.of(key),
            ScholiastJson.encode(
                record(
                    key,
                    listOf(item("v1", 20, listOf(note("base", 100), note("from-remote", 300)))),
                    title = "A", videoId = "aaa",
                ),
            ),
        )

        val result = engine.syncChanged(listOf(key))
        assertTrue(result.ok)

        val stored = store.pages[key]!!.items.single()
        val texts = stored.notes.joinToString("|")
        assertTrue("base comment kept: $texts", texts.contains("base"))
        assertTrue("local comment kept: $texts", texts.contains("from-local"))
        assertTrue("remote comment kept: $texts", texts.contains("from-remote"))

        val meta = drive.folders[DriveFolder.PAGES]!!.values.single()
        val uploaded = drive.contents[meta.id]!!
        assertTrue("uploaded record carries local comment: $uploaded", uploaded.contains("from-local"))
        assertTrue("uploaded record carries remote comment: $uploaded", uploaded.contains("from-remote"))
        assertTrue("was an update, not a create: ${drive.calls}", drive.calls.any { it.startsWith("update:") })
    }

    @Test
    fun `a remote tombstone prevents a stale local copy from resurrecting`() = runBlocking {
        val drive = FakeDriveApi()
        val store = FakePageStore()
        val engine = engine(drive, store)

        val key = Normalize.normalizeUrl("https://youtube.com/watch?v=aaa")
        val base = record(key, listOf(item("v1", 10)))
        store.pages[key] = PageSnapshot(key, null, null, listOf(item("v1", 10)), base, null, null)
        drive.seedRemote(
            DriveFolder.PAGES, PageFileName.of(key),
            ScholiastJson.encode(record(key, emptyList(), tombstones = PageTombstones(videoItems = mapOf("v1" to 500_000L)))),
        )

        val result = engine.syncChanged(listOf(key))
        assertTrue(result.ok)
        val page = store.pages[key]!!
        assertTrue("stale copy must not resurrect", page.items.isEmpty())
        assertEquals(500_000L, page.snap!!.tombstones.videoItems["v1"])

        // A re-sync against the same remote state stays deleted.
        val result2 = engine.syncChanged(listOf(key))
        assertTrue(result2.ok)
        assertTrue(store.pages[key]!!.items.isEmpty())
    }

    @Test
    fun `re-adding an item locally after a remote delete resurrects it`() = runBlocking {
        val drive = FakeDriveApi()
        val store = FakePageStore()
        val engine = engine(drive, store)

        val key = Normalize.normalizeUrl("https://youtube.com/watch?v=aaa")
        store.pages[key] = PageSnapshot(key, null, null, listOf(item("v1", 600_000)), null, null, null)
        drive.seedRemote(
            DriveFolder.PAGES, PageFileName.of(key),
            ScholiastJson.encode(record(key, emptyList(), tombstones = PageTombstones(videoItems = mapOf("v1" to 500_000L)))),
        )

        val result = engine.syncChanged(listOf(key))
        assertTrue(result.ok)

        val page = store.pages[key]!!
        assertEquals(listOf("v1"), page.items.map { it.id })
        assertNull("tombstone cleared on resurrection", page.snap!!.tombstones.videoItems["v1"])
    }

    @Test
    fun `frame blob is uploaded only when the item lacks a driveId`() = runBlocking {
        val drive = FakeDriveApi()
        val store = FakePageStore()
        val frames = frameStore()
        val engine = engine(drive, store, frames)

        val key = Normalize.normalizeUrl("https://youtube.com/watch?v=aaa")
        frames.save("v1", byteArrayOf(0x01, 0x02, 0x03))
        store.pages[key] = PageSnapshot(
            key, null, null,
            listOf(item("v1", 10, frame = FrameImage(dataUrl = null, driveId = null, w = 640, h = 360))),
            null, null, null,
        )

        val result = engine.syncChanged(listOf(key))
        assertTrue(result.ok)

        val uploads = drive.calls.filter { it.startsWith("upload:frames:") }
        assertEquals("exactly one upload: ${drive.calls}", 1, uploads.size)
        assertEquals("frame-v1.jpg", uploads.single().removePrefix("upload:frames:"))
        val stored = store.pages[key]!!.items.single()
        assertNotNull("driveId stamped into the stored item", stored.frame?.driveId)
        assertNotNull("driveId stamped into the snapshot too", store.pages[key]!!.snap!!.videoItems.single().frame?.driveId)

        // Second sync: driveId present → nothing re-uploaded.
        drive.calls.clear()
        val result2 = engine.syncChanged(listOf(key))
        assertTrue(result2.ok)
        assertTrue("no frame upload on second sync: ${drive.calls}", drive.calls.none { it.startsWith("upload:") })
    }

    @Test
    fun `a frame blob missing locally is pulled from Drive during merge`() = runBlocking {
        val drive = FakeDriveApi()
        val store = FakePageStore()
        val frames = frameStore()
        val engine = engine(drive, store, frames)

        val key = Normalize.normalizeUrl("https://youtube.com/watch?v=aaa")
        val remoteBytes = byteArrayOf(0x0A, 0x0B)
        val remoteItem = item("v1", 20, frame = FrameImage(dataUrl = null, driveId = "blob-1", w = 640, h = 360))
        drive.seedRemote(DriveFolder.PAGES, PageFileName.of(key), ScholiastJson.encode(record(key, listOf(remoteItem))))
        drive.blobs["blob-1"] = remoteBytes
        store.pages[key] = PageSnapshot(key, null, null, emptyList(), null, null, null)

        val result = engine.syncChanged(listOf(key))
        assertTrue(result.ok)

        assertTrue("frame must be pulled", frames.has("v1"))
        assertArrayEquals(remoteBytes, frames.load("v1"))
        assertEquals(listOf("v1"), store.pages[key]!!.items.map { it.id })
    }

    @Test
    fun `a remote-only page is discovered from the listing and pulled`() = runBlocking {
        val drive = FakeDriveApi()
        val store = FakePageStore()
        val frames = frameStore()
        val engine = engine(drive, store, frames)

        // No local row at all: the file exists only on Drive.
        val key = Normalize.normalizeUrl("https://youtube.com/watch?v=ccc")
        val remoteBytes = byteArrayOf(0x0C)
        val remoteItem = item("v1", 20, frame = FrameImage(dataUrl = null, driveId = "blob-2", w = 640, h = 360))
        drive.seedRemote(DriveFolder.PAGES, PageFileName.of(key), ScholiastJson.encode(record(key, listOf(remoteItem))))
        drive.blobs["blob-2"] = remoteBytes

        val result = engine.syncAll()

        assertEquals(1, result.reconciled)
        assertTrue(result.ok)
        val page = store.pages[key]!!
        assertEquals(listOf("v1"), page.items.map { it.id })
        assertNotNull(page.fileId)
        assertNotNull(page.snap)
        assertTrue(frames.has("v1"))
        assertArrayEquals(remoteBytes, frames.load("v1"))
    }

    @Test
    fun `a CAS conflict re-merges against the fresh remote (412 - pull - merge - re-PUT)`() = runBlocking {
        val drive = FakeDriveApi()
        val store = FakePageStore()
        val engine = engine(drive, store)

        val key = Normalize.normalizeUrl("https://youtube.com/watch?v=aaa")
        val fileName = PageFileName.of(key)
        store.pages[key] = PageSnapshot(key, "aaa", "A", listOf(item("v1", 30, listOf(note("ours", 200)))), null, null, null)
        val remoteRec = record(key, listOf(item("v1", 20, listOf(note("theirs", 300)))), title = "A", videoId = "aaa")
        drive.seedRemote(DriveFolder.PAGES, fileName, ScholiastJson.encode(remoteRec))

        // A second device lands a comment while our first PUT is in flight:
        // the revision moves between find and update, so the CAS write fails
        // with 412 — the engine must pull, re-merge, and re-PUT.
        drive.updateHook = {
            drive.updateHook = null // the remote stabilizes after this one write
            val fresh = record(
                key,
                listOf(item("v1", 20, listOf(note("theirs", 300), note("theirs-2", 400)))),
                title = "A", videoId = "aaa",
            )
            drive.remoteWrite(DriveFolder.PAGES, fileName, ScholiastJson.encode(fresh))
        }

        val result = engine.syncChanged(listOf(key))
        assertTrue("must converge: ${result.errors}", result.ok)

        val metaNow = drive.folders[DriveFolder.PAGES]!![fileName]!!
        val finalContent = drive.contents[metaNow.id]!!
        assertTrue("our comment survives: $finalContent", finalContent.contains("ours"))
        assertTrue("their comment survives: $finalContent", finalContent.contains("theirs"))
        assertTrue("their second comment survives: $finalContent", finalContent.contains("theirs-2"))
        assertTrue("ended as an update, not a create: ${drive.calls}", drive.calls.any { it.startsWith("update:") })
    }

    @Test
    fun `a local edit during network IO is picked up by a re-merge`() = runBlocking {
        val drive = FakeDriveApi()
        val store = FakePageStore()
        val engine = engine(drive, store)

        val key = Normalize.normalizeUrl("https://youtube.com/watch?v=aaa")
        store.pages[key] = PageSnapshot(key, null, null, listOf(item("v1", 10)), null, null, null)

        // The user adds a comment between our file creation and the staleness
        // check — the engine must re-merge so the edit lands.
        drive.createHook = { _, _ ->
            val cur = store.pages[key]!!
            store.pages[key] = cur.copy(items = cur.items.map { it.copy(notes = listOf(note("mid-sync", 500))) })
        }

        val result = engine.syncChanged(listOf(key))
        assertTrue(result.ok)

        val metaNow = drive.folders[DriveFolder.PAGES]!![PageFileName.of(key)]!!
        val finalContent = drive.contents[metaNow.id]!!
        assertTrue("mid-IO edit must land: $finalContent", finalContent.contains("mid-sync"))
        assertEquals(listOf("v1"), store.pages[key]!!.items.map { it.id })
    }

    @Test
    fun `a page that never converges fails with an error, not a hang`() = runBlocking {
        val drive = FakeDriveApi()
        val store = FakePageStore()
        val engine = engine(drive, store)

        val key = Normalize.normalizeUrl("https://youtube.com/watch?v=aaa")
        val fileName = PageFileName.of(key)
        store.pages[key] = PageSnapshot(key, null, null, listOf(item("v1", 10)), null, null, null)
        drive.seedRemote(DriveFolder.PAGES, fileName, ScholiastJson.encode(record(key, emptyList())))

        // A hostile remote that moves its revision on every single PUT attempt.
        drive.updateHook = {
            drive.remoteWrite(DriveFolder.PAGES, fileName, ScholiastJson.encode(record(key, emptyList())))
        }

        val result = engine.syncChanged(listOf(key))

        assertFalse(result.ok)
        assertEquals(0, result.reconciled)
        assertEquals(1, result.errors.size)
        assertTrue(result.errors.single().contains(key))
        // Bounded: 4 attempts × (find + download + fresh find) + the final update.
        val updateAttempts = drive.calls.count { it.startsWith("update:") }
        assertEquals("exactly 4 CAS attempts", 4, updateAttempts)
    }
}