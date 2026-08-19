package com.scholiast.android.ui.frame

import androidx.lifecycle.ViewModel
import com.scholiast.android.data.model.FrameImage
import com.scholiast.android.data.model.VideoItem
import com.scholiast.android.data.model.VideoMarkup
import com.scholiast.android.data.normalize.Normalize
import com.scholiast.android.data.notes.VideoItemRepository
import com.scholiast.android.data.notes.makeVideoNote
import com.scholiast.android.player.PlaybackState
import com.scholiast.android.player.PlayerViewModel
import com.scholiast.android.ui.notes.genVideoId
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The frame capture flow (plan §5.7, task 14): pause on capture, draw, save or
 * discard — and in every terminal state, resume playback if it was playing.
 *
 * Holds the [PlayerViewModel] directly (it is pure JVM — see Task 05), drives
 * it with [PlayerViewModel.captureFrame] and reads its synchronous `capture`
 * StateFlow. The screen (which observes `player.capture`) hands results back
 * via [onFrameReady] / [onFrameFailed]; keeping that wiring in the composable
 * preserves Task 05's single-listener bridge design.
 *
 * ## The four comment paths (§5.7.3)
 * | Path | This class |
 * |---|---|
 * | frame + comment (original JPEG) | [save] with an untouched markup + comment |
 * | frame edited + comment (edited JPEG replaces original) | [save] with the composite JPEG + comment |
 * | comment on timestamp, no frame (`kind:"note"`) | [saveNoteOnly] |
 * | transcript highlight + comment | owned by Task 13 — not reimplemented here |
 *
 * State machine: `Idle → Capturing → Drawing → Saving → Saved` (or `Failed`
 * from Capturing / from a save error). Discard returns straight to `Idle`.
 * The frame JPEG never touches the item JSON — [FrameStore] writes
 * `filesDir/frames/<itemId>.jpg` and the item carries only `frame{w,h}`.
 */
class FrameCaptureViewModel(
    private val player: PlayerViewModel,
    private val repository: VideoItemRepository,
    private val store: FrameStore,
    private val ocr: OcrHook = NoopOcrHook,
    private val clock: () -> Long = System::currentTimeMillis,
) : ViewModel() {

    sealed interface FrameUiState {
        data object Idle : FrameUiState

        /** The JS capture is in flight; playback is paused (Task 05 pauses). */
        data object Capturing : FrameUiState

        /** Frame ready; the draw screen is open on it. */
        data class Drawing(val frame: CapturedFrame) : FrameUiState

        /** Capture failed (`black`/`tainted`/`capture-unavailable`) or save failed. */
        data class Failed(val error: String) : FrameUiState

        data object Saving : FrameUiState

        /** Item + file persisted; the screen closes and playback resumes. */
        data object Saved : FrameUiState
    }

    /** A captured frame: the JPEG data URL plus its pixel size. */
    data class CapturedFrame(val dataUrl: String, val w: Int, val h: Int)

    private val _state = MutableStateFlow<FrameUiState>(FrameUiState.Idle)
    val state: StateFlow<FrameUiState> = _state.asStateFlow()

    /** Whether playback was running when the capture started (resume on exit). */
    private var wasPlaying = false

    /** The page key for this video: the normalized watch URL. */
    val url: String
        get() = Normalize.normalizeUrl("https://www.youtube.com/watch?v=${player.state.value.videoId}")

    // --- Capture --------------------------------------------------------------

    /**
     * Request a frame capture: remember whether the video was playing, then
     * pause + capture through Task 05's bridge. The result arrives asynchronously
     * on `player.capture`; the screen forwards it via [onFrameReady] /
     * [onFrameFailed]. Re-entrant calls are ignored while a capture or save is
     * in flight.
     */
    fun startCapture() {
        val current = _state.value
        if (current is FrameUiState.Capturing || current is FrameUiState.Saving) return
        wasPlaying = player.state.value.playback == PlaybackState.PLAYING ||
            player.state.value.playback == PlaybackState.BUFFERING
        _state.value = FrameUiState.Capturing
        player.captureFrame()
    }

    /** The player reported a successful capture (from `CaptureStatus.SUCCESS`). */
    fun onFrameReady(dataUrl: String, w: Int, h: Int) {
        if (_state.value !is FrameUiState.Capturing) return
        _state.value = FrameUiState.Drawing(CapturedFrame(dataUrl, w, h))
    }

    /**
     * The player reported a capture error — DRM/black frame, tainted canvas or
     * "not ready" (Task 05 codes `black`/`tainted`/`capture-unavailable`/
     * `canvas-unavailable`). The screen shows "This video can't be captured";
     * playback resumes (plan §5.7.1).
     */
    fun onFrameFailed(error: String) {
        if (_state.value !is FrameUiState.Capturing) return
        _state.value = FrameUiState.Failed(error)
        resumeIfWasPlaying()
    }

    // --- Save / discard -------------------------------------------------------

    /**
     * Persist the drawn frame: JPEG → [FrameStore], item `kind:"frame"` with
     * `frame{w,h}` + normalized [markup] → repository, then fire the OCR hook
     * (Task 15; failures never fail the save). [jpeg] is the composite the
     * draw screen baked — the ORIGINAL JPEG when nothing was drawn, the
     * edited composite when it was (paths 1 and 2 of §5.7.3). [comment], when
     * non-blank, becomes the thread's first stamped note (path 1/2 with a
     * comment). Playback resumes once the item is stored.
     */
    suspend fun save(
        markup: VideoMarkup,
        jpeg: ByteArray,
        w: Int,
        h: Int,
        comment: String? = null,
    ): VideoItem? {
        val drawing = _state.value as? FrameUiState.Drawing ?: return null
        _state.value = FrameUiState.Saving

        val item = VideoItem(
            id = genVideoId(),
            kind = "frame",
            videoTime = player.state.value.timeSeconds,
            frame = FrameImage(w = w, h = h),
            // The desktop stores markup only when something was drawn
            // (`undefined` otherwise) — an empty markup must not serialize.
            markup = markup.takeIf { it.strokes.isNotEmpty() || it.lines.isNotEmpty() || it.texts.isNotEmpty() || !it.rects.isNullOrEmpty() || !it.arrows.isNullOrEmpty() },
            notes = comment
                ?.takeIf { it.isNotBlank() }
                ?.let { listOf(makeVideoNote(it.trim(), clock())) }
                ?: emptyList(),
        )
        return try {
            store.save(item.id, jpeg)
            val stored = repository.addItem(url, item)
            // OCR is best-effort and never allowed to fail the save (plan: async, low priority).
            runCatching { ocr.run(item.id, store.fileFor(item.id)) }
            _state.value = FrameUiState.Saved
            resumeIfWasPlaying()
            stored
        } catch (e: Exception) {
            _state.value = FrameUiState.Failed("save-failed")
            resumeIfWasPlaying()
            null
        }
    }

    /**
     * Discard the capture: no item, no file, playback resumes (plan §5.7).
     */
    suspend fun discard() {
        if (_state.value !is FrameUiState.Drawing) return
        _state.value = FrameUiState.Idle
        resumeIfWasPlaying()
    }

    /**
     * Path 3 of §5.7.3: a timestamped comment with NO frame (`kind:"note"`).
     * The same item shape Task 06's "new note" writes; implemented here so the
     * capture flow owns all three non-transcript paths. Blank comments are
     * discarded without an item.
     */
    suspend fun saveNoteOnly(comment: String, videoTime: Double): VideoItem? {
        if (comment.isBlank()) {
            _state.value = FrameUiState.Idle
            resumeIfWasPlaying()
            return null
        }
        val item = VideoItem(
            id = genVideoId(),
            kind = "note",
            videoTime = videoTime,
            notes = listOf(makeVideoNote(comment.trim(), clock())),
        )
        val stored = repository.addItem(url, item)
        _state.value = FrameUiState.Saved
        resumeIfWasPlaying()
        return stored
    }

    // --- Helpers --------------------------------------------------------------

    /** Whether the video was playing when this capture started. */
    fun wasPlayingBefore(): Boolean = wasPlaying

    /** Resume playback if the video was playing before the capture. */
    fun resumePlayback() {
        if (wasPlaying) player.play()
    }

    private fun resumeIfWasPlaying() {
        if (wasPlaying) player.play()
    }

    /** Reset to the fresh state (screen closed; next capture starts over). */
    fun clear() {
        wasPlaying = false
        _state.value = FrameUiState.Idle
    }
}