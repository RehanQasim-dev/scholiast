package com.scholiast.android.ui.reader

import com.scholiast.android.data.model.PageHighlight
import com.scholiast.android.data.notes.parseVideoNote
import com.scholiast.android.domain.transcribe.TranscriptionError
import com.scholiast.android.domain.transcribe.TranscriptionResult
import com.scholiast.android.ui.voice.RecorderState
import com.scholiast.android.ui.voice.VoiceRecorder
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for [VoiceNoteController] (Task 30) with a fake recorder and a
 * gate-controlled fake transcriber. The controller's public methods are plain
 * synchronous calls and its scope here is [Dispatchers.Unconfined], so every
 * phase transition lands inline on the test thread — no coroutines-test library
 * needed (same posture as PlayerViewModelTest).
 */
class VoiceNoteControllerTest {

    /** Tap-to-toggle recorder whose state the test drives by hand. */
    private class FakeRecorder : VoiceRecorder {
        private val _state = MutableStateFlow<RecorderState>(RecorderState.Idle)
        override val state: StateFlow<RecorderState> get() = _state

        var samples: FloatArray = FloatArray(0)

        /** Non-null ⇒ the next start() fails like a revoked permission would. */
        var failOnStart: String? = null

        override fun start(scope: CoroutineScope) {
            val failure = failOnStart
            _state.value = if (failure != null) {
                RecorderState.Error(failure)
            } else {
                RecorderState.Recording(0L, 0f)
            }
        }

        override fun stop(): FloatArray {
            _state.value = RecorderState.Stopped(samples)
            return samples
        }

        override fun cancel() {
            _state.value = RecorderState.Idle
        }

        fun emitElapsed(elapsedMs: Long) {
            _state.value = RecorderState.Recording(elapsedMs, 0.5f)
        }
    }

    private fun controller(
        recorder: FakeRecorder,
        transcribe: suspend (FloatArray) -> TranscriptionResult,
    ): VoiceNoteController =
        VoiceNoteController(CoroutineScope(Dispatchers.Unconfined), recorder, transcribe)

    // ---- phase transitions ---------------------------------------------------

    @Test
    fun `phases transition recording - transcribing - draft ready`() {
        val recorder = FakeRecorder().apply { samples = floatArrayOf(0.25f, -0.25f) }
        val gate = CompletableDeferred<Unit>()
        val controller = controller(recorder) { gate.await(); TranscriptionResult.Success(
            source = com.scholiast.android.domain.transcribe.TranscriberSource.GROQ,
            text = "hello from the lecture",
        ) }
        val target = HighlightDraftTarget("h1")

        controller.start(target)
        assertEquals(VoicePhase.Recording(0L), controller.phase.value)
        recorder.emitElapsed(1500L)
        assertEquals(VoicePhase.Recording(1500L), controller.phase.value)

        controller.stop()
        assertEquals(VoicePhase.Transcribing, controller.phase.value)

        gate.complete(Unit)
        assertEquals(VoicePhase.DraftReady(target, "hello from the lecture"), controller.phase.value)
        assertEquals(mapOf("h1" to "hello from the lecture"), controller.drafts.value)

        // Handed to the editor: unwind to Idle but keep the session draft.
        controller.consumeDraft()
        assertEquals(VoicePhase.Idle, controller.phase.value)
        assertTrue(controller.drafts.value.containsKey("h1"))
    }

    // ---- draft survives dismissal ---------------------------------------------

    @Test
    fun `dismiss keeps the draft and reopen restores it into the editor`() {
        val recorder = FakeRecorder().apply { samples = floatArrayOf(0.25f) }
        val controller = controller(recorder) { TranscriptionResult.Success(
            source = com.scholiast.android.domain.transcribe.TranscriberSource.LOCAL,
            text = "kept text",
        ) }
        val target = HighlightDraftTarget("h2")

        controller.start(target)
        controller.stop()
        assertEquals(VoicePhase.DraftReady(target, "kept text"), controller.phase.value)

        // Sheet dismissed (click-away/×): nothing cleared — draft stays.
        assertEquals(mapOf("h2" to "kept text"), controller.drafts.value)
        assertEquals("kept text", controller.drafts.value["h2"])

        // Reopen: DraftReady re-emitted from the map so the box pre-fills.
        assertTrue(controller.reopenDraft(target))
        assertEquals(VoicePhase.DraftReady(target, "kept text"), controller.phase.value)

        // Abandoning a later take must NOT destroy the kept draft either.
        controller.consumeDraft()
        controller.discard()
        assertEquals(VoicePhase.Idle, controller.phase.value)
        assertEquals("kept text", controller.drafts.value["h2"])

        // Only an explicit post-save clear removes it; unknown ids are no-ops.
        assertFalse(controller.reopenDraft(HighlightDraftTarget("missing")))
        controller.clearDraft("h2")
        assertNull(controller.drafts.value["h2"])
    }

    // ---- save formatting --------------------------------------------------------

    @Test
    fun `save appends correctly formatted timestamped note`() {
        val hl = PageHighlight(id = "h1", notes = listOf("first<!--timestamp:111-->"))
        val now = 1_700_000_000_000L

        val updated = appendVoiceNote(hl, "spoken words", now)

        // Appended verbatim-format note + updatedAt stamped for sync merge.
        assertEquals(
            listOf("first<!--timestamp:111-->", "spoken words<!--timestamp:1700000000000-->"),
            updated?.notes,
        )
        assertEquals(now, updated?.updatedAt)
        // Timestamp parse check (the shared chat-message format).
        val parsed = parseVideoNote(updated!!.notes!!.last())
        assertEquals(now, parsed.timestamp)
        assertEquals("spoken words", parsed.text)

        // Blank text saves nothing; highlight without notes gains one entry.
        assertNull(appendVoiceNote(hl, "   ", now))
        assertEquals(
            listOf("fresh<!--timestamp:$now-->"),
            appendVoiceNote(PageHighlight(id = "h9"), "fresh", now)?.notes,
        )
    }

    // ---- error path --------------------------------------------------------------

    @Test
    fun `error surfaces retry without data loss`() {
        val recorder = FakeRecorder().apply { samples = floatArrayOf(0.5f, 0.5f, 0.5f) }
        var result: TranscriptionResult = TranscriptionResult.Failure(
            source = com.scholiast.android.domain.transcribe.TranscriberSource.GROQ,
            error = TranscriptionError.NETWORK,
            message = "offline",
        )
        val received = mutableListOf<FloatArray>()
        val controller = controller(recorder) { samples ->
            received += samples
            result
        }
        val target = HighlightDraftTarget("h3")

        controller.start(target)
        controller.stop()
        // Failure → Error carries the user-facing message; no draft written.
        assertEquals(VoicePhase.Error("offline"), controller.phase.value)
        assertTrue(controller.drafts.value.isEmpty())

        // Retry reruns transcription over the SAME retained samples.
        result = TranscriptionResult.Success(
            source = com.scholiast.android.domain.transcribe.TranscriberSource.LOCAL,
            text = "recovered",
        )
        controller.retry()
        assertEquals(VoicePhase.DraftReady(target, "recovered"), controller.phase.value)
        assertEquals(listOf(recorder.samples, recorder.samples), received)
        assertEquals(mapOf("h3" to "recovered"), controller.drafts.value)

        // Recorder-level failure (permission revoked) surfaces through the
        // recorder's own state and lands in Error.
        controller.discard()
        recorder.failOnStart = "Microphone permission was denied."
        controller.start(target)
        assertEquals(VoicePhase.Error("Microphone permission was denied."), controller.phase.value)
        // Retry with nothing retained unwinds to Idle instead of throwing.
        controller.retry()
        assertEquals(VoicePhase.Idle, controller.phase.value)
        // A fresh start after the failure records again (collector stays alive).
        recorder.failOnStart = null
        controller.start(target)
        assertEquals(VoicePhase.Recording(0L), controller.phase.value)
    }
}
