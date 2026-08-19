package com.scholiast.android.ui.voice

import android.Manifest
import android.app.Application
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import java.io.File
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * Owns the [AndroidVoiceRecorder] for a screen. The recorder is created here (not in a composable)
 * so it — and any in-flight recording — survives a configuration change (rotation). Also owns the
 * things the recorder itself must not: the `RECORD_AUDIO` permission dance (rationale + launcher
 * round-trip) and the video auto-pause/resume callbacks.
 *
 * ## Video auto-pause / resume
 * Task 05's `PlayerBridge` is not built yet, so the ViewModel exposes two settable callbacks:
 *  - [onPauseRequested] — invoked when a recording starts (pause the video).
 *  - [onResumeRequested] — invoked when a recording stops or is cancelled (resume the video).
 * When Task 05 lands, the owning screen can wire these straight into the bridge (e.g.
 * `viewModel.onPauseRequested = bridge::pause`), or an integration pass can call the bridge
 * directly from [toggle]/[cancelRecording].
 *
 * ## Permission flow
 * [toggle] checks `RECORD_AUDIO` first. If missing, it emits [VoiceEvent.RequestPermission]; the
 * screen shows a rationale dialog and launches the system permission request, then reports back
 * via [onPermissionResult]. A denial puts the recorder in [RecorderState.Error] (with a settings
 * link via [VoiceEvent.OpenAppSettings]).
 *
 * ## Max-length guard
 * When the 2-minute limit auto-stops a recording, [VoiceEvent.AutoStopLimitReached] is emitted so
 * the screen can show the friendly toast.
 *
 * ## Samples out
 * On a normal stop, [onSamplesReady] is invoked with the captured [FloatArray] (16 kHz mono
 * floats) after the recorder has been moved to [RecorderState.Processing]. Task 10/11's
 * transcriber consumes it — upload `encodeWav(samples)` for Groq/Gemini, pass the array to the
 * local whisper engine directly — and calls [onTranscriptionDone] to return the recorder to
 * [RecorderState.Idle].
 */
class VoiceRecorderViewModel(
    application: Application,
) : AndroidViewModel(application) {

    /** The recorder; exposed so Task 10/11 can read samples or extend it. */
    val recorder: AndroidVoiceRecorder = AndroidVoiceRecorder(application)

    /** UI state to drive the mic button. */
    val state: StateFlow<RecorderState> = recorder.state

    /** Called when a recording starts — pause the video. */
    var onPauseRequested: (() -> Unit)? = null

    /** Called when a recording stops/cancels — resume the video. */
    var onResumeRequested: (() -> Unit)? = null

    /** Called with the recorded samples after a normal (non-cancelled) stop. */
    var onSamplesReady: ((FloatArray) -> Unit)? = null

    private val _events = MutableSharedFlow<VoiceEvent>(extraBufferCapacity = 1)
    val events: SharedFlow<VoiceEvent> = _events.asSharedFlow()

    /**
     * Tap-to-toggle entry point: tap when idle starts recording, tap again stops it and hands the
     * samples to [onSamplesReady]. Tapping in [RecorderState.Error] retries (re-checks permission).
     */
    fun toggle() {
        when (state.value) {
            is RecorderState.Recording -> stopRecording()
            is RecorderState.Processing -> Unit // transcriber owns the mic state now
            else -> startRecording()
        }
    }

    /** Swipe-down cancel: discard the current recording and resume the video. */
    fun cancelRecording() {
        recorder.cancel()
        onResumeRequested?.invoke()
    }

    /** Report the result of the system permission request launched after [VoiceEvent.RequestPermission]. */
    fun onPermissionResult(granted: Boolean) {
        if (granted) {
            startRecording()
        } else {
            recorder.fail("Microphone permission was denied. Enable it in Settings to use voice.")
            _events.tryEmit(VoiceEvent.ShowPermissionDenied)
        }
    }

    /** Transcriber finished — return the recorder to Idle so the next tap starts fresh. */
    fun onTranscriptionDone() {
        recorder.complete()
    }

    /** Emit a request to open the app's permission settings (from the Error state). */
    fun openSettings() {
        _events.tryEmit(VoiceEvent.OpenAppSettings)
    }

    /** WAV wrapper for Task 10: write samples to `cacheDir/voice/<ts>.wav` and return the file. */
    fun encodeWav(samples: FloatArray): File =
        WavWriter.encodeWav(samples, getApplication<Application>().cacheDir)

    private fun startRecording() {
        if (hasRecordPermission()) {
            recorder.start(viewModelScope)
            onPauseRequested?.invoke()
        } else {
            _events.tryEmit(VoiceEvent.RequestPermission)
        }
    }

    private fun stopRecording() {
        val samples = recorder.stop()
        onResumeRequested?.invoke()
        if (recorder.lastStopWasAuto) {
            _events.tryEmit(VoiceEvent.AutoStopLimitReached)
        }
        recorder.markProcessing()
        onSamplesReady?.invoke(samples)
    }

    private fun hasRecordPermission(): Boolean =
        ContextCompat.checkSelfPermission(
            getApplication<Application>(),
            Manifest.permission.RECORD_AUDIO,
        ) == PackageManager.PERMISSION_GRANTED
}

/** One-shot events the recorder screen acts on (dialogs, toasts, settings intents). */
sealed interface VoiceEvent {
    /** Show a rationale dialog, then launch the `RECORD_AUDIO` permission request. */
    data object RequestPermission : VoiceEvent

    /** The 2-minute max-length guard auto-stopped the recording. Show a friendly toast. */
    data object AutoStopLimitReached : VoiceEvent

    /** Permission was denied — show the app-settings shortcut hint. */
    data object ShowPermissionDenied : VoiceEvent

    /** Open the app's settings page (permission/Settings link from the Error state). */
    data object OpenAppSettings : VoiceEvent
}