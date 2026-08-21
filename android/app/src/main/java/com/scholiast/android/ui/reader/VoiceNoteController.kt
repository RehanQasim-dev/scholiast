package com.scholiast.android.ui.reader

import com.scholiast.android.data.model.PageHighlight
import com.scholiast.android.data.notes.makeVideoNote
import com.scholiast.android.domain.transcribe.TranscriptionResult
import com.scholiast.android.ui.voice.RecorderState
import com.scholiast.android.ui.voice.VoiceRecorder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Where a voice note will attach: the highlight the user had selected when the
 * mic was pressed. The page url is the controller host's concern (the reader
 * screen has exactly one), so only the highlight id travels.
 */
data class HighlightDraftTarget(val highlightId: String)

/**
 * The voice-note flow's state (plan §5.6). Idle → Recording(elapsed) →
 * Transcribing → DraftReady(target, text) — or Error(message) from either the
 * recorder (permission/mic) or a transcriber failure; Error keeps the recorded
 * samples so [VoiceNoteController.retry] can rerun transcription without
 * re-recording. DraftReady hands the transcript to the comment editor; the
 * draft also lands in [VoiceNoteController.drafts] so a dismissed sheet can
 * restore it for the rest of the session.
 */
sealed interface VoicePhase {
    data object Idle : VoicePhase

    /** Mic open; [elapsedMs] is wall-clock recording time (drives mm:ss). */
    data class Recording(val elapsedMs: Long) : VoicePhase

    /** Samples captured, transcriber running. */
    data object Transcribing : VoicePhase

    /** Text ready — open the editor pre-filled with [text]. */
    data class DraftReady(val target: HighlightDraftTarget, val text: String) : VoicePhase

    /** Recorder or transcriber failed; Retry/Discard live in the bubble. */
    data class Error(val message: String) : VoicePhase
}

/**
 * Orchestrates the reader's speak-a-note flow (Task 30 / plan §5.6): Task 09's
 * tap-to-toggle recorder plus the SAME transcriber chain the player's comment
 * editor uses (`SpeechDependencies.registry(...).forAddComment()` — settings
 * preference → Gemini → Groq → local FUTO; cloud-offline falls through to the
 * local engine automatically). The chain itself is injected as the [transcribe]
 * lambda so this class stays pure JVM and unit-testable; production wiring
 * lives in `ReaderVoiceIntegration`.
 *
 * Session drafts live here: `drafts[highlightId] = text` is written on every
 * DraftReady and survives sheet dismissal until the note is saved
 * ([clearDraft]). A fresh [start] for the same target overwrites its draft on
 * success (last recording wins); a failed/discard take leaves kept drafts
 * alone.
 *
 * Deliberately synchronous-friendly: all public methods are plain calls and
 * phase updates happen inline on the emitting thread, so tests drive the whole
 * machine with a fake recorder/transcriber under `Dispatchers.Unconfined` and
 * no coroutines-test library (same posture as PlayerViewModelTest).
 */
class VoiceNoteController(
    private val scope: CoroutineScope,
    private val recorder: VoiceRecorder,
    /** Samples in → typed result out. Never throws for expected failures. */
    private val transcribe: suspend (FloatArray) -> TranscriptionResult,
) {

    private val _phase = MutableStateFlow<VoicePhase>(VoicePhase.Idle)
    val phase: StateFlow<VoicePhase> = _phase.asStateFlow()

    private val _drafts = MutableStateFlow<Map<String, String>>(emptyMap())
    val drafts: StateFlow<Map<String, String>> = _drafts.asStateFlow()

    /** Pass-through of the raw recorder state for hosts rendering a MicButton. */
    val recorderState: StateFlow<RecorderState> get() = recorder.state

    private var target: HighlightDraftTarget? = null
    private var pendingSamples: FloatArray? = null
    private var observeJob: Job? = null
    private var transcribeJob: Job? = null

    /**
     * Start recording for [target]. No-op while a recording/transcription is
     * already running; allowed from Idle and from Error (fresh session).
     */
    fun start(newTarget: HighlightDraftTarget) {
        when (_phase.value) {
            is VoicePhase.Recording, is VoicePhase.Transcribing -> return
            else -> Unit
        }
        cancelJobs()
        pendingSamples = null
        target = newTarget
        observeJob = scope.launch {
            recorder.state.collect { state ->
                when (state) {
                    is RecorderState.Recording ->
                        _phase.value = VoicePhase.Recording(state.elapsedMs)
                    is RecorderState.Error -> {
                        // Keep collecting: the next start()'s Recording updates
                        // must still map (a fresh session follows a failure).
                        pendingSamples = null
                        _phase.value = VoicePhase.Error(state.message)
                    }
                    else -> Unit
                }
            }
        }
        recorder.start(scope)
    }

    /**
     * Tap-to-toggle stop: capture samples and run the transcriber. An empty
     * recording surfaces as [VoicePhase.Error] ("nothing recorded") rather
     * than silently doing nothing.
     */
    fun stop() {
        if (_phase.value !is VoicePhase.Recording) return
        cancelJobs()
        beginTranscription(recorder.stop())
    }

    /**
     * Rerun transcription over the retained samples after a failure — no
     * re-recording, nothing lost. With nothing retained, unwind to Idle.
     */
    fun retry() {
        val samples = pendingSamples ?: run { _phase.value = VoicePhase.Idle; return }
        cancelJobs()
        beginTranscription(samples)
    }

    /**
     * Abandon the current take (bubble Discard, sheet-mic swipe-cancel): drop
     * retained samples and unwind to Idle. Kept session drafts are untouched —
     * failing/discard one recording must never destroy an earlier draft.
     */
    fun discard() {
        cancelJobs()
        pendingSamples = null
        recorder.cancel()
        _phase.value = VoicePhase.Idle
    }

    /** Abort a running capture without touching kept session drafts. */
    fun cancelCapture() {
        cancelJobs()
        pendingSamples = null
        recorder.cancel()
        if (_phase.value !is VoicePhase.DraftReady) _phase.value = VoicePhase.Idle
    }

    /**
     * Re-emit [VoicePhase.DraftReady] from a kept session draft — "reopening a
     * thread restores draft text into the editor box" (plan §5.6). False when
     * no draft exists for [target] (caller starts a fresh recording instead).
     */
    fun reopenDraft(target: HighlightDraftTarget): Boolean {
        val text = _drafts.value[target.highlightId] ?: return false
        if (_phase.value is VoicePhase.Recording || _phase.value is VoicePhase.Transcribing) {
            return false
        }
        this.target = target
        pendingSamples = null
        _phase.value = VoicePhase.DraftReady(target, text)
        return true
    }

    /** The saved draft is persisted — remove it from the session map. */
    fun clearDraft(highlightId: String) {
        _drafts.update { it - highlightId }
    }

    /** A DraftReady was handed to the editor — unwind to Idle (draft stays kept). */
    fun consumeDraft() {
        if (_phase.value is VoicePhase.DraftReady) _phase.value = VoicePhase.Idle
    }

    /** Cancel everything and release the recorder (host is going away). */
    fun shutdown() {
        cancelJobs()
        recorder.cancel()
    }

    private fun beginTranscription(samples: FloatArray) {
        if (samples.isEmpty()) {
            pendingSamples = null
            _phase.value = VoicePhase.Error("Nothing recorded — try again.")
            return
        }
        pendingSamples = samples
        _phase.value = VoicePhase.Transcribing
        transcribeJob = scope.launch {
            when (val result = transcribe(samples)) {
                is TranscriptionResult.Success -> {
                    val t = target
                    if (t == null) {
                        _phase.value = VoicePhase.Idle
                        return@launch
                    }
                    pendingSamples = null
                    _drafts.update { it + (t.highlightId to result.text) }
                    _phase.value = VoicePhase.DraftReady(t, result.text)
                }
                is TranscriptionResult.Failure ->
                    // Samples stay retained: Retry retranscribes without loss.
                    _phase.value = VoicePhase.Error(result.message)
            }
        }
    }

    private fun cancelJobs() {
        observeJob?.cancel(); observeJob = null
        transcribeJob?.cancel(); transcribeJob = null
    }
}

/**
 * Pure save step for the voice flow (plan §5.5/§5.6): append the confirmed
 * transcript onto a highlight's `notes[]` in the shared chat-message format
 * `"text<!--timestamp:N-->"`, stamping `updatedAt` so sync conflict resolution
 * sees the change. Blank text saves nothing (null). JVM-tested in
 * `VoiceNoteControllerTest` (timestamp parse check).
 */
fun appendVoiceNote(hl: PageHighlight, text: String, now: Long): PageHighlight? {
    val trimmed = text.trim().takeIf { it.isNotEmpty() } ?: return null
    return hl.copy(
        notes = (hl.notes ?: emptyList()) + makeVideoNote(trimmed, now),
        updatedAt = maxOf(now, hl.updatedAt ?: 0L),
    )
}
