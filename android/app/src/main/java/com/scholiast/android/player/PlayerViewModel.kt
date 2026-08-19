package com.scholiast.android.player

import androidx.lifecycle.ViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * Owns playback state ([state]) and the frame-capture flow ([capture]) for the
 * player screen. Implements [PlayerEvents]: the JS side reports into it through
 * the bridge, and commands go out through the [PlayerBridge] registered with
 * [bind].
 *
 * Deliberately **synchronous** (no coroutines, no `viewModelScope`): JS events
 * arrive on the WebView's JavaBridge thread and update the StateFlows directly
 * (`StateFlow.value` is thread-safe). This keeps the class pure JVM — unit tests
 * run it with a fake [PlayerBridge] and plain JUnit4 (the version catalog has no
 * `kotlinx-coroutines-test`).
 *
 * Commands are **not optimistic**: play/pause state follows the JS `onStateChange`
 * event so UI and player can never drift.
 */
class PlayerViewModel : ViewModel(), PlayerEvents {

    private var bridge: PlayerBridge? = null

    private val _state = MutableStateFlow(VideoState())
    val state: StateFlow<VideoState> = _state.asStateFlow()

    private val _capture = MutableStateFlow(CaptureState())
    val capture: StateFlow<CaptureState> = _capture.asStateFlow()

    /** Wire the bridge (the [PlayerWebView]) and register this VM as its event sink. */
    fun bind(bridge: PlayerBridge) {
        this.bridge = bridge
        bridge.setEventsListener(this)
    }

    // ------------------------------ commands out ------------------------------

    /** Load a video into the (reused) player; resets all playback state. */
    fun loadVideo(videoId: String) {
        _state.value = VideoState(videoId = videoId)
        _capture.value = CaptureState()
        bridge?.loadVideo(videoId)
    }

    fun play() {
        bridge?.play()
    }

    fun pause() {
        bridge?.pause()
    }

    /** Play ↔ pause, based on the last known JS state. */
    fun togglePlayback() {
        when (_state.value.playback) {
            PlaybackState.PLAYING, PlaybackState.BUFFERING -> pause()
            else -> play()
        }
    }

    /** Seek, clamped to [0, duration] once the duration is known. */
    fun seekTo(seconds: Double) {
        val duration = _state.value.durationSeconds
        val target = if (duration > 0) seconds.coerceIn(0.0, duration) else seconds.coerceAtLeast(0.0)
        _state.update { it.copy(timeSeconds = target) }
        bridge?.seekTo(target)
    }

    /** Relative seek (−15 / +15). */
    fun skipBy(deltaSeconds: Double) {
        seekTo(_state.value.timeSeconds + deltaSeconds)
    }

    fun setRate(rate: Double) {
        _state.update { it.copy(rate = rate) }
        bridge?.setRate(rate)
    }

    fun setVolume(percent: Int) {
        val clamped = percent.coerceIn(0, 100)
        _state.update { it.copy(volume = clamped) }
        bridge?.setVolume(clamped)
    }

    /**
     * Request a frame capture. Result arrives on [onCaptureResult]; the capture
     * flow goes IDLE → CAPTURING → SUCCESS/FAILED. Ignores re-entrant calls.
     */
    fun captureFrame() {
        if (_capture.value.status == CaptureStatus.CAPTURING) return
        _capture.value = CaptureState(status = CaptureStatus.CAPTURING)
        bridge?.captureFrame()
    }

    /** Reset the capture flow (Task 14 consumes the result, then calls this). */
    fun clearCapture() {
        _capture.value = CaptureState()
    }

    /** Fullscreen (orientation request) flag — owned by the VM so it survives rotation. */
    fun setFullscreen(fullscreen: Boolean) {
        _state.update { it.copy(isFullscreen = fullscreen) }
    }

    // ------------------------------- events in --------------------------------

    override fun onPlayerReady() {
        _state.update { it.copy(playerReady = true) }
    }

    override fun onStateChange(state: Int) {
        val playback = PlaybackState.fromIframeCode(state)
        _state.update { it.copy(playback = playback, error = null) }
    }

    override fun onError(code: Int) {
        _state.update {
            it.copy(playback = PlaybackState.ERROR, error = PlayerError.fromCode(code))
        }
    }

    override fun onTimeUpdate(timeSeconds: Double) {
        if (timeSeconds >= 0) {
            _state.update { it.copy(timeSeconds = timeSeconds) }
        }
    }

    override fun onDuration(durationSeconds: Double) {
        if (durationSeconds > 0) {
            _state.update { it.copy(durationSeconds = durationSeconds) }
        }
    }

    override fun onTitle(title: String) {
        _state.update { it.copy(title = title) }
    }

    override fun onCaptionsAvailable(available: Boolean) {
        _state.update { it.copy(captionsAvailable = available) }
    }

    override fun onCaptureResult(dataUrl: String?, width: Int, height: Int, error: String?) {
        // Ignore results that no longer match an in-flight capture (e.g. after loadVideo).
        if (_capture.value.status != CaptureStatus.CAPTURING) return
        if (dataUrl != null && error == null) {
            _capture.value = CaptureState(
                status = CaptureStatus.SUCCESS,
                dataUrl = dataUrl,
                width = width,
                height = height,
            )
        } else {
            _capture.value = CaptureState(
                status = CaptureStatus.FAILED,
                error = error ?: "capture failed",
            )
        }
    }
}

/** High-level playback state, mapped from the IFrame API codes. */
enum class PlaybackState {
    NOT_READY, UNSTARTED, PLAYING, PAUSED, BUFFERING, CUED, ENDED, ERROR;

    companion object {
        /** IFrame API: −1 UNSTARTED, 0 ENDED, 1 PLAYING, 2 PAUSED, 3 BUFFERING, 5 CUED. */
        fun fromIframeCode(code: Int): PlaybackState = when (code) {
            -1 -> UNSTARTED
            0 -> ENDED
            1 -> PLAYING
            2 -> PAUSED
            3 -> BUFFERING
            5 -> CUED
            else -> UNSTARTED
        }
    }
}

/** Player state consumed by the Compose chrome and the panel. */
data class VideoState(
    val videoId: String = "",
    val playback: PlaybackState = PlaybackState.NOT_READY,
    val timeSeconds: Double = 0.0,
    val durationSeconds: Double = 0.0,
    val title: String = "",
    val rate: Double = 1.0,
    val volume: Int = 100,
    val captionsAvailable: Boolean = false,
    val playerReady: Boolean = false,
    val error: PlayerError? = null,
    val isFullscreen: Boolean = false,
) {
    /** 101 / 150 = embedding disabled — show "can't be played" + open-in-YouTube. */
    val embedBlocked: Boolean
        get() = error != null && error.code in PlayerError.EMBED_DISABLED_CODES
}

/** IFrame API error, with a human message. */
data class PlayerError(val code: Int, val message: String) {
    companion object {
        /** 101 and 150 both mean embedding is disabled for this video. */
        const val EMBED_DISABLED = 101
        val EMBED_DISABLED_CODES = setOf(101, 150)

        fun fromCode(code: Int) = PlayerError(
            code = code,
            message = when (code) {
                2 -> "Invalid video ID or parameter"
                5 -> "HTML5 player error"
                100 -> "Video not found or removed"
                101, 150 -> "Video can't be played in this app"
                else -> "Player error ($code)"
            },
        )
    }
}

/** The frame-capture flow state (Task 14 consumes SUCCESS and calls [PlayerViewModel.clearCapture]). */
data class CaptureState(
    val status: CaptureStatus = CaptureStatus.IDLE,
    val dataUrl: String? = null,
    val width: Int = 0,
    val height: Int = 0,
    val error: String? = null,
)

enum class CaptureStatus { IDLE, CAPTURING, SUCCESS, FAILED }