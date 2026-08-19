package com.scholiast.android.ui.transcript

import com.scholiast.android.data.db.LoadedVideoPage
import com.scholiast.android.data.db.VideoPageEntity
import com.scholiast.android.data.model.VideoItem
import com.scholiast.android.data.notes.VideoItemRepository
import com.scholiast.android.data.notes.parseVideoNote
import com.scholiast.android.domain.transcript.CaptionTrack
import com.scholiast.android.domain.transcript.TranscriptChunker
import com.scholiast.android.domain.transcript.TranscriptClient
import com.scholiast.android.domain.transcript.TranscriptCue
import com.scholiast.android.domain.transcript.TranscriptResult
import com.scholiast.android.ui.theme.HighlightRed
import androidx.compose.ui.graphics.Color
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Transcript panel tests (Task 13): selection→anchor math (cue index + per-cue
 * char offsets, the desktop `offsetWithinCue` convention), live-follow cue
 * index + lookback math, `M:SS–M:SS` range formatting, the default-language
 * track pick (English → first), the ViewModel's highlight CRUD (repository
 * save payload shape), and the inline repaint spans.
 *
 * The fixture mirrors what the desktop produces: cues chunked by the Task 12
 * chunker, paragraphs of joined cue text.
 */
class TranscriptPanelTest {

    // ---- fixture ------------------------------------------------------------

    private val cues = listOf(
        TranscriptCue(0, 0L, 1_000L, "The first sentence"),
        TranscriptCue(1, 1_000L, 2_000L, "ends here."),
        TranscriptCue(2, 2_000L, 3_000L, "A second thought?"),
        TranscriptCue(3, 3_000L, 4_000L, "Certainly."),
    )
    private val paragraphs = TranscriptChunker.chunk(cues)

    private val url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    private val videoId = "dQw4w9WgXcQ"

    companion object {
        private const val TEST_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    }

    private fun para(index: Int) = paragraphs[index]

    // ---- selection → anchor math (desktop offsetWithinCue convention) -------

    @Test
    fun `mapParagraphRange derives per-cue anchors like the desktop`() {
        // paragraph 0 = "The first sentence ends here." (29 chars)
        // cue 0 = [0,18) "The first sentence", cue 1 = [19,29) "ends here."
        val sel = mapParagraphRange(para(0), cues, 4, 28)
        assertNotNull(sel)
        assertEquals(0, sel!!.startCue)
        assertEquals(4, sel.startOffset)
        assertEquals(1, sel.endCue)
        assertEquals(9, sel.endOffset)
        assertEquals("first sentence ends here", sel.quote)
    }

    @Test
    fun `selection starting at a cue boundary maps to the next cue at offset 0`() {
        val sel = mapParagraphRange(para(0), cues, 19, 29)
        assertNotNull(sel)
        assertEquals(1, sel!!.startCue)
        assertEquals(0, sel.startOffset)
        assertEquals(1, sel.endCue)
        assertEquals(10, sel.endOffset)
        assertEquals("ends here.", sel.quote)
    }

    @Test
    fun `boundary on a join space belongs to the preceding cue`() {
        // s = 18 is the space between the cues — attributed to cue 0's end.
        val sel = mapParagraphRange(para(0), cues, 18, 29)
        assertNotNull(sel)
        assertEquals(0, sel!!.startCue)
        assertEquals(18, sel.startOffset)
        assertEquals(1, sel.endCue)
        assertEquals(10, sel.endOffset)
        assertEquals("ends here.", sel.quote)
    }

    @Test
    fun `single-cue selection maps to that cue alone`() {
        // paragraph 1 = "A second thought?" — one cue, whole-paragraph tap.
        val sel = mapParagraphRange(para(1), cues, 0, 17)
        assertNotNull(sel)
        assertEquals(2, sel!!.startCue)
        assertEquals(0, sel.startOffset)
        assertEquals(2, sel.endCue)
        assertEquals(17, sel.endOffset)
        assertEquals("A second thought?", sel.quote)
    }

    @Test
    fun `whitespace-only selection is rejected`() {
        assertNull(mapParagraphRange(para(0), cues, 18, 19)) // just the join space
        assertNull(mapParagraphRange(para(1), cues, 5, 5))
    }

    @Test
    fun `inverted and out-of-bounds ranges are handled`() {
        assertNull(mapParagraphRange(para(0), cues, 28, 4))
        val clamped = mapParagraphRange(para(0), cues, -3, 100)
        assertNotNull(clamped)
        assertEquals(0, clamped!!.startCue)
        assertEquals(0, clamped.startOffset)
        assertEquals(1, clamped.endCue)
        assertEquals(10, clamped.endOffset)
    }

    // ---- live-follow index math (desktop currentCueIndex) --------------------

    @Test
    fun `activeCueIndex picks the cue containing the current time`() {
        val cs = listOf(
            TranscriptCue(0, 0L, 1_000L, "a"),
            TranscriptCue(1, 1_000L, 2_000L, "b"),
            TranscriptCue(2, 2_000L, 3_000L, "c"),
        )
        assertEquals(0, activeCueIndex(cs, 0.0))
        assertEquals(0, activeCueIndex(cs, 0.999))
        assertEquals(1, activeCueIndex(cs, 1.0))
        assertEquals(2, activeCueIndex(cs, 2.5))
        assertEquals(2, activeCueIndex(cs, 99.0)) // past the end → last cue
    }

    @Test
    fun `activeCueIndex falls back to the previous cue in a gap`() {
        val cs = listOf(
            TranscriptCue(0, 0L, 1_000L, "a"),
            TranscriptCue(1, 2_000L, 3_000L, "b"),
        )
        assertEquals(0, activeCueIndex(cs, 1.5)) // gap → previous cue (desktop)
        assertEquals(1, activeCueIndex(cs, 2.5))
    }

    @Test
    fun `activeCueIndex clamps to the first cue before playback starts`() {
        val cs = listOf(TranscriptCue(0, 500L, 1_500L, "a"))
        assertEquals(0, activeCueIndex(cs, 0.2))
        assertEquals(0, activeCueIndex(cs, 0.0))
        assertEquals(-1, activeCueIndex(emptyList(), 5.0))
    }

    @Test
    fun `lookbackCueIndex picks the first cue at or past 30s behind`() {
        val cs = listOf(
            TranscriptCue(0, 0L, 1_000L, "a"),
            TranscriptCue(1, 10_000L, 11_000L, "b"),
            TranscriptCue(2, 20_000L, 21_000L, "c"),
            TranscriptCue(3, 40_000L, 41_000L, "d"),
        )
        assertEquals(2, lookbackCueIndex(cs, 45.0)) // target 15s → cue at 20s
        assertEquals(0, lookbackCueIndex(cs, 25.0)) // target 0 → first cue
        assertEquals(3, lookbackCueIndex(cs, 100.0)) // target beyond last → last
        assertEquals(-1, lookbackCueIndex(emptyList(), 45.0))
    }

    // ---- M:SS–M:SS range formatting ------------------------------------------

    @Test
    fun `formatRangeLabel renders the en-dash range like the desktop`() {
        assertEquals("0:00–0:02", formatRangeLabel(0.0, 2.0))
        assertEquals("1:05–1:35", formatRangeLabel(65.0, 95.0))
        assertEquals("0:59–1:00:01", formatRangeLabel(59.0, 3601.0))
    }

    // ---- default-language pick (plan §2: English default) ---------------------

    @Test
    fun `pickTrack prefers English non-ASR over everything else by default`() {
        val tracks = listOf(
            CaptionTrack("de", "German", "u", isAsr = false),
            CaptionTrack("en", "English (auto)", "u", isAsr = true),
            CaptionTrack("en", "English", "u", isAsr = false),
        )
        assertEquals("en", TranscriptClient.pickTrack(tracks, null)!!.languageCode)
        // non-ASR English wins even when an ASR English exists
        assertFalse(TranscriptClient.pickTrack(tracks, null)!!.isAsr)
    }

    @Test
    fun `pickTrack falls back to English ASR, then to the first track`() {
        val asrOnly = listOf(
            CaptionTrack("de", "German", "u", isAsr = false),
            CaptionTrack("en", "English (auto)", "u", isAsr = true),
        )
        assertEquals("en", TranscriptClient.pickTrack(asrOnly, null)!!.languageCode)

        val noEnglish = listOf(
            CaptionTrack("de", "German", "u", isAsr = false),
            CaptionTrack("fr", "Français", "u", isAsr = false),
        )
        assertEquals("de", TranscriptClient.pickTrack(noEnglish, null)!!.languageCode)
        assertEquals("fr", TranscriptClient.pickTrack(noEnglish, "fr")!!.languageCode)
    }

    // ---- ViewModel: load, follow, highlight CRUD ------------------------------

    @Test
    fun `load surfaces the transcript and saved highlights`() = runBlocking {
        val provider = FakeTranscriptProvider().apply {
            result = TranscriptResult.Success(loadedTranscript())
        }
        val repo = FakeVideoItemRepository().apply {
            seed(
                VideoItem(
                    id = "hl1",
                    kind = "transcript",
                    videoTime = 0.0,
                    timeEnd = 2.0,
                    quote = "first sentence ends here",
                    color = "red",
                    anchor = com.scholiast.android.data.model.TranscriptAnchor(0, 4, 1, 9),
                ),
                VideoItem(id = "note1", kind = "note", videoTime = 5.0), // not a highlight
            )
        }
        val vm = TranscriptViewModel(provider, repo, videoId, url)
        vm.load()

        assertEquals(TranscriptStatus.Ready, vm.state.value.status)
        assertEquals(3, vm.state.value.transcript!!.paragraphs.size)
        assertEquals(listOf("hl1"), vm.state.value.highlights.map { it.id })
        assertEquals(listOf<String?>(null), provider.requestedLangs) // no explicit lang → client's English-default pick
    }

    @Test
    fun `load maps failure results to error statuses`() = runBlocking {
        val provider = FakeTranscriptProvider().apply { result = TranscriptResult.NoCaptions }
        val vm = TranscriptViewModel(provider, FakeVideoItemRepository(), videoId, url)
        vm.load()
        assertEquals(TranscriptStatus.NoCaptions, vm.state.value.status)

        provider.result = TranscriptResult.NetworkError(null)
        vm.load()
        assertTrue(vm.state.value.status is TranscriptStatus.Error)
    }

    @Test
    fun `onTick only writes state when the active cue changes`() = runBlocking {
        val provider = FakeTranscriptProvider().apply { result = TranscriptResult.Success(loadedTranscript()) }
        val vm = TranscriptViewModel(provider, FakeVideoItemRepository(), videoId, url)
        vm.load()

        vm.onTick(0.5)
        assertEquals(0, vm.state.value.activeCueIndex)
        val stateAfterFirstTick = vm.state.value
        vm.onTick(0.9) // same cue → early return, no write
        assertSame(stateAfterFirstTick, vm.state.value)
        vm.onTick(1.5)
        assertEquals(1, vm.state.value.activeCueIndex)
    }

    @Test
    fun `createHighlight saves the desktop-shaped transcript item`() = runBlocking {
        val provider = FakeTranscriptProvider().apply { result = TranscriptResult.Success(loadedTranscript()) }
        val repo = FakeVideoItemRepository()
        val vm = TranscriptViewModel(provider, repo, videoId, url)
        vm.load()

        vm.onParagraphSelection(para(0), 4, 28)
        assertEquals("first sentence ends here", vm.state.value.pendingSelection?.quote)
        val stored = vm.createHighlight("red")

        assertNotNull(stored)
        assertEquals("transcript", stored!!.kind)
        assertEquals(0.0, stored.videoTime, 0.0)          // start of start cue
        assertEquals(2.0, stored.timeEnd!!, 0.0)          // end of end cue (ms → s)
        assertEquals("first sentence ends here", stored.quote)
        assertEquals("red", stored.color)
        assertEquals(
            com.scholiast.android.data.model.TranscriptAnchor(0, 4, 1, 9),
            stored.anchor,
        )
        assertTrue(stored.notes.isEmpty())
        assertEquals(stored, repo.storedItem(stored.id)) // persisted
        assertEquals(listOf(stored), vm.state.value.highlights)
        assertNull("selection cleared after save", vm.state.value.pendingSelection)
    }

    @Test
    fun `createHighlight without a pending selection returns null`() = runBlocking {
        val provider = FakeTranscriptProvider().apply { result = TranscriptResult.Success(loadedTranscript()) }
        val vm = TranscriptViewModel(provider, FakeVideoItemRepository(), videoId, url)
        vm.load()
        assertNull(vm.createHighlight("yellow"))
    }

    @Test
    fun `whole-paragraph tap selects the whole cue range`() = runBlocking {
        val provider = FakeTranscriptProvider().apply { result = TranscriptResult.Success(loadedTranscript()) }
        val vm = TranscriptViewModel(provider, FakeVideoItemRepository(), videoId, url)
        vm.load()

        vm.onParagraphTap(para(1))
        val sel = vm.state.value.pendingSelection
        assertNotNull(sel)
        assertEquals(2, sel!!.startCue)
        assertEquals(2, sel.endCue)
        assertEquals("A second thought?", sel.quote)
        assertEquals("0:02–0:03", vm.pendingRangeLabel())
    }

    @Test
    fun `addReply appends a stamped comment to the highlight`() = runBlocking {
        val provider = FakeTranscriptProvider().apply { result = TranscriptResult.Success(loadedTranscript()) }
        val repo = FakeVideoItemRepository()
        val vm = TranscriptViewModel(provider, repo, videoId, url)
        vm.load()
        vm.onParagraphTap(para(1))
        val item = vm.createHighlight("green")!!

        assertTrue(vm.addReply(item.id, "  Good point  "))
        val stored = repo.storedItem(item.id)!!
        assertEquals(1, stored.notes.size)
        assertEquals("Good point", parseVideoNote(stored.notes[0]).text)
        assertTrue("comment carries its timestamp id", stored.notes[0].contains("<!--timestamp:"))
        assertEquals(1, vm.state.value.highlights.single().notes.size)

        assertFalse(vm.addReply("missing", "nope"))
    }

    @Test
    fun `changeLanguage records the session pref and reloads the transcript`() = runBlocking {
        val provider = FakeTranscriptProvider().apply {
            result = TranscriptResult.Success(loadedTranscript(languageCode = "de"))
        }
        val vm = TranscriptViewModel(provider, FakeVideoItemRepository(), videoId, url)
        vm.load()

        vm.changeLanguage("de")
        assertEquals("de", provider.sessionLang)
        assertEquals(listOf("de"), provider.requestedLangs.filterNotNull())
        assertEquals("de", vm.state.value.transcript!!.languageCode)
    }

    @Test
    fun `refreshHighlights picks up external repository writes`() = runBlocking {
        val provider = FakeTranscriptProvider().apply { result = TranscriptResult.Success(loadedTranscript()) }
        val repo = FakeVideoItemRepository()
        val vm = TranscriptViewModel(provider, repo, videoId, url)
        vm.load()
        assertTrue(vm.state.value.highlights.isEmpty())

        repo.seed(
            VideoItem(
                id = "hl9",
                kind = "transcript",
                videoTime = 1.0,
                timeEnd = 2.0,
                quote = "q",
                color = "yellow",
                anchor = com.scholiast.android.data.model.TranscriptAnchor(1, 0, 1, 5),
            ),
        )
        vm.refreshHighlights()
        assertEquals(listOf("hl9"), vm.state.value.highlights.map { it.id })
    }

    @Test
    fun `seekTo forwards to the registered seek listener`() = runBlocking {
        val provider = FakeTranscriptProvider().apply { result = TranscriptResult.Success(loadedTranscript()) }
        val vm = TranscriptViewModel(provider, FakeVideoItemRepository(), videoId, url)
        val seeks = mutableListOf<Double>()
        vm.seekListener = com.scholiast.android.ui.notes.SeekRequestListener { seeks.add(it) }

        vm.seekTo(12.5)
        assertEquals(listOf(12.5), seeks)
        vm.onHighlightTap(VideoItem(id = "x", kind = "transcript", videoTime = 7.0))
        assertEquals(listOf(12.5, 7.0), seeks)
    }

    // ---- inline repaint ------------------------------------------------------

    @Test
    fun `buildParagraphAnnotated repaints highlight spans at 0-40 alpha`() {
        val item = VideoItem(
            id = "hl1",
            kind = "transcript",
            videoTime = 0.0,
            timeEnd = 2.0,
            quote = "first sentence ends here",
            color = "red",
            anchor = com.scholiast.android.data.model.TranscriptAnchor(0, 4, 1, 9),
        )
        val annotated = buildParagraphAnnotated(para(0), cues, listOf(item), activeCueIndex = -1) { }

        val backgrounds = annotated.spanStyles.filter { it.item.background != Color.Unspecified }
        val ranges = backgrounds.map { it.start to it.end }.toSet()
        // cue 0 [4,18) + cue 1 [19,28) in paragraph coordinates (selection ended at char 28)
        assertEquals(setOf(4 to 18, 19 to 28), ranges)
        backgrounds.forEach {
            assertEquals(HighlightRed.copy(alpha = 0.40f), it.item.background)
        }
        // the paragraph text itself is untouched
        assertEquals(para(0).text, annotated.text)
    }

    @Test
    fun `buildParagraphAnnotated skips overlapping spans after the first painted`() {
        // Desktop `cueInnerHtml`: segments sorted by start; `seg.start < pos` →
        // skip. The earlier-starting highlight keeps its full paint.
        val a = com.scholiast.android.data.model.TranscriptAnchor(0, 2, 0, 12) // [2,12) in cue 0
        val b = com.scholiast.android.data.model.TranscriptAnchor(0, 8, 0, 14) // overlaps [8,12) — skipped
        val items = listOf(
            VideoItem(id = "a", kind = "transcript", videoTime = 0.0, color = "red",
                anchor = a),
            VideoItem(id = "b", kind = "transcript", videoTime = 0.0, color = "green",
                anchor = b),
        )
        val annotated = buildParagraphAnnotated(para(0), cues, items, activeCueIndex = 0) { }

        val backgroundRanges = annotated.spanStyles
            .filter { it.item.background != Color.Unspecified }
            .map { it.start to it.end }
            .toSet()
        assertEquals(setOf(2 to 12), backgroundRanges) // a wins; b's overlap dropped
        val weightRanges = annotated.spanStyles
            .filter { it.item.fontWeight != null }
            .map { it.start to it.end }
            .toSet()
        assertEquals(setOf(0 to 18), weightRanges) // active cue 0's text
    }

    // ---- fakes ---------------------------------------------------------------

    private fun loadedTranscript(languageCode: String = "en"): com.scholiast.android.domain.transcript.LoadedTranscript =
        com.scholiast.android.domain.transcript.LoadedTranscript(
            videoId = videoId,
            languageCode = languageCode,
            tracks = listOf(CaptionTrack(languageCode, languageCode, "u", isAsr = false)),
            cues = cues,
            paragraphs = paragraphs,
        )

    private class FakeTranscriptProvider : TranscriptProvider {
        var result: TranscriptResult = TranscriptResult.NoCaptions
        val requestedLangs = mutableListOf<String?>()
        var sessionLang: String? = null

        override suspend fun getTranscript(videoId: String, preferredLang: String?): TranscriptResult {
            requestedLangs += preferredLang
            return result
        }

        override fun setSessionLanguage(videoId: String, code: String) {
            sessionLang = code
        }
    }

    private class FakeVideoItemRepository(private val pageUrl: String = TEST_URL) : VideoItemRepository {
        val pages = mutableMapOf<String, MutableList<VideoItem>>()
        private val now = AtomicLong(1_000_000_000_000L)

        fun seed(vararg items: VideoItem) {
            pages.putIfAbsent(pageUrl, mutableListOf())
            pages.getValue(pageUrl).addAll(items)
        }

        fun storedItem(id: String): VideoItem? = pages[pageUrl]?.firstOrNull { it.id == id }

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