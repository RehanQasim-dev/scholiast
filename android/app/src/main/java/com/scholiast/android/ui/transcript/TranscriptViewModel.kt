package com.scholiast.android.ui.transcript

import androidx.lifecycle.ViewModel
import com.scholiast.android.data.model.TranscriptAnchor
import com.scholiast.android.data.model.VideoItem
import com.scholiast.android.data.notes.VideoItemRepository
import com.scholiast.android.data.notes.makeVideoNote
import com.scholiast.android.domain.transcript.CaptionTrack
import com.scholiast.android.domain.transcript.LoadedTranscript
import com.scholiast.android.domain.transcript.TranscriptClient
import com.scholiast.android.domain.transcript.TranscriptCue
import com.scholiast.android.domain.transcript.TranscriptParagraph
import com.scholiast.android.domain.transcript.TranscriptResult
import com.scholiast.android.ui.notes.SeekRequestListener
import com.scholiast.android.ui.notes.formatVideoTime
import com.scholiast.android.ui.notes.genVideoId
import kotlin.math.max
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** Lookback for the initial scroll: the cue ~30 s behind the current moment
 * (desktop `video-transcript-panel.ts` `LOOKBACK_SECONDS`). */
const val LOOKBACK_SECONDS = 30.0

/** How far the live-follow band may drift before auto-scroll kicks in. */
val FOLLOW_BAND = 0.1..0.8

/** Where the followed cue is brought to (desktop: ~30% from the top). */
const val FOLLOW_TARGET = 0.3

/** Where the initial lookback cue is placed (desktop `scrollToLookback`: 25%). */
const val LOOKBACK_TARGET = 0.25

/** Load state of the transcript panel. */
sealed interface TranscriptStatus {
    data object Loading : TranscriptStatus
    data object NoCaptions : TranscriptStatus
    data class Error(val message: String) : TranscriptStatus
    data object Ready : TranscriptStatus
}

/**
 * A text selection mapped onto the caption track: cue-index + per-cue char
 * offsets, exactly the desktop `offsetWithinCue` convention, plus the trimmed
 * quote text. [quote] is the trimmed selection text (the desktop trims
 * `sel.toString()`); offsets stay on the raw boundaries like the desktop.
 */
data class PendingSelection(
    val startCue: Int,
    val startOffset: Int,
    val endCue: Int,
    val endOffset: Int,
    val quote: String,
)

/** UI state for the transcript panel. */
data class TranscriptUiState(
    val status: TranscriptStatus = TranscriptStatus.Loading,
    val transcript: LoadedTranscript? = null,
    val activeCueIndex: Int = -1,
    val highlights: List<VideoItem> = emptyList(),
    val pendingSelection: PendingSelection? = null,
    val selectionParagraphIndex: Int = -1,
)

// --- Pure mapping helpers (ported from `src/utils/video/video-transcript-panel.ts`) ----

/** Port of `currentCueIndex`: the cue whose [startMs, endMs) contains the
 * current time; before the first cue → 0; in a gap → the previous cue;
 * past the last cue → the last one. `-1` when there are no cues. */
fun activeCueIndex(cues: List<TranscriptCue>, timeSeconds: Double): Int {
    val t = timeSeconds * 1000.0
    for (i in cues.indices) {
        if (t >= cues[i].startMs && t < cues[i].endMs) return i
        if (cues[i].startMs > t) return max(0, i - 1)
    }
    return cues.size - 1
}

/** Port of `scrollToLookback`'s cue pick: the first cue whose start is at or
 * past `time - lookback`, else the last cue. `-1` when there are no cues. */
fun lookbackCueIndex(cues: List<TranscriptCue>, timeSeconds: Double, lookbackSeconds: Double = LOOKBACK_SECONDS): Int {
    if (cues.isEmpty()) return -1
    val target = max(0.0, timeSeconds - lookbackSeconds) * 1000.0
    var idx = 0
    for (i in cues.indices) {
        if (cues[i].startMs >= target) return i
        idx = i
    }
    return idx
}

/** The paragraphs whose `cueRange` covers [cueIndex], if any. */
fun paragraphIndexForCue(paragraphs: List<TranscriptParagraph>, cueIndex: Int): Int? {
    for ((i, p) in paragraphs.withIndex()) {
        if (cueIndex in p.cueRange) return i
    }
    return null
}

/** The cues a paragraph was chunked from, in order (by index membership). */
fun paragraphCues(paragraph: TranscriptParagraph, cues: List<TranscriptCue>): List<TranscriptCue> =
    cues.filter { it.index in paragraph.cueRange }

/** Cumulative char offset of [cueIndex]'s text within the paragraph's joined
 * text (`paragraph.text`), or null when the paragraph doesn't cover it. */
fun cueStartOffsetInParagraph(paragraph: TranscriptParagraph, cues: List<TranscriptCue>, cueIndex: Int): Int? {
    var cursor = 0
    for (c in paragraphCues(paragraph, cues)) {
        if (c.index == cueIndex) return cursor
        cursor += c.text.length + 1
    }
    return null
}

/**
 * Maps a range of the paragraph's joined text ([start, end), paragraph-text
 * offsets) to the desktop anchor model: cue indexes + per-cue char offsets,
 * with the trimmed selection as the quote. A selection boundary landing on a
 * join space belongs to the preceding cue (end-of-cue offset); the repaint
 * clamps offsets into the cue text exactly like the desktop's `cueInnerHtml`,
 * so either attribution paints the same span.
 *
 * Returns null for empty/inverted/whitespace-only selections.
 */
fun mapParagraphRange(
    paragraph: TranscriptParagraph,
    cues: List<TranscriptCue>,
    start: Int,
    end: Int,
): PendingSelection? {
    val s = start.coerceIn(0, paragraph.text.length)
    val e = end.coerceIn(0, paragraph.text.length)
    if (e <= s) return null
    val quote = paragraph.text.substring(s, e).trim()
    if (quote.isEmpty()) return null
    val paraCues = paragraphCues(paragraph, cues)
    if (paraCues.isEmpty()) return null

    var cursor = 0
    var startCue = paraCues.last()
    var startOffset = paraCues.last().text.length
    for (c in paraCues) {
        if (s <= cursor + c.text.length) {
            startCue = c
            startOffset = s - cursor
            break
        }
        cursor += c.text.length + 1
    }

    cursor = 0
    var endCue = paraCues.last()
    var endOffset = paraCues.last().text.length
    for (c in paraCues) {
        if (e <= cursor + c.text.length) {
            endCue = c
            endOffset = e - cursor
            break
        }
        cursor += c.text.length + 1
    }

    return PendingSelection(
        startCue = startCue.index,
        startOffset = startOffset,
        endCue = endCue.index,
        endOffset = endOffset,
        quote = quote,
    )
}

/** `M:SS–M:SS` range label (en dash, desktop style — same as Task 06's
 * `TimestampChip` for transcript items). */
fun formatRangeLabel(startSeconds: Double, endSeconds: Double): String =
    "${formatVideoTime(startSeconds)}–${formatVideoTime(endSeconds)}"

/**
 * Task 12's [TranscriptClient] behind an interface so the panel's ViewModel is
 * unit-testable with a fake (no mocking lib — same pattern as `VideoItemRepository`).
 */
interface TranscriptProvider {
    suspend fun getTranscript(videoId: String, preferredLang: String? = null): TranscriptResult

    /** Per-video-session language preference (plan §2 / §5.6.1). */
    fun setSessionLanguage(videoId: String, code: String)
}

/** The production adapter over Task 12's concrete client. */
class ClientTranscriptProvider(private val client: TranscriptClient) : TranscriptProvider {
    override suspend fun getTranscript(videoId: String, preferredLang: String?): TranscriptResult =
        client.getTranscript(videoId, preferredLang)

    override fun setSessionLanguage(videoId: String, code: String) =
        client.setSessionLanguage(videoId, code)
}

/**
 * The Transcript tab's state holder: fetch via [TranscriptProvider], live-follow
 * cue marking (250 ms `onTick` from the panel; state is only written when the
 * active cue changes), selection → anchor mapping, highlight CRUD via Task 02's
 * repository, and seek forwarding to Task 05's bridge.
 *
 * All mutations are suspend and update [state] in the calling coroutine, so
 * unit tests run deterministically with `runBlocking` (no Main dispatcher).
 */
class TranscriptViewModel(
    private val provider: TranscriptProvider,
    private val repository: VideoItemRepository,
    private val videoId: String,
    private val url: String,
) : ViewModel() {

    private val _state = MutableStateFlow(TranscriptUiState())
    val state: StateFlow<TranscriptUiState> = _state.asStateFlow()

    /** Wired by the hosting screen to the player bridge. */
    var seekListener: SeekRequestListener? = null

    /**
     * Full load: fetch the transcript (session language or Task 12's English-
     * default pick) and the page's saved `kind:"transcript"` items. Repository
     * exposes no Flow, so the panel also calls [refreshHighlights] on resume.
     */
    suspend fun load() {
        _state.value = TranscriptUiState(status = TranscriptStatus.Loading)
        when (val result = provider.getTranscript(videoId)) {
            is TranscriptResult.Success -> {
                _state.value = TranscriptUiState(
                    status = TranscriptStatus.Ready,
                    transcript = result.transcript,
                    highlights = savedHighlights(),
                )
            }
            TranscriptResult.NoCaptions -> _state.value = TranscriptUiState(status = TranscriptStatus.NoCaptions)
            is TranscriptResult.HttpError -> _state.value =
                TranscriptUiState(status = TranscriptStatus.Error("Captions unavailable (HTTP ${result.statusCode})"))
            is TranscriptResult.NetworkError -> _state.value =
                TranscriptUiState(status = TranscriptStatus.Error("Network error — check your connection"))
            is TranscriptResult.ParseError -> _state.value =
                TranscriptUiState(status = TranscriptStatus.Error("Couldn't read the caption track"))
        }
    }

    /** Re-read saved highlights only (tab resume / external writes). */
    suspend fun refreshHighlights() {
        val saved = savedHighlights()
        _state.update { it.copy(highlights = saved) }
    }

    /** Language picker selection: remember per video session and reload. */
    suspend fun changeLanguage(code: String) {
        provider.setSessionLanguage(videoId, code)
        when (val result = provider.getTranscript(videoId, code)) {
            is TranscriptResult.Success -> _state.update {
                it.copy(status = TranscriptStatus.Ready, transcript = result.transcript, activeCueIndex = -1)
            }
            TranscriptResult.NoCaptions -> _state.update { it.copy(status = TranscriptStatus.NoCaptions) }
            is TranscriptResult.HttpError -> _state.update { it.copy(status = TranscriptStatus.Error("Captions unavailable (HTTP ${result.statusCode})")) }
            is TranscriptResult.NetworkError -> _state.update { it.copy(status = TranscriptStatus.Error("Network error — check your connection")) }
            is TranscriptResult.ParseError -> _state.update { it.copy(status = TranscriptStatus.Error("Couldn't read the caption track")) }
        }
    }

    /**
     * Live-follow tick (250 ms poll from the panel). Early-returns when the
     * active cue hasn't changed, so the UI is only touched on cue change
     * (desktop `onPlayback`).
     */
    fun onTick(timeSeconds: Double) {
        val cues = _state.value.transcript?.cues ?: return
        val idx = activeCueIndex(cues, timeSeconds)
        if (idx == _state.value.activeCueIndex) return
        _state.update { it.copy(activeCueIndex = idx) }
    }

    /** Tap-to-select the whole paragraph (plan §5.6.3, stylus-friendly). */
    fun onParagraphTap(paragraph: TranscriptParagraph) {
        onParagraphSelection(paragraph, 0, paragraph.text.length)
    }

    /** Drag-selection end: map the paragraph-text range to cue anchors. */
    fun onParagraphSelection(paragraph: TranscriptParagraph, start: Int, end: Int) {
        val cues = _state.value.transcript?.cues ?: return
        _state.update {
            it.copy(
                pendingSelection = mapParagraphRange(paragraph, cues, start, end),
                selectionParagraphIndex = paragraph.index,
            )
        }
    }

    /** Dismiss the swatch popup (scroll, outside tap, after save). */
    fun clearSelection() {
        _state.update { it.copy(pendingSelection = null) }
    }

    /**
     * Create the `kind:"transcript"` item from the pending selection and save
     * via the repository. `videoTime` = start of the start cue, `timeEnd` = end
     * of the end cue (seconds — the Android cues carry ms), `anchor` =
     * cue-index + per-cue offsets, exactly the desktop `createHighlight` shape.
     * Returns the stored item (with `updatedAt` stamped), or null when there is
     * no pending selection / transcript.
     */
    suspend fun createHighlight(color: String): VideoItem? {
        val sel = _state.value.pendingSelection ?: return null
        val cues = _state.value.transcript?.cues ?: return null
        val startCue = cues.getOrNull(sel.startCue) ?: return null
        val endCue = cues.getOrNull(sel.endCue) ?: return null
        val item = VideoItem(
            id = genVideoId(),
            kind = "transcript",
            videoTime = startCue.startMs / 1000.0,
            timeEnd = endCue.endMs / 1000.0,
            quote = sel.quote,
            color = color,
            anchor = TranscriptAnchor(sel.startCue, sel.startOffset, sel.endCue, sel.endOffset),
            notes = emptyList(),
        )
        val stored = repository.addItem(url, item)
        _state.update {
            it.copy(
                highlights = (it.highlights + stored).sortedBy { h -> h.videoTime },
                pendingSelection = null,
            )
        }
        return stored
    }

    /** Append a comment to [itemId]'s thread (stamped `<!--timestamp:N-->`). */
    suspend fun addReply(itemId: String, text: String): Boolean {
        val current = _state.value.highlights.firstOrNull { it.id == itemId } ?: return false
        val updated = current.copy(
            notes = current.notes + makeVideoNote(text.trim(), System.currentTimeMillis()),
        )
        val stored = repository.updateItem(url, updated) ?: return false
        _state.update {
            it.copy(highlights = it.highlights.map { h -> if (h.id == stored.id) stored else h })
        }
        return true
    }

    /** Forward a chip/`M:SS` tap to the player bridge, if wired. */
    fun seekTo(seconds: Double) {
        seekListener?.seekTo(seconds)
    }

    /** Highlight tap: seek to the range start (the panel opens the sheet). */
    fun onHighlightTap(item: VideoItem) {
        seekTo(item.videoTime)
    }

    /** The `M:SS–M:SS` chip label for the pending selection, or null. */
    fun pendingRangeLabel(): String? {
        val sel = _state.value.pendingSelection ?: return null
        val cues = _state.value.transcript?.cues ?: return null
        val s = cues.getOrNull(sel.startCue) ?: return null
        val e = cues.getOrNull(sel.endCue) ?: return null
        return formatRangeLabel(s.startMs / 1000.0, e.endMs / 1000.0)
    }

    /** Track list for the language picker (empty → picker hidden). */
    fun tracks(): List<CaptionTrack> = _state.value.transcript?.tracks.orEmpty()

    private suspend fun savedHighlights(): List<VideoItem> =
        repository.loadPage(url)?.items.orEmpty()
            .filter { it.kind == "transcript" && it.anchor != null }
            .sortedBy { it.videoTime }
}