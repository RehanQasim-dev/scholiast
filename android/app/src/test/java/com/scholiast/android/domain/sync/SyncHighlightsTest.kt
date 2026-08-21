package com.scholiast.android.domain.sync

import android.content.Context
import androidx.room.Room
import com.scholiast.android.data.db.AppDatabase
import com.scholiast.android.data.db.VideoPageEntity
import com.scholiast.android.data.model.PageHighlight
import com.scholiast.android.data.model.ScholiastJson
import com.scholiast.android.data.model.VideoPage
import com.scholiast.android.data.normalize.Normalize
import com.scholiast.android.domain.sync.merge.PageFileName
import com.scholiast.android.ui.frame.FrameStore
import java.nio.file.Files
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * Task 27's spine proof: highlights are a REAL locally-owned sync category.
 * Runs [SyncEngine] against an in-memory Room database + [RoomPageStore] +
 * [com.scholiast.android.data.notes.RoomPageHighlightRepository], so every
 * scenario exercises the actual row wiring (`highlightsJson` ↔ snapshot):
 *
 * 1. a locally created highlight is assembled into the push;
 * 2. a local delete (snapshot had it) tombstones it in the merged record —
 *    and is NOT re-seeded from the snapshot by the legacy backfill;
 * 3. a desktop highlight in the snapshot, untouched locally, passes through
 *    byte-identical on repeated reconciles (no tombstone massacre);
 * 4. a desktop edit with a newer `updatedAt` wins over a stale local edit.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SyncHighlightsTest {

    private val NOW = 1_000_000L

    private lateinit var db: AppDatabase
    private lateinit var store: RoomPageStore
    private lateinit var repo: com.scholiast.android.data.notes.RoomPageHighlightRepository
    private lateinit var drive: FakeDriveApi
    private lateinit var engine: SyncEngine

    @Before
    fun setUp() {
        val context: Context = RuntimeEnvironment.getApplication()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        val dao = db.videoPageDao()
        store = RoomPageStore(dao)
        repo = com.scholiast.android.data.notes.RoomPageHighlightRepository(dao)
        drive = FakeDriveApi()
        engine = SyncEngine(
            drive = drive,
            pageStore = store,
            frameStore = FrameStore(Files.createTempDirectory("scholiast-frames").toFile()),
            now = { NOW },
        )
    }

    @After
    fun tearDown() {
        db.close()
    }

    // --- fakes ---------------------------------------------------------------

    /** In-memory Drive: folders of text files + blob bytes (minimal surface). */
    private class FakeDriveApi : DriveApi {
        val folders = mutableMapOf<DriveFolder, LinkedHashMap<String, DriveFileMeta>>()
        val contents = mutableMapOf<String, String>()
        private val byId = mutableMapOf<String, DriveFileMeta>()
        private var nextId = 0
        private var nextRev = 0

        fun seedRemote(folder: DriveFolder, name: String, content: String): DriveFileMeta {
            val meta = DriveFileMeta(id = "f${nextId++}", name = name, headRevisionId = "r${nextRev++}")
            byId[meta.id] = meta
            folders.getOrPut(folder) { LinkedHashMap() }[name] = meta
            contents[meta.id] = content
            return meta
        }

        override suspend fun listFolder(folder: DriveFolder, pageToken: String?): DriveFilePage =
            DriveFilePage(folders[folder]?.values?.toList() ?: emptyList())

        override suspend fun findInFolder(folder: DriveFolder, fileName: String): DriveFileMeta? =
            folders[folder]?.get(fileName)

        override suspend fun createTextFile(folder: DriveFolder, fileName: String, content: String): DriveFileMeta {
            val meta = DriveFileMeta(id = "f${nextId++}", name = fileName, headRevisionId = "r${nextRev++}")
            byId[meta.id] = meta
            folders.getOrPut(folder) { LinkedHashMap() }[fileName] = meta
            contents[meta.id] = content
            return meta
        }

        override suspend fun updateFile(fileId: String, content: String, ifMatchRevision: String?): DriveFileMeta {
            val current = byId[fileId] ?: error("update of unknown file $fileId")
            if (ifMatchRevision != null && current.headRevisionId != ifMatchRevision) {
                throw SyncConflictException("CAS conflict on $fileId")
            }
            val meta = current.copy(headRevisionId = "r${nextRev++}")
            byId[fileId] = meta
            contents[fileId] = content
            return meta
        }

        override suspend fun downloadText(fileId: String): String =
            contents[fileId] ?: error("no content for $fileId")

        override suspend fun uploadBlob(folder: DriveFolder, fileName: String, bytes: ByteArray, mimeType: String): DriveFileMeta {
            val meta = DriveFileMeta(id = "f${nextId++}", name = fileName, headRevisionId = "r${nextRev++}")
            contents[meta.id] = ""
            return meta
        }

        override suspend fun downloadBlob(fileId: String): ByteArray = error("not used here")

        override suspend fun deleteFile(fileId: String) {}

        override suspend fun wipeAppData(): Int = 0
    }

    // --- helpers -------------------------------------------------------------

    private fun hl(id: String, updatedAt: Long?, color: String? = null, quote: String? = null) =
        PageHighlight(
            id = id,
            updatedAt = updatedAt,
            notes = emptyList(),
            color = color,
            extras = if (quote != null) {
                buildJsonObject { put("quote", JsonPrimitive(quote)) }
            } else {
                kotlinx.serialization.json.JsonObject(emptyMap())
            },
        )

    private fun record(url: String, highlights: List<PageHighlight> = emptyList(), title: String? = null) =
        VideoPage(version = 2, url = url, title = title, highlights = highlights)

    private suspend fun uploadedRecord(key: String): VideoPage {
        val meta = drive.folders[DriveFolder.PAGES]?.get(PageFileName.of(key))
            ?: error("no remote file for $key")
        return ScholiastJson.decode<VideoPage>(drive.contents[meta.id]!!)
    }

    private fun seedRow(key: String, snap: VideoPage, highlightsJson: String = "[]") = runBlocking {
        db.videoPageDao().upsert(
            VideoPageEntity(
                urlHash = Normalize.urlHash(key),
                url = key,
                videoId = null,
                title = null,
                itemsJson = "[]",
                updatedAt = 10L,
                snapJson = ScholiastJson.encode(snap),
                fileId = null,
                headRevisionId = null,
                highlightsJson = highlightsJson,
            )
        )
    }

    // --- tests -----------------------------------------------------------------

    @Test
    fun `a locally created highlight is assembled into the push`() = runBlocking {
        val url = "https://example.com/lecture-notes"
        repo.upsert(url, PageHighlight(id = "hl-local", color = "yellow")) // no timestamp → stamped

        val result = engine.syncChanged(listOf(url))

        assertTrue("ok: ${result.errors}", result.ok)
        val uploaded = uploadedRecord(Normalize.normalizeUrl(url))
        assertEquals(listOf("hl-local"), uploaded.highlights.map { it.id })
        assertNotNull("timestamp stamped for merge parity", uploaded.highlights.single().updatedAt)
        // The merged snapshot carries it too, so later syncs stay consistent.
        assertEquals(listOf("hl-local"), store.load(url).snap!!.highlights.map { it.id })
    }

    @Test
    fun `a local delete tombstones the highlight the snapshot had`() = runBlocking {
        val url = "https://example.com/lecture-notes"
        val key = Normalize.normalizeUrl(url)
        drive.seedRemote(DriveFolder.PAGES, PageFileName.of(key), ScholiastJson.encode(record(key, listOf(hl("hl1", 100L, "yellow")))))

        // First reconcile pulls the desktop highlight down (row + snapshot).
        assertTrue(engine.syncChanged(listOf(key)).ok)
        assertEquals(listOf("hl1"), store.load(key).highlights.map { it.id })

        // The user deletes it locally; the next reconcile must tombstone it —
        // the legacy backfill must NOT re-seed it from the snapshot.
        repo.delete(key, "hl1")
        assertTrue(engine.syncChanged(listOf(key)).ok)

        val snap = store.load(key).snap!!
        assertEquals(NOW, snap.tombstones.highlights["hl1"])
        assertTrue(snap.highlights.isEmpty())
        assertEquals(NOW, uploadedRecord(key).tombstones.highlights["hl1"])
    }

    @Test
    fun `an untouched desktop highlight passes through byte-identical`() = runBlocking {
        val url = "https://example.com/article"
        val key = Normalize.normalizeUrl(url)
        val desktopHl = hl("hl-desktop", 100L, color = "green", quote = "anchored text")
        val desktopRec = record(key, listOf(desktopHl), title = "T")

        // Pre-Task-27 row shape: pristine default '[]' + a synced snapshot.
        seedRow(key, desktopRec)
        drive.seedRemote(DriveFolder.PAGES, PageFileName.of(key), ScholiastJson.encode(desktopRec))

        assertTrue(engine.syncChanged(listOf(key)).ok)
        // A second reconcile must be equally inert — this is the regression
        // that would have tombstoned every desktop highlight.
        assertTrue(engine.syncChanged(listOf(key)).ok)

        val expected = ScholiastJson.encode(listOf(desktopHl))
        val snap = store.load(key).snap!!
        assertEquals(expected, ScholiastJson.encode(snap.highlights))
        assertTrue("no tombstones: ${snap.tombstones.highlights}", snap.tombstones.highlights.isEmpty())
        assertEquals(expected, ScholiastJson.encode(uploadedRecord(key).highlights))
    }

    @Test
    fun `a newer desktop edit wins over a stale local edit`() = runBlocking {
        val url = "https://example.com/article"
        val key = Normalize.normalizeUrl(url)
        val baseRec = record(key, listOf(hl("hl1", 100L, "yellow")), title = "T")

        // Local edit at t=150 (stale); the desktop edited the same highlight at t=200.
        seedRow(key, baseRec, highlightsJson = ScholiastJson.encode(listOf(hl("hl1", 150L, "red"))))
        drive.seedRemote(DriveFolder.PAGES, PageFileName.of(key), ScholiastJson.encode(record(key, listOf(hl("hl1", 200L, "green")), title = "T")))

        assertTrue(engine.syncChanged(listOf(key)).ok)

        val kept = store.load(key).snap!!.highlights.single()
        assertEquals("hl1", kept.id)
        assertEquals(200L, kept.updatedAt)
        assertEquals("green", kept.color)
        assertTrue("remote body won wholesale: ${kept.extras}", kept.extras.isEmpty())
        assertEquals("green", uploadedRecord(key).highlights.single().color)
    }
}
