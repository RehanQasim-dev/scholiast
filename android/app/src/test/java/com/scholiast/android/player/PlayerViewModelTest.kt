package com.scholiast.android.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for [PlayerViewModel] with a fake [PlayerBridge] (Task 05).
 * The ViewModel is deliberately synchronous — events in are plain method calls,
 * commands out are recorded on the fake — so no coroutines test library needed.
 */
class PlayerViewModelTest {

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
            calls += "seekTo:${seconds.trim()}"
        }

        override fun play() {
            calls += "play"
        }

        override fun pause() {
            calls += "pause"
        }

        override fun setRate(rate: Double) {
            calls += "setRate:${rate.trim()}"
        }

        override fun setVolume(percent: Int) {
            calls += "setVolume:$percent"
        }

        override fun captureFrame() {
            calls += "captureFrame"
        }

        private fun Double.trim(): String =
            if (this == this.toLong().toDouble()) this.toLong().toString() else this.toString()
    }

    private fun vm(bridge: FakeBridge = FakeBridge()): Pair<PlayerViewModel, FakeBridge> {
        val viewModel = PlayerViewModel()
        viewModel.bind(bridge)
        return viewModel to bridge
    }

    // ---- loading ------------------------------------------------------------

    @Test
    fun `loadVideo resets state and forwards to bridge`() {
        val (vm, bridge) = vm()
        vm.onStateChange(1) // playing
        vm.onDuration(600.0)
        vm.onTitle("old")

        vm.loadVideo("abc123")

        val s = vm.state.value
        assertEquals("abc123", s.videoId)
        assertEquals(PlaybackState.NOT_READY, s.playback)
        assertEquals(0.0, s.timeSeconds, 1e-9)
        assertEquals(0.0, s.durationSeconds, 1e-9)
        assertEquals("", s.title)
        assertFalse(s.playerReady)
        assertNull(s.error)
        assertEquals(listOf("loadVideo:abc123"), bridge.calls)
        assertEquals(CaptureStatus.IDLE, vm.capture.value.status)
    }

    // ---- JS events in -------------------------------------------------------

    @Test
    fun `onStateChange maps iframe codes to playback states`() {
        val (vm, _) = vm()
        vm.onStateChange(1)
        assertEquals(PlaybackState.PLAYING, vm.state.value.playback)
        vm.onStateChange(2)
        assertEquals(PlaybackState.PAUSED, vm.state.value.playback)
        vm.onStateChange(0)
        assertEquals(PlaybackState.ENDED, vm.state.value.playback)
        vm.onStateChange(3)
        assertEquals(PlaybackState.BUFFERING, vm.state.value.playback)
        vm.onStateChange(-1)
        assertEquals(PlaybackState.UNSTARTED, vm.state.value.playback)
        vm.onStateChange(5)
        assertEquals(PlaybackState.CUED, vm.state.value.playback)
    }

    @Test
    fun `time duration title captions flow into state`() {
        val (vm, _) = vm()
        vm.onPlayerReady()
        vm.onTimeUpdate(12.5)
        vm.onDuration(1200.0)
        vm.onTitle("Lecture 3")
        vm.onCaptionsAvailable(true)

        val s = vm.state.value
        assertTrue(s.playerReady)
        assertEquals(12.5, s.timeSeconds, 1e-9)
        assertEquals(1200.0, s.durationSeconds, 1e-9)
        assertEquals("Lecture 3", s.title)
        assertTrue(s.captionsAvailable)
    }

    @Test
    fun `negative time updates are ignored`() {
        val (vm, _) = vm()
        vm.onTimeUpdate(-1.0)
        assertEquals(0.0, vm.state.value.timeSeconds, 1e-9)
    }

    @Test
    fun `onError 101 maps to embed blocked message`() {
        val (vm, _) = vm()
        vm.onError(101)
        val s = vm.state.value
        assertEquals(PlaybackState.ERROR, s.playback)
        assertEquals(101, s.error?.code)
        assertEquals("Video can't be played in this app", s.error?.message)
        assertTrue(s.embedBlocked)
        vm.onError(150)
        assertTrue(vm.state.value.embedBlocked)
    }

    @Test
    fun `onError 100 maps to not found and is not embed blocked`() {
        val (vm, _) = vm()
        vm.onError(100)
        val s = vm.state.value
        assertEquals(PlaybackState.ERROR, s.playback)
        assertEquals("Video not found or removed", s.error?.message)
        assertFalse(s.embedBlocked)
    }

    @Test
    fun `a later state change clears the error`() {
        val (vm, _) = vm()
        vm.onError(101)
        vm.onStateChange(1)
        assertNull(vm.state.value.error)
        assertEquals(PlaybackState.PLAYING, vm.state.value.playback)
    }

    // ---- commands out -------------------------------------------------------

    @Test
    fun `togglePlayback pauses when playing and plays otherwise`() {
        val (vm, bridge) = vm()
        vm.onStateChange(1)
        vm.togglePlayback()
        assertEquals(listOf("pause"), bridge.calls)

        // State follows JS events (not optimistic): a second toggle before the
        // JS PAUSED event lands still means pause.
        vm.togglePlayback()
        assertEquals(listOf("pause", "pause"), bridge.calls)

        vm.onStateChange(2) // JS confirms PAUSED
        vm.togglePlayback()
        assertEquals(listOf("pause", "pause", "play"), bridge.calls)
    }

    @Test
    fun `commands are not optimistic - state follows JS events`() {
        val (vm, bridge) = vm()
        vm.play()
        assertEquals(listOf("play"), bridge.calls)
        assertEquals(PlaybackState.NOT_READY, vm.state.value.playback)
        vm.onStateChange(1)
        assertEquals(PlaybackState.PLAYING, vm.state.value.playback)
    }

    @Test
    fun `seekTo forwards the clamped value`() {
        val (vm, bridge) = vm()
        vm.onDuration(100.0)
        vm.seekTo(150.0)
        assertEquals(100.0, vm.state.value.timeSeconds, 1e-9)
        assertEquals("seekTo:100", bridge.calls.last())

        vm.seekTo(-5.0)
        assertEquals(0.0, vm.state.value.timeSeconds, 1e-9)
        assertEquals("seekTo:0", bridge.calls.last())

        vm.seekTo(42.0)
        assertEquals(42.0, vm.state.value.timeSeconds, 1e-9)
        assertEquals("seekTo:42", bridge.calls.last())
    }

    @Test
    fun `skipBy seeks relative to current time`() {
        val (vm, bridge) = vm()
        vm.onTimeUpdate(30.0)
        vm.skipBy(-15.0)
        assertEquals(15.0, vm.state.value.timeSeconds, 1e-9)
        assertEquals("seekTo:15", bridge.calls.last())

        vm.skipBy(15.0)
        assertEquals(30.0, vm.state.value.timeSeconds, 1e-9)
        assertEquals("seekTo:30", bridge.calls.last())
    }

    @Test
    fun `setRate updates state and forwards`() {
        val (vm, bridge) = vm()
        vm.setRate(1.5)
        assertEquals(1.5, vm.state.value.rate, 1e-9)
        assertEquals("setRate:1.5", bridge.calls.last())
        vm.setRate(2.0)
        assertEquals(2.0, vm.state.value.rate, 1e-9)
    }

    @Test
    fun `setVolume clamps to 0 to 100`() {
        val (vm, bridge) = vm()
        vm.setVolume(150)
        assertEquals(100, vm.state.value.volume)
        assertEquals("setVolume:100", bridge.calls.last())
        vm.setVolume(-5)
        assertEquals(0, vm.state.value.volume)
    }

    @Test
    fun `setFullscreen toggles the flag`() {
        val (vm, _) = vm()
        vm.setFullscreen(true)
        assertTrue(vm.state.value.isFullscreen)
        vm.setFullscreen(false)
        assertFalse(vm.state.value.isFullscreen)
    }

    // ---- capture flow -------------------------------------------------------

    @Test
    fun `captureFrame transitions capturing to success`() {
        val (vm, bridge) = vm()
        vm.captureFrame()
        assertEquals(CaptureStatus.CAPTURING, vm.capture.value.status)
        assertEquals(listOf("captureFrame"), bridge.calls)

        vm.onCaptureResult("data:image/jpeg;base64,AAAA", 640, 360, null)
        val c = vm.capture.value
        assertEquals(CaptureStatus.SUCCESS, c.status)
        assertEquals("data:image/jpeg;base64,AAAA", c.dataUrl)
        assertEquals(640, c.width)
        assertEquals(360, c.height)
        assertNull(c.error)
    }

    @Test
    fun `captureFrame error result becomes FAILED`() {
        val (vm, _) = vm()
        vm.captureFrame()
        vm.onCaptureResult(null, 0, 0, "black")
        val c = vm.capture.value
        assertEquals(CaptureStatus.FAILED, c.status)
        assertNull(c.dataUrl)
        assertEquals("black", c.error)
    }

    @Test
    fun `re-entrant captureFrame is ignored while capturing`() {
        val (vm, bridge) = vm()
        vm.captureFrame()
        vm.captureFrame()
        assertEquals(1, bridge.calls.count { it == "captureFrame" })
    }

    @Test
    fun `stale capture results are ignored after loadVideo`() {
        val (vm, _) = vm()
        vm.captureFrame()
        vm.loadVideo("other")
        assertEquals(CaptureStatus.IDLE, vm.capture.value.status)
        vm.onCaptureResult("data:image/jpeg;base64,AAAA", 640, 360, null)
        assertEquals(CaptureStatus.IDLE, vm.capture.value.status)
    }

    @Test
    fun `clearCapture resets the flow`() {
        val (vm, _) = vm()
        vm.captureFrame()
        vm.onCaptureResult("data:image/jpeg;base64,AAAA", 640, 360, null)
        assertEquals(CaptureStatus.SUCCESS, vm.capture.value.status)
        vm.clearCapture()
        assertEquals(CaptureStatus.IDLE, vm.capture.value.status)
        assertNull(vm.capture.value.dataUrl)
    }
}