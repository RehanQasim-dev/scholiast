package com.scholiast.android.player

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
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
 * The YouTube `<video>` element lives inside a cross-origin iframe. Loading with
 * base URL `https://www.youtube.com` aligns the origin and allows reliable IFrame
 * API initialization, postMessage communication, and media playback.
 *
 * ## Lifecycle
 * Call [onHostResume] / [onHostPause] from the host's lifecycle (stops JS timers
 * and video in the background) and [onHostDestroy] when the screen is disposed.
 */
@SuppressLint("SetJavaScriptEnabled")
class PlayerWebView(context: Context) : PlayerBridge {

    private val webView = object : WebView(context) {
        @SuppressLint("ClickableViewAccessibility")
        override fun onTouchEvent(event: android.view.MotionEvent?): Boolean {
            return false
        }
    }

    @Volatile
    private var events: PlayerEvents? = null

    @Volatile
    private var isPageLoaded = false

    private val pendingCommands = mutableListOf<String>()

    init {
        WebView.setWebContentsDebuggingEnabled(true)
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        webView.layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            databaseEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = true
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = true
            allowFileAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun getDefaultVideoPoster(): Bitmap? {
                return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
            }
        }
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                isPageLoaded = true
                flushPendingCommands()
            }

            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?,
            ): WebResourceResponse? {
                val url = request?.url?.toString() ?: return null
                if (request.isForMainFrame) {
                    return null
                }
                if (url.contains("youtube.com/embed/") || url.contains("youtube-nocookie.com/embed/")) {
                    try {
                        val connection = (java.net.URL(url).openConnection() as java.net.HttpURLConnection).apply {
                            requestMethod = "GET"
                            request.requestHeaders?.forEach { (k, v) ->
                                if (!k.equals("Accept-Encoding", ignoreCase = true)) {
                                    setRequestProperty(k, v)
                                }
                            }
                            setRequestProperty("Accept-Encoding", "gzip, deflate")
                            connectTimeout = 8000
                            readTimeout = 8000
                        }
                        if (connection.responseCode == 200) {
                            val rawStream = connection.inputStream
                            val encodingHeader = connection.contentEncoding ?: ""
                            val inputStream = when {
                                encodingHeader.contains("gzip", ignoreCase = true) -> java.util.zip.GZIPInputStream(rawStream)
                                encodingHeader.contains("deflate", ignoreCase = true) -> java.util.zip.InflaterInputStream(rawStream)
                                else -> rawStream
                            }
                            var html = inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                            val cssToInject = """
                                <style id="scholiast-cleaner">
                                    .ytp-chrome-top,
                                    .ytp-chrome-bottom,
                                    .ytp-watermark,
                                    .ytp-pause-overlay,
                                    .ytp-pause-overlay-container,
                                    .ytp-gradient-top,
                                    .ytp-gradient-bottom,
                                    .ytp-show-cards-title,
                                    .ytp-title,
                                    .ytp-title-channel,
                                    .ytp-title-link,
                                    .ytp-title-text,
                                    .ytp-ce-element,
                                    .ytp-ce-covering-overlay,
                                    .ytp-cards-teaser,
                                    .ytp-endscreen-content,
                                    .html5-endscreen,
                                    .ytp-contextmenu,
                                    .ytp-impression-link,
                                    .ytp-paid-content-overlay,
                                    .ytp-cairo-refresh-signature-moments,
                                    .ytp-share-button,
                                    .ytp-watch-later-button,
                                    .ytp-copylink-button,
                                    .ytp-overflow-button,
                                    .ytp-more-videos-view,
                                    .ytp-upnext,
                                    a.ytp-title-link,
                                    a.ytp-watermark,
                                    .ytp-tooltip,
                                    .ytp-videowall,
                                    .ytp-autonav-endscreen-upnext-container,
                                    .ytp-bezel,
                                    .ytp-bezel-text-wrapper,
                                    .ytp-fullscreen-grid,
                                    .ytp-fullscreen-grid-percentage,
                                    .ytp-featured-product,
                                    .ytp-merch-shelf,
                                    .ytp-popup,
                                    .ytp-menu-container,
                                    .ytp-skip-intro-button,
                                    .ytp-cards-button,
                                    .ytp-multicam-button,
                                    .ytp-remote-button,
                                    .ytp-size-button,
                                    .ytp-subtitles-button,
                                    .ytp-player-content,
                                    .ytp-flyout-cta,
                                    .ytp-suggested-action-badge,
                                    .ytp-youtube-button {
                                        display: none !important;
                                        opacity: 0 !important;
                                        visibility: hidden !important;
                                        pointer-events: none !important;
                                    }
                                    /* Raise captions above our bottom control row; transform
                                       composes with YouTube's inline positioning, so it wins
                                       without fighting it. */
                                    .ytp-caption-window-container { transform: translateY(-56px) !important; }
                                    ::cue {
                                        color: #ffffff !important;
                                        background-color: rgba(8, 8, 12, 0.88) !important;
                                        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95) !important;
                                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
                                        font-size: 16px !important;
                                        font-weight: 600 !important;
                                        line-height: 1.35 !important;
                                    }
                                    .caption-window, .ytp-caption-window-bottom, .ytp-caption-segment {
                                        color: #ffffff !important;
                                        background: rgba(8, 8, 12, 0.88) !important;
                                        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.95) !important;
                                        border-radius: 4px !important;
                                        font-size: 16px !important;
                                        font-weight: 600 !important;
                                    }
                                </style>
                            """.trimIndent()
                            // Runs before YouTube's player boots: the stylesheet alone loses
                            // races once YT re-parents/recreates its overlay DOM, so this
                            // keeps re-hiding denylist nodes and restores the <style> if YT
                            // strips it. Plain ES5, no template literals — it lives inside a
                            // Kotlin raw string, so `$` and backticks are off-limits here.
                            val jsToInject = """
                                <script>
                                (function () {
                                  try {
                                    var SEL = [
                                      '.ytp-chrome-top',
                                      '.ytp-chrome-bottom',
                                      '.ytp-watermark',
                                      '.ytp-pause-overlay',
                                      '.ytp-pause-overlay-container',
                                      '.ytp-gradient-top',
                                      '.ytp-gradient-bottom',
                                      '.ytp-show-cards-title',
                                      '.ytp-title',
                                      '.ytp-title-channel',
                                      '.ytp-title-link',
                                      '.ytp-title-text',
                                      '.ytp-ce-element',
                                      '.ytp-ce-covering-overlay',
                                      '.ytp-cards-teaser',
                                      '.ytp-endscreen-content',
                                      '.html5-endscreen',
                                      '.ytp-contextmenu',
                                      '.ytp-impression-link',
                                      '.ytp-paid-content-overlay',
                                      '.ytp-cairo-refresh-signature-moments',
                                      '.ytp-share-button',
                                      '.ytp-watch-later-button',
                                      '.ytp-copylink-button',
                                      '.ytp-overflow-button',
                                      '.ytp-more-videos-view',
                                      '.ytp-upnext',
                                      'a.ytp-title-link',
                                      'a.ytp-watermark',
                                      '.ytp-tooltip',
                                      '.ytp-videowall',
                                      '.ytp-autonav-endscreen-upnext-container',
                                      '.ytp-bezel',
                                      '.ytp-bezel-text-wrapper',
                                      '.ytp-fullscreen-grid',
                                      '.ytp-fullscreen-grid-percentage',
                                      '.ytp-featured-product',
                                      '.ytp-merch-shelf',
                                      '.ytp-popup',
                                      '.ytp-menu-container',
                                      '.ytp-skip-intro-button',
                                      '.ytp-cards-button',
                                      '.ytp-multicam-button',
                                      '.ytp-remote-button',
                                      '.ytp-size-button',
                                      '.ytp-subtitles-button',
                                      '.ytp-player-content',
                                      '.ytp-flyout-cta',
                                      '.ytp-suggested-action-badge',
                                      '.ytp-youtube-button'
                                    ];
                                    var STYLE_ID = 'scholiast-cleaner';
                                    var FLAG = 'data-scholiast-hidden';
                                    var FALLBACK_RULE = SEL.join(',') +
                                      ' { display: none !important; opacity: 0 !important;' +
                                      ' visibility: hidden !important; pointer-events: none !important; }';
                                    // This script is injected right after the <style>, so the
                                    // seed stylesheet exists now — keep its full text (captions
                                    // included) to restore verbatim if YT removes it later.
                                    var seed = null;
                                    try { seed = document.getElementById(STYLE_ID); } catch (e) {}
                                    var CSS_TEXT = (seed && seed.textContent) ? seed.textContent : FALLBACK_RULE;

                                    function ensureStyle() {
                                      try {
                                        if (!document.getElementById(STYLE_ID)) {
                                          var s = document.createElement('style');
                                          s.id = STYLE_ID;
                                          s.textContent = CSS_TEXT;
                                          (document.head || document.documentElement).appendChild(s);
                                        }
                                      } catch (e) {}
                                    }

                                    function sweep() {
                                      try {
                                        ensureStyle();
                                        for (var i = 0; i < SEL.length; i++) {
                                          var nodes = null;
                                          try { nodes = document.querySelectorAll(SEL[i]); } catch (e) { continue; }
                                          if (!nodes) continue;
                                          for (var j = 0; j < nodes.length; j++) {
                                            var n = nodes[j];
                                            try {
                                              if (n.hasAttribute(FLAG)) continue;
                                              n.style.display = 'none';
                                              n.setAttribute(FLAG, '1');
                                            } catch (e) {}
                                          }
                                        }
                                      } catch (e) {}
                                    }

                                    sweep();
                                    try {
                                      var mo = new MutationObserver(function () { sweep(); });
                                      mo.observe(document.documentElement, { childList: true, subtree: true });
                                    } catch (e) {}
                                    try { setInterval(sweep, 500); } catch (e) {}
                                  } catch (e) {}
                                })();
                                </script>
                            """.trimIndent()
                            html = if (html.contains("<head>", ignoreCase = true)) {
                                html.replaceFirst("(?i)<head>".toRegex(), "<head>$cssToInject$jsToInject")
                            } else {
                                cssToInject + jsToInject + html
                            }
                            return WebResourceResponse(
                                "text/html",
                                "UTF-8",
                                java.io.ByteArrayInputStream(html.toByteArray(Charsets.UTF_8)),
                            )
                        }
                    } catch (e: Exception) {
                        return null
                    }
                }
                return null
            }
        }
        webView.addJavascriptInterface(JsBridge(), "ScholiastBridge")
        loadPlayerHtml(context)
    }

    private fun loadPlayerHtml(context: Context) {
        val html = try {
            context.assets.open("player.html").bufferedReader().use { it.readText() }
        } catch (e: Exception) {
            ""
        }
        webView.loadDataWithBaseURL(
            "https://scholiast.app/",
            html,
            "text/html",
            "UTF-8",
            null,
        )
    }

    private fun flushPendingCommands() {
        webView.post {
            val copy = synchronized(pendingCommands) {
                val list = ArrayList(pendingCommands)
                pendingCommands.clear()
                list
            }
            copy.forEach { js ->
                webView.evaluateJavascript(js, null)
            }
        }
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

    override fun setCaptions(enabled: Boolean) {
        eval("commandSetCaptions($enabled)")
    }

    override fun captureFrame() {
        eval("commandCaptureFrame()")
    }

    /** Pause video and WebView when the host screen is paused. */
    fun onHostPause() {
        pause()
        webView.onPause()
    }

    /** Resume WebView when the host screen is resumed. */
    fun onHostResume() {
        webView.onResume()
    }

    /** Tear down. Must be called before the host is destroyed (leaks otherwise). */
    fun onHostDestroy() {
        webView.removeJavascriptInterface("ScholiastBridge")
        webView.stopLoading()
        webView.destroy()
    }

    /** `evaluateJavascript` must run on the main thread; queues if the page hasn't finished loading. */
    private fun eval(js: String) {
        webView.post {
            if (!isPageLoaded) {
                synchronized(pendingCommands) {
                    pendingCommands.add(js)
                }
            } else {
                webView.evaluateJavascript(js, null)
            }
        }
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