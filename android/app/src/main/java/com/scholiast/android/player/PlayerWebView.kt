package com.scholiast.android.player

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

/**
 * The WebView host for [assets/player.html](player.html). One instance is created
 * per player screen and **reused across videos** — switching videos only calls
 * [loadVideo], never recreates the WebView.
 *
 * ## The bridge
 * - Commands out ([PlayerBridge]) are dispatched via `evaluateJavascript` to the
 *   `command*` functions in `player.html` (posted to the main thread, which
 *   `evaluateJavascript` requires).
 * - Events in arrive on the **JavaBridge thread** through [JsBridge], the
 *   `@JavascriptInterface` object registered as `ScholiastBridge`, and are
 *   forwarded to the [PlayerEvents] listener (the ViewModel) registered via
 *   [setEventsListener].
 *
 * ## Security note (flagged for review)
 * The YouTube `<video>` element lives inside a cross-origin iframe, so reading it
 * from this `file://` page needs the WebView to relax the same-origin policy:
 * `setAllowUniversalAccessFromFileURLs(true)` + `setAllowFileAccessFromFileURLs(true)`
 * are deprecated and grant `file://` pages broad cross-origin access (the standard
 * hack Android YouTube apps use; it is what makes `canvas.drawImage(video)` work
 * and keeps the canvas un-tainted). The page contains no user data and executes
 * only our own `player.html`. If WebViewAssetLoader (https `appassets.androidplatform.net`)
 * is adopted later, these two settings can be dropped.
 *
 * ## Lifecycle
 * Call [onHostResume] / [onHostPause] from the host's lifecycle (stops JS timers
 * and video in the background) and [onHostDestroy] when the screen is disposed.
 */
@SuppressLint("SetJavaScriptEnabled")
class PlayerWebView(context: Context) : PlayerBridge {

    private val webView = WebView(context)

    @Volatile
    private var events: PlayerEvents? = null

    init {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            // Capture needs to reach into the cross-origin YouTube iframe (see note above).
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = true
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = true
            allowFileAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }
        webView.setBackgroundColor(Color.BLACK)
        webView.webViewClient = WebViewClient() // stay on player.html; no navigation away
        webView.addJavascriptInterface(JsBridge(), "ScholiastBridge")
        webView.loadUrl("file:///android_asset/player.html")
    }

    /** The underlying [WebView] for [androidx.compose.ui.viewinterop.AndroidView]. */
    fun asView(): WebView = webView

    override fun setEventsListener(listener: PlayerEvents?) {
        events = listener
    }

    override fun loadVideo(videoId: String) {
        eval("commandLoadVideo(${JSONObject.quote(videoId)})")
    }

    override fun seekTo(seconds: Double) {
        eval("commandSeekTo($seconds)")
    }

    override fun play() {
        eval("commandPlay()")
    }

    override fun pause() {
        eval("commandPause()")
    }

    override fun setRate(rate: Double) {
        eval("commandSetRate($rate)")
    }

    override fun setVolume(percent: Int) {
        eval("commandSetVolume($percent)")
    }

    override fun captureFrame() {
        eval("commandCaptureFrame()")
    }

    /** Pause rendering, JS timers and video when the host screen is paused. */
    fun onHostPause() {
        webView.pauseTimers()
        webView.onPause()
    }

    /** Resume rendering and JS timers. */
    fun onHostResume() {
        webView.resumeTimers()
        webView.onResume()
    }

    /** Tear down. Must be called before the host is destroyed (leaks otherwise). */
    fun onHostDestroy() {
        webView.removeJavascriptInterface("ScholiastBridge")
        webView.stopLoading()
        webView.destroy()
    }

    /** `evaluateJavascript` must run on the main thread. */
    private fun eval(js: String) {
        webView.post { webView.evaluateJavascript(js, null) }
    }

    /**
     * The `@JavascriptInterface` object visible to JS as `ScholiastBridge`.
     * Every method takes a single String (see [PlayerEvents] contract) and runs
     * on the JavaBridge thread.
     */
    inner class JsBridge {

        @JavascriptInterface
        fun onPlayerReady() {
            events?.onPlayerReady()
        }

        @JavascriptInterface
        fun onStateChange(s: String) {
            events?.onStateChange(s.toIntOrNull() ?: -1)
        }

        @JavascriptInterface
        fun onError(s: String) {
            events?.onError(s.toIntOrNull() ?: 2)
        }

        @JavascriptInterface
        fun onTimeUpdate(s: String) {
            events?.onTimeUpdate(s.toDoubleOrNull() ?: 0.0)
        }

        @JavascriptInterface
        fun onDuration(s: String) {
            events?.onDuration(s.toDoubleOrNull() ?: 0.0)
        }

        @JavascriptInterface
        fun onTitle(s: String) {
            events?.onTitle(s)
        }

        @JavascriptInterface
        fun onCaptionsAvailable(s: String) {
            events?.onCaptionsAvailable(s == "true")
        }

        @JavascriptInterface
        fun onCaptureResult(json: String) {
            val obj = try {
                JSONObject(json)
            } catch (e: Exception) {
                return
            }
            val dataUrl = obj.optString("dataUrl").takeIf { it.isNotEmpty() }
            val error = obj.optString("error").takeIf { it.isNotEmpty() }
            events?.onCaptureResult(dataUrl, obj.optInt("w"), obj.optInt("h"), error)
        }
    }
}