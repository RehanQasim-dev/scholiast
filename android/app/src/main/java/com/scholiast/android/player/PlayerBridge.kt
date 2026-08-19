package com.scholiast.android.player

/**
 * The player bridge contract (plan §3.4): events in (JS → Kotlin) and commands
 * out (Kotlin → JS). The JS side exposes these as the `ScholiastBridge` object
 * in `assets/player.html`; the exact wire format is documented there.
 *
 * ## Events in (JS → Kotlin)
 * | JS call | Kotlin method | Notes |
 * |---|---|---|
 * | `onPlayerReady()` | [PlayerEvents.onPlayerReady] | IFrame API `onReady` |
 * | `onStateChange(String)` | [PlayerEvents.onStateChange] | YT codes −1..5 |
 * | `onError(String)` | [PlayerEvents.onError] | 2, 5, 100, 101, 150 |
 * | `onTimeUpdate(String)` | [PlayerEvents.onTimeUpdate] | 250 ms interval while playing |
 * | `onDuration(String)` | [PlayerEvents.onDuration] | |
 * | `onTitle(String)` | [PlayerEvents.onTitle] | `getVideoData().title` |
 * | `onCaptionsAvailable(String)` | [PlayerEvents.onCaptionsAvailable] | best-effort |
 * | `onCaptureResult(String)` | [PlayerEvents.onCaptureResult] | JSON `{dataUrl,w,h,error}` |
 *
 * Every `@JavascriptInterface` method takes a **single String** (multi-arg JS→Java
 * calls are comma-joined into one string, which is fragile for base64 data URLs).
 * `onCaptureResult` therefore carries a JSON payload parsed on the Kotlin side.
 *
 * ## Commands out (Kotlin → JS)
 * [PlayerBridge.loadVideo], [PlayerBridge.seekTo], [PlayerBridge.play],
 * [PlayerBridge.pause], [PlayerBridge.setRate], [PlayerBridge.setVolume],
 * [PlayerBridge.captureFrame] — dispatched by [PlayerWebView] via
 * `evaluateJavascript` to the `command*` functions in `player.html`.
 */
interface PlayerEvents {

    /** IFrame API `onReady` fired; the player accepts commands. */
    fun onPlayerReady()

    /**
     * IFrame API state change. Codes: −1 UNSTARTED, 0 ENDED, 1 PLAYING,
     * 2 PAUSED, 3 BUFFERING, 5 CUED.
     */
    fun onStateChange(state: Int)

    /**
     * IFrame API error. Codes: 2 invalid parameter, 5 HTML5 player,
     * 100 video not found, 101 / 150 embed not allowed.
     */
    fun onError(code: Int)

    /** Current playback position in seconds (250 ms cadence while playing). */
    fun onTimeUpdate(timeSeconds: Double)

    /** Video duration in seconds (0 until known). */
    fun onDuration(durationSeconds: Double)

    /** Video title from `getVideoData().title`. */
    fun onTitle(title: String)

    /** Best-effort caption availability (Task 12/13's innertube is authoritative). */
    fun onCaptionsAvailable(available: Boolean)

    /**
     * Result of a [PlayerBridge.captureFrame] request. Exactly one of
     * [dataUrl] (non-null, JPEG data URL, ≤1280px wide) or [error] (non-null:
     * `capture-unavailable`, `black`, `tainted`, …) is set.
     */
    fun onCaptureResult(dataUrl: String?, width: Int, height: Int, error: String?)
}

/**
 * Commands out (Kotlin → JS) plus the event-listener wiring. Implemented by
 * [PlayerWebView]; unit tests use a fake implementing this interface.
 */
interface PlayerBridge {

    /** Register the sink for [PlayerEvents] (the ViewModel). */
    fun setEventsListener(listener: PlayerEvents?)

    /** Swap the player to another video (same WebView instance is reused). */
    fun loadVideo(videoId: String)

    /** Seek to [seconds], clamped natively by the ViewModel to [0, duration]. */
    fun seekTo(seconds: Double)

    fun play()

    fun pause()

    /** Playback rate (0.75, 1, 1.25, 1.5, 2 …). */
    fun setRate(rate: Double)

    /** Volume 0–100. */
    fun setVolume(percent: Int)

    /**
     * Pause + draw the current frame to a canvas (JPEG 0.8, ≤1280px) and report
     * via [PlayerEvents.onCaptureResult]. Errors: `black` (DRM/tainted frame),
     * `tainted` (SecurityError), `capture-unavailable` (not ready).
     */
    fun captureFrame()
}