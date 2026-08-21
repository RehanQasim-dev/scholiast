package com.scholiast.android.ui.frame

import com.scholiast.android.data.db.LoadedVideoPage
import com.scholiast.android.data.db.VideoPageEntity
import com.scholiast.android.data.model.FrameImage
import com.scholiast.android.data.model.ScholiastJson
import com.scholiast.android.data.model.Stroke
import com.scholiast.android.data.model.TextLabel
import com.scholiast.android.data.model.VideoItem
import com.scholiast.android.data.model.VideoMarkup
import com.scholiast.android.data.model.Arrow
import com.scholiast.android.data.model.Line
import com.scholiast.android.data.model.Rect
import com.scholiast.android.data.notes.VideoItemRepository
import com.scholiast.android.data.notes.parseVideoNote
import com.scholiast.android.player.PlayerBridge
import com.scholiast.android.player.PlayerEvents
import com.scholiast.android.player.PlayerViewModel
import java.io.File
import java.util.concurrent.atomic.AtomicLong
import kotlin.io.path.createTempDirectory
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Task 14 unit tests: markup math (normalization round-trip, eraser hit-test,
 * width mapping), the undo/redo session, palm rejection, the frame file store,
 * the capture ViewModel's state machine against a fake bridge + repository
 * (save/discard/fail, the four comment paths), and golden JSON fixtures pinning
 * the markup/item shape to the desktop's TS output byte-for-byte.
 */
class FrameCaptureTest {

    private lateinit var framesDir: File

    @Before
    fun setUp() {
        framesDir = createTempDirectory("scholiast-frames").toFile()
    }

    @After
    fun tearDown() {
        framesDir.deleteRecursively()
    }

    // ---- MarkupMath: normalization round-trip --------------------------------

    @Test
    fun `normalize and denormalize round-trip`() {
        val w = 1280
        val h = 720
        for (x in listOf(0f, 1f, 640f, 1279f, 1280f)) {
            val n = MarkupMath.normalize(x, w)
            assertTrue("in 0..1: $n", n in 0.0..1.0)
            assertEquals(x, MarkupMath.denormalize(n, w), 0.001f)
        }
        assertEquals(0.0, MarkupMath.normalize(-5f, w), 1e-9)
        assertEquals(1.0, MarkupMath.normalize(99999f, w), 1e-9)
    }

    @Test
    fun `normalizeFlattened divides x by w and y by h in pairs`() {
        val flat = MarkupMath.normalizeFlattened(listOf(640.0, 180.0, 0.0, 720.0), 1280, 720)
        assertEquals(listOf(0.5, 0.25, 0.0, 1.0), flat)
    }

    @Test
    fun `flatten and unflatten round-trip`() {
        val pts = listOf(1f to 2f, 3f to 4f, 5f to 6f)
        assertEquals(listOf(1.0, 2.0, 3.0, 4.0, 5.0, 6.0), MarkupMath.flatten(pts))
        assertEquals(pts, MarkupMath.unflatten(MarkupMath.flatten(pts)))
    }

    @Test
    fun `filterMinDistance drops samples closer than the threshold`() {
        val pts = listOf(0f to 0f, 1f to 0f, 2f to 0f, 100f to 0f)
        val filtered = MarkupMath.filterMinDistance(pts, minPx = 2f)
        assertEquals(3, filtered.size)
        assertEquals(0f to 0f, filtered[0])
        assertEquals(2f to 0f, filtered[1])
        assertEquals(100f to 0f, filtered[2])
    }

    @Test
    fun `pencil width is pressure lerp inside min max`() {
        assertEquals(2f, MarkupMath.pencilWidthPx(1f, 0f), 1e-6f)
        assertEquals(10f, MarkupMath.pencilWidthPx(1f, 1f), 1e-6f)
        assertEquals(6f, MarkupMath.pencilWidthPx(1f, 0.5f), 1e-6f)
        assertEquals(20f, MarkupMath.pencilWidthPx(2f, 1f), 1e-6f)
    }

    @Test
    fun `highlighter and eraser widths scale with density`() {
        assertEquals(22f, MarkupMath.highlighterWidthPx(1f), 1e-6f)
        assertEquals(44f, MarkupMath.highlighterWidthPx(2f), 1e-6f)
        assertEquals(22f * 1.4f, MarkupMath.eraserWidthPx(1f), 1e-6f)
    }

    @Test
    fun `weightFor maps drawn dp width to the TS stroke widths`() {
        assertEquals("thin", MarkupMath.weightFor(2f * 1f, 1f))
        assertEquals("medium", MarkupMath.weightFor(6f * 1f, 1f))
        assertEquals("thick", MarkupMath.weightFor(9f * 1f, 1f))
        assertEquals("medium", MarkupMath.weightFor(7.9f * 1f, 1f)) // boundary: <8 medium
        assertEquals("thick", MarkupMath.weightFor(8f * 1f, 1f))    // ≥8 thick
    }

    @Test
    fun `renderWeightPx matches the desktop max of 2 and W times point-zero-zero-four`() {
        assertEquals(5.12f, MarkupMath.renderWeightPx(null, 1280), 1e-3f)
        assertEquals(2.56f, MarkupMath.renderWeightPx("thin", 1280), 1e-3f)
        assertEquals(10.24f, MarkupMath.renderWeightPx("thick", 1280), 1e-3f)
        assertEquals(2f, MarkupMath.renderWeightPx(null, 100), 1e-3f) // floor of 2
    }

    // ---- Eraser hit-testing --------------------------------------------------

    @Test
    fun `eraserHits true when the path crosses a stroke segment`() {
        val stroke = Stroke(
            id = "s", color = "yellow",
            points = listOf(0.1, 0.5, 0.9, 0.5), // horizontal line mid-frame
        )
        // Eraser path through the middle at 50% of a 1000x1000 frame.
        assertTrue(MarkupMath.eraserHits(stroke, listOf(500.0, 520.0), tolPx = 40.0, w = 1000, h = 1000))
        // Same point far below the line misses.
        assertFalse(MarkupMath.eraserHits(stroke, listOf(500.0, 900.0), tolPx = 40.0, w = 1000, h = 1000))
    }

    @Test
    fun `eraserHits false for degenerate inputs`() {
        val stroke = Stroke(id = "s", color = "red", points = listOf(0.1, 0.1, 0.2, 0.2))
        assertFalse(MarkupMath.eraserHits(stroke, emptyList(), 40.0, 1000, 1000))
        assertFalse(MarkupMath.eraserHits(stroke, listOf(500.0), 40.0, 1000, 1000))
        val dot = Stroke(id = "d", color = "red", points = listOf(0.1, 0.1))
        assertFalse(MarkupMath.eraserHits(dot, listOf(100.0, 100.0, 200.0, 200.0), 40.0, 1000, 1000))
    }

    @Test
    fun `distToSegment clamps the projection to the segment ends`() {
        // Point above the segment start gets the distance to the start corner.
        assertEquals(5.0, MarkupMath.distToSegment(0.0, 5.0, 0.0, 0.0, 10.0, 0.0), 1e-9)
        assertEquals(0.0, MarkupMath.distToSegment(5.0, 0.0, 0.0, 0.0, 10.0, 0.0), 1e-9)
    }

    // ---- MarkupSession (undo/redo) -------------------------------------------

    @Test
    fun `commit then undo then redo restores the stroke list`() {
        val session = MarkupSession()
        session.commitStroke("a", "yellow", listOf(0.1, 0.1, 0.2, 0.2), "thin")
        session.commitStroke("b", "red", listOf(0.5, 0.5, 0.6, 0.6), "medium")
        assertEquals(listOf("a", "b"), session.markup.strokes.map { it.id })

        assertTrue(session.undo())
        assertEquals(listOf("a"), session.markup.strokes.map { it.id })
        assertTrue(session.undo())
        assertEquals(emptyList<Stroke>(), session.markup.strokes)
        assertFalse(session.canUndo)

        assertTrue(session.redo())
        assertEquals(listOf("a"), session.markup.strokes.map { it.id })
        assertTrue(session.redo())
        assertEquals(listOf("a", "b"), session.markup.strokes.map { it.id })
        assertFalse(session.canRedo)
    }

    @Test
    fun `a new commit clears the redo stack`() {
        val session = MarkupSession()
        session.commitStroke("a", "yellow", listOf(0.1, 0.1), "thin")
        session.undo()
        assertTrue(session.canRedo)
        session.commitStroke("b", "red", listOf(0.5, 0.5), "thin")
        assertFalse(session.canRedo)
        assertEquals(listOf("b"), session.markup.strokes.map { it.id })
    }

    @Test
    fun `eraseStrokes removes hit strokes and snapshots once`() {
        val session = MarkupSession()
        session.commitStroke("keep", "yellow", listOf(0.1, 0.9, 0.9, 0.9), "thin") // top
        session.commitStroke("hit", "red", listOf(0.1, 0.1, 0.9, 0.1), "thin")     // bottom
        // Eraser through the bottom line in frame px.
        assertTrue(session.eraseStrokes(listOf(500.0, 110.0), tolPx = 40.0, w = 1000, h = 1000))
        assertEquals(listOf("keep"), session.markup.strokes.map { it.id })

        session.undo()
        assertEquals(listOf("keep", "hit"), session.markup.strokes.map { it.id })
    }

    @Test
    fun `an eraser swipe that hits nothing does not snapshot`() {
        val session = MarkupSession()
        session.commitStroke("a", "yellow", listOf(0.1, 0.1, 0.9, 0.1), "thin")
        assertFalse(session.eraseStrokes(listOf(500.0, 900.0), tolPx = 40.0, w = 1000, h = 1000))
        assertEquals(listOf("a"), session.markup.strokes.map { it.id })
        // Only the commit's own snapshot exists: one undo empties the canvas
        // (a spurious erase snapshot would have left the stroke behind).
        assertTrue(session.undo())
        assertEquals(emptyList<Stroke>(), session.markup.strokes)
        assertFalse(session.canUndo)
    }

    @Test
    fun `clear snapshots so undo restores everything`() {
        val session = MarkupSession()
        session.commitStroke("a", "yellow", listOf(0.1, 0.1), "thin")
        session.clear()
        assertTrue(session.markup.strokes.isEmpty())
        assertTrue(session.undo())
        assertEquals(listOf("a"), session.markup.strokes.map { it.id })
    }

    @Test
    fun `undo stack is capped at 50`() {
        val session = MarkupSession()
        repeat(60) { i -> session.commitStroke("s$i", "yellow", listOf(0.1, 0.1), "thin") }
        var undos = 0
        while (session.undo()) undos++
        assertEquals(50, undos)
        // The desktop `pushUndoSnapshot` also drops the OLDEST past 50, so the
        // first 10 commits are un-undoable and the 10th stroke stays.
        assertEquals((0..9).map { "s$it" }, session.markup.strokes.map { it.id })
    }

    // ---- Palm rejection ------------------------------------------------------

    @Test
    fun `finger down is rejected while the pen hovers`() {
        assertTrue(PalmRejection.acceptDown(PointerKind.FINGER, penNear = false))
        assertFalse(PalmRejection.acceptDown(PointerKind.FINGER, penNear = true))
        assertTrue(PalmRejection.acceptDown(PointerKind.STYLUS, penNear = true))
        assertTrue(PalmRejection.acceptDown(PointerKind.ERASER, penNear = true))
    }

    @Test
    fun `hover enter move exit sequence gates finger input`() {
        val tracker = PenProximityTracker()
        assertFalse(tracker.penNear)
        tracker.onHoverEnter(1)
        assertTrue(tracker.penNear)
        tracker.onHoverMove(1)
        assertTrue(tracker.penNear)
        tracker.onHoverExit(1)
        assertFalse(tracker.penNear)
    }

    @Test
    fun `proximity is keyed by device id`() {
        val tracker = PenProximityTracker()
        tracker.onHoverEnter(1)
        tracker.onHoverExit(2) // unrelated device
        assertTrue(tracker.penNear)
        tracker.onHoverExit(1)
        assertFalse(tracker.penNear)
    }

    // ---- FrameStore ----------------------------------------------------------

    @Test
    fun `frame store save load delete round-trip`() = runBlocking {
        val store = FrameStore(framesDir)
        val jpeg = ByteArray(64) { it.toByte() }

        store.save("fr-1", jpeg)
        assertTrue(store.has("fr-1"))
        assertEquals(File(framesDir, "fr-1.jpg"), store.fileFor("fr-1"))
        assertTrue(jpeg.contentEquals(store.load("fr-1")))

        assertTrue(store.delete("fr-1"))
        assertFalse(store.has("fr-1"))
        assertNull(store.load("fr-1"))
        assertFalse(store.delete("fr-1")) // nothing left
    }

    @Test
    fun `frame store delete hook removes the jpeg synchronously`() = runBlocking {
        val store = FrameStore(framesDir)
        store.save("fr-2", byteArrayOf(1, 2, 3))
        val hook = store.asDeleteHook()
        hook.deleteFrameFile("fr-2")
        assertFalse(store.has("fr-2"))
    }

    // ---- FrameCaptureViewModel: capture flow ---------------------------------

    @Test
    fun `startCapture requests a bridge capture`() = runBlocking {
        val env = env()
        env.vm.startCapture()
        assertEquals(FrameCaptureViewModel.FrameUiState.Capturing::class, env.vm.state.value::class)
        assertEquals(listOf("captureFrame"), env.bridge.calls)
    }

    @Test
    fun `re-entrant startCapture is ignored while capturing`() = runBlocking {
        val env = env()
        env.vm.startCapture()
        env.vm.startCapture()
        assertEquals(1, env.bridge.calls.count { it == "captureFrame" })
    }

    @Test
    fun `onFrameReady moves to Drawing with the captured frame`() = runBlocking {
        val env = env()
        env.vm.startCapture()
        env.vm.onFrameReady("data:image/jpeg;base64,AAAA", 640, 360)
        val state = env.vm.state.value
        assertTrue(state is FrameCaptureViewModel.FrameUiState.Drawing)
        assertEquals(640, (state as FrameCaptureViewModel.FrameUiState.Drawing).frame.w)
        assertEquals(360, state.frame.h)
    }

    @Test
    fun `onFrameFailed moves to Failed and resumes playback if it was playing`() = runBlocking {
        val env = env()
        env.player.onStateChange(1) // playing
        env.vm.startCapture()
        env.vm.onFrameFailed("black")
        assertTrue(env.vm.state.value is FrameCaptureViewModel.FrameUiState.Failed)
        assertEquals("black", (env.vm.state.value as FrameCaptureViewModel.FrameUiState.Failed).error)
        assertTrue("playback resumed", env.bridge.calls.last() == "play")
    }

    @Test
    fun `onFrameFailed does not resume when the video was paused`() = runBlocking {
        val env = env()
        env.player.onStateChange(2) // paused
        env.vm.startCapture()
        env.vm.onFrameFailed("tainted")
        assertFalse(env.bridge.calls.contains("play"))
    }

    @Test
    fun `late capture results after a failure are ignored`() = runBlocking {
        val env = env()
        env.vm.startCapture()
        env.vm.onFrameFailed("capture-unavailable")
        env.vm.onFrameReady("data:image/jpeg;base64,AAAA", 640, 360)
        assertTrue(env.vm.state.value is FrameCaptureViewModel.FrameUiState.Failed)
    }

    // ---- FrameCaptureViewModel: save / discard -------------------------------

    @Test
    fun `save writes jpeg file and a kind-frame item with frame w h and markup`() = runBlocking {
        val env = env()
        env.player.onStateChange(1) // playing (should resume after save)
        env.player.onTimeUpdate(42.5)
        env.vm.startCapture()
        env.vm.onFrameReady("data:image/jpeg;base64,AAAA", 640, 360)

        val markup = VideoMarkup(
            strokes = listOf(Stroke("s1", "yellow", listOf(0.1, 0.2, 0.3, 0.4), "medium")),
            lines = emptyList(),
            texts = emptyList(),
            rects = emptyList(),
            arrows = emptyList(),
        )
        val jpeg = byteArrayOf(9, 8, 7)
        val stored = env.vm.save(markup, jpeg, 640, 360, comment = "  Nice slide  ")

        assertNotNull(stored)
        assertEquals("frame", stored!!.kind)
        assertEquals(42.5, stored.videoTime, 1e-9)
        assertEquals(FrameImage(w = 640, h = 360), stored.frame)
        assertNull("bytes never inline", stored.frame?.dataUrl)
        assertEquals(markup, stored.markup)

        // File + OCR hook + repository all agree on the item id.
        assertTrue(env.store.has(stored.id))
        assertTrue(jpeg.contentEquals(env.store.load(stored.id)))
        assertEquals(listOf(stored.id), env.ocrItems.map { it.first })
        assertEquals(env.store.fileFor(stored.id), env.ocrItems.single().second)
        assertEquals(stored, env.repo.storedItem(stored.id))

        // Comment becomes a stamped note; the stamp is the fixed clock.
        val note = parseVideoNote(stored.notes.single())
        assertEquals("Nice slide", note.text)
        assertEquals(1000L, note.timestamp)
        assertEquals("Nice slide<!--timestamp:1000-->", stored.notes.single())

        // Playback resumed (was playing).
        assertTrue(env.bridge.calls.last() == "play")
        assertTrue(env.vm.state.value is FrameCaptureViewModel.FrameUiState.Saved)
    }

    @Test
    fun `save with empty markup stores markup null like the desktop undefined`() = runBlocking {
        val env = env()
        env.vm.startCapture()
        env.vm.onFrameReady("data:image/jpeg;base64,AAAA", 640, 360)
        val stored = env.vm.save(VideoMarkup.empty(), byteArrayOf(1), 640, 360)
        assertNotNull(stored)
        assertNull("empty markup must not serialize", stored!!.markup)
        assertEquals(emptyList<String>(), stored.notes)
    }

    @Test
    fun `save with blank comment leaves notes empty`() = runBlocking {
        val env = env()
        env.vm.startCapture()
        env.vm.onFrameReady("data:image/jpeg;base64,AAAA", 640, 360)
        val stored = env.vm.save(VideoMarkup.empty(), byteArrayOf(1), 640, 360, comment = "   ")
        assertNotNull(stored)
        assertEquals(emptyList<String>(), stored!!.notes)
    }

    @Test
    fun `save failure goes to Failed save-failed and resumes`() = runBlocking {
        val env = env()
        env.player.onStateChange(1)
        env.repo.failOnAdd = true
        env.vm.startCapture()
        env.vm.onFrameReady("data:image/jpeg;base64,AAAA", 640, 360)

        assertNull(env.vm.save(VideoMarkup.empty(), byteArrayOf(1), 640, 360))
        val state = env.vm.state.value
        assertTrue(state is FrameCaptureViewModel.FrameUiState.Failed)
        assertEquals("save-failed", (state as FrameCaptureViewModel.FrameUiState.Failed).error)
        assertTrue(env.bridge.calls.last() == "play")
    }

    @Test
    fun `discard leaves no item and no file and resumes`() = runBlocking {
        val env = env()
        env.player.onStateChange(1)
        env.vm.startCapture()
        env.vm.onFrameReady("data:image/jpeg;base64,AAAA", 640, 360)

        env.vm.discard()
        assertTrue(env.vm.state.value is FrameCaptureViewModel.FrameUiState.Idle)
        assertTrue(env.repo.pages.values.all { it.isEmpty() })
        assertTrue(env.bridge.calls.last() == "play")
    }

    // ---- FrameCaptureViewModel: timestamp-only note (path 3) -----------------

    @Test
    fun `saveNoteOnly stores a kind-note item with a stamped comment`() = runBlocking {
        val env = env()
        env.vm.startCapture()
        env.vm.onFrameReady("data:image/jpeg;base64,AAAA", 640, 360)

        val stored = env.vm.saveNoteOnly("  Remember this  ", 77.0)
        assertNotNull(stored)
        assertEquals("note", stored!!.kind)
        assertEquals(77.0, stored.videoTime, 1e-9)
        assertNull(stored.frame)
        assertNull(stored.markup)
        assertEquals("Remember this<!--timestamp:1000-->", stored.notes.single())
        assertFalse(env.store.has(stored.id))
        assertTrue(env.vm.state.value is FrameCaptureViewModel.FrameUiState.Saved)
    }

    @Test
    fun `saveNoteOnly with a blank comment discards without an item`() = runBlocking {
        val env = env()
        env.player.onStateChange(1)
        env.vm.startCapture()
        env.vm.onFrameReady("data:image/jpeg;base64,AAAA", 640, 360)

        assertNull(env.vm.saveNoteOnly("   ", 77.0))
        assertTrue(env.vm.state.value is FrameCaptureViewModel.FrameUiState.Idle)
        assertTrue(env.repo.pages.values.all { it.isEmpty() })
        assertTrue(env.bridge.calls.last() == "play")
    }

    // ---- URL normalization ---------------------------------------------------

    @Test
    fun `url is the normalized watch url of the loaded video`() {
        val env = env()
        env.player.loadVideo("abc123")
        assertEquals("https://www.youtube.com/watch?v=abc123", env.vm.url)
    }

    // ---- Golden JSON fixtures (TS byte-compat) -------------------------------

    @Test
    fun `markup golden json matches the TS video-markup shape`() {
        val markup = VideoMarkup(
            strokes = listOf(Stroke("s1", "yellow", listOf(0.1, 0.2, 0.3, 0.4), "medium")),
            lines = listOf(Line("l1", "red", 0.1, 0.2, 0.3, 0.4, "thin")),
            texts = listOf(TextLabel("t1", "green", 0.5, 0.5, 0.28, 1.0, "hello")),
            rects = listOf(Rect("r1", "black", 0.1, 0.1, 0.2, 0.2, "thick")),
            arrows = listOf(Arrow("a1", "yellow", 0.1, 0.1, 0.5, 0.5, "medium")),
        )
        assertEquals(
            "{\"strokes\":[{\"id\":\"s1\",\"color\":\"yellow\",\"points\":[0.1,0.2,0.3,0.4],\"weight\":\"medium\"}]," +
                "\"lines\":[{\"id\":\"l1\",\"color\":\"red\",\"x1\":0.1,\"y1\":0.2,\"x2\":0.3,\"y2\":0.4,\"weight\":\"thin\"}]," +
                "\"texts\":[{\"id\":\"t1\",\"color\":\"green\",\"x\":0.5,\"y\":0.5,\"w\":0.28,\"size\":1,\"text\":\"hello\"}]," +
                "\"rects\":[{\"id\":\"r1\",\"color\":\"black\",\"x\":0.1,\"y\":0.1,\"w\":0.2,\"h\":0.2,\"weight\":\"thick\"}]," +
                "\"arrows\":[{\"id\":\"a1\",\"color\":\"yellow\",\"x1\":0.1,\"y1\":0.1,\"x2\":0.5,\"y2\":0.5,\"weight\":\"medium\"}]}",
            ScholiastJson.encode(markup),
        )
    }

    @Test
    fun `empty markup golden json matches the TS emptyMarkup`() {
        assertEquals(
            "{\"strokes\":[],\"lines\":[],\"texts\":[],\"rects\":[],\"arrows\":[]}",
            ScholiastJson.encode(VideoMarkup.empty()),
        )
    }

    @Test
    fun `frame item golden json matches the TS VideoItem shape`() {
        val item = VideoItem(
            id = "fr1",
            kind = "frame",
            videoTime = 42.5,
            frame = FrameImage(w = 640, h = 360),
            markup = VideoMarkup(
                strokes = listOf(Stroke("s1", "yellow", listOf(0.5, 0.5), "medium")),
                lines = emptyList(),
                texts = emptyList(),
                rects = emptyList(),
                arrows = emptyList(),
            ),
            notes = listOf("Great slide<!--timestamp:1000-->"),
            updatedAt = 12345L,
        )
        assertEquals(
            "{\"id\":\"fr1\",\"kind\":\"frame\",\"videoTime\":42.5,\"frame\":{\"w\":640,\"h\":360}," +
                "\"markup\":{\"strokes\":[{\"id\":\"s1\",\"color\":\"yellow\",\"points\":[0.5,0.5],\"weight\":\"medium\"}]," +
                "\"lines\":[],\"texts\":[],\"rects\":[],\"arrows\":[]}," +
                "\"notes\":[\"Great slide<!--timestamp:1000-->\"],\"updatedAt\":12345}",
            ScholiastJson.encode(item),
        )
    }

    // ---- fixtures ------------------------------------------------------------

    /** The full environment: player + fake bridge, VM, temp-dir store, fake repo. */
    private fun env(): Env {
        val player = PlayerViewModel()
        val bridge = FakeBridge()
        player.bind(bridge)
        player.loadVideo("abc123")
        bridge.calls.clear()
        val store = FrameStore(framesDir)
        val repo = FakeVideoItemRepository()
        val ocrItems = mutableListOf<Pair<String, File>>()
        val vm = FrameCaptureViewModel(
            player = player,
            repository = repo,
            store = store,
            ocr = OcrHook { itemId, file ->
                ocrItems.add(itemId to file)
                null
            },
            clock = { 1000L },
        )
        return Env(player, bridge, store, repo, ocrItems, vm)
    }

    private data class Env(
        val player: PlayerViewModel,
        val bridge: FakeBridge,
        val store: FrameStore,
        val repo: FakeVideoItemRepository,
        val ocrItems: MutableList<Pair<String, File>>,
        val vm: FrameCaptureViewModel,
    )

    /** Records commands; tests feed [PlayerEvents] in directly. */
    private class FakeBridge : PlayerBridge {
        val calls = mutableListOf<String>()
        var listener: PlayerEvents? = null

        override fun setEventsListener(listener: PlayerEvents?) {
            this.listener = listener
        }

        override fun loadVideo(videoId: String) {
            calls += "loadVideo:$videoId"
        }

        override fun seekTo(seconds: Double) {
            calls += "seekTo:$seconds"
        }

        override fun play() {
            calls += "play"
        }

        override fun pause() {
            calls += "pause"
        }

        override fun setRate(rate: Double) {
            calls += "setRate:$rate"
        }

        override fun setVolume(percent: Int) {
            calls += "setVolume:$percent"
        }

        override fun setCaptions(enabled: Boolean) {
            calls += "setCaptions:$enabled"
        }

        override fun captureFrame() {
            calls += "captureFrame"
        }
    }

    /** In-memory repository (same contract as the Room repo, like Task 06's tests). */
    private class FakeVideoItemRepository : VideoItemRepository {
        val pages = mutableMapOf<String, MutableList<VideoItem>>()
        var failOnAdd = false
        private val now = AtomicLong(1_000_000_000_000L)

        fun storedItem(id: String): VideoItem? = pages.values.flatten().firstOrNull { it.id == id }

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
            if (failOnAdd) throw IllegalStateException("boom")
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