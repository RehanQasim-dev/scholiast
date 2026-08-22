package com.scholiast.android.ui.reader

import android.annotation.SuppressLint
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import org.json.JSONArray

/** Callbacks the bridge posts to the main thread; ReaderScreen/ViewModel own the routing. */
interface ReaderBridgeCallbacks {
    fun onReady()
    fun onHighlightCreated(json: String)
    fun onHighlightUpdated(json: String)
    fun onHighlightDeleted(id: String)
    fun onLinkTap(url: String)
    fun onScrollPct(pct: Double)
    fun onSelectionState(json: String?)
}

/**
 * Kotlin↔JS bridge for the WebView reader (Revision B). JS side is the
 * `android-reader` bundle: `window.ReaderAndroid.*` in, `window.AndroidBridge.*` out.
 */
class AndroidBridge(private val mainHandler: Handler = Handler(Looper.getMainLooper())) {

    @Volatile
    var callbacks: ReaderBridgeCallbacks? = null

    @Volatile
    var webView: WebView? = null

    private fun post(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else mainHandler.post(block)
    }

    @JavascriptInterface
    fun onReady() {
        post { callbacks?.onReady() }
    }

    @JavascriptInterface
    fun onHighlightCreated(json: String) {
        post { callbacks?.onHighlightCreated(json) }
    }

    @JavascriptInterface
    fun onHighlightUpdated(json: String) {
        post { callbacks?.onHighlightUpdated(json) }
    }

    @JavascriptInterface
    fun onHighlightDeleted(id: String) {
        post { callbacks?.onHighlightDeleted(id) }
    }

    @JavascriptInterface
    fun onLinkTap(url: String) {
        post { callbacks?.onLinkTap(url) }
    }

    @JavascriptInterface
    fun onScrollPct(pct: Double) {
        post { callbacks?.onScrollPct(pct) }
    }

    @JavascriptInterface
    fun onSelectionState(json: String?) {
        val payload = json?.takeIf { it.isNotBlank() && it != "null" }
        post { callbacks?.onSelectionState(payload) }
    }
}

/**
 * Handles INTO the page: thin evaluateJavascript wrappers over the bundle's
 * `window.ReaderAndroid` API (contract in task-34's LOG.md).
 */
class ReaderWebHandles(
    private val bridge: AndroidBridge,
    private val js: (script: String, onResult: (String?) -> Unit) -> Unit,
) {
    /** evaluateJavascript returns JSON-encoded values — unwrap a quoted string. */
    private fun unwrap(raw: String?): String? {
        if (raw == null || raw == "null") return null
        val trimmed = raw.trim()
        if (trimmed.length >= 2 && trimmed.first() == '"' && trimmed.last() == '"') {
            return try {
                JSONArray("[\"${trimmed.substring(1, trimmed.length - 1)}\"]").getString(0)
            } catch (_: Exception) {
                trimmed.substring(1, trimmed.length - 1)
            }
        }
        return trimmed
    }

    fun paintHighlights(highlightsJson: String) {
        val escaped = highlightsJson.replace("\\", "\\\\").replace("'", "\\'")
        js("try{ReaderAndroid.paintHighlights('$escaped')}catch(e){console.error(e)}") { }
    }

    fun revealHighlight(id: String) {
        val safe = id.replace("'", "\\'")
        js("try{ReaderAndroid.revealHighlight('$safe')}catch(e){console.error(e)}") { }
    }

    fun setReaderTheme(dark: Boolean, fontPx: Int, serif: Boolean, wide: Boolean) {
        js(
            "try{ReaderAndroid.setReaderTheme({dark:$dark,fontPx:$fontPx,serif:$serif,wide:$wide})}catch(e){}",
        ) { }
    }

    fun getArticleText(onResult: (String?) -> Unit) {
        js("try{ReaderAndroid.getArticleText().then(t=>t)}catch(e){null}", onResult)
    }

    /** Returns the created highlight's JSON (or null when nothing was pending). */
    fun commitPending(color: String, onResult: (String?) -> Unit) {
        val safe = color.replace("'", "")
        js("try{(function(){var r=ReaderAndroid.commitPending('$safe');return r===undefined?null:r})()}catch(e){null}", onResult)
    }

    fun scrollToPct(pct: Double) {
        val clamped = pct.coerceIn(0.0, 1.0)
        js("try{window.scrollTo(0,$clamped*(document.documentElement.scrollHeight-window.innerHeight))}catch(e){}") { }
    }
}

private const val READER_CSS_TAG =
    "<link rel=\"stylesheet\" href=\"file:///android_asset/wwwreader/android-reader.css\">"
private const val READER_JS_TAG =
    "<script src=\"file:///android_asset/wwwreader/android-reader.js\"></script>"

/** Injects the reader asset tags before </body> (or appends when no body tag). */
fun injectReaderAssets(rawHtml: String): String {
    return if (rawHtml.contains("</body>", ignoreCase = true)) {
        rawHtml.replaceRange(
            rawHtml.indexOf("</body>", ignoreCase = true),
            rawHtml.length,
            "$READER_CSS_TAG$READER_JS_TAG</body>",
        )
    } else {
        "$rawHtml$READER_CSS_TAG$READER_JS_TAG"
    }
}

/** The WebView host composable is assembled in ReaderScreen via [ReaderWebViewFactory]. */

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ReaderWebView(
    url: String,
    bridge: AndroidBridge,
    handles: ReaderWebHandles,
    modifier: Modifier = Modifier,
    onPageReady: () -> Unit = {},
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val assetJs = remember {
        try { context.assets.open("wwwreader/android-reader.js").bufferedReader().readText() } catch (_: Exception) { "" }
    }
    val assetCss = remember {
        try { context.assets.open("wwwreader/android-reader.css").bufferedReader().readText() } catch (_: Exception) { "" }
    }
    AndroidView(
        factory = { ctx ->
            WebView(ctx).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                setBackgroundColor(0xFF0B0D14.toInt())
                addJavascriptInterface(bridge, "AndroidBridge")
                bridge.webView = this
                webViewClient = object : android.webkit.WebViewClient() {
                    override fun onPageFinished(view: WebView?, finishedUrl: String?) {
                        super.onPageFinished(view, finishedUrl)
                        // Inject CSS.
                        if (assetCss.isNotBlank()) {
                            val escCss = assetCss.replace("\\", "\\\\").replace("`", "\\`").replace("$", "\\$")
                            evaluateJavascript("(function(){var s=document.createElement('style');s.textContent=`$escCss`;document.head.appendChild(s);})();", null)
                        }
                        // Inject JS bundle.
                        if (assetJs.isNotBlank()) {
                            evaluateJavascript(assetJs) { _ -> onPageReady() }
                        }
                    }
                }
                loadUrl(url)
            }
        },
        modifier = modifier,
        update = { view ->
            if (view.url != url) view.loadUrl(url)
        },
    )
}

/**
 * Convenience factory used by ReaderScreen: creates the bridge/handles pair and
 * the AndroidView factory lambda body.
 */
object ReaderWebViewFactory {
    fun create(): Pair<AndroidBridge, (WebView) -> ReaderWebHandles> {
        val bridge = AndroidBridge()
        return bridge to { webView ->
            bridge.webView = webView
            ReaderWebHandles(bridge) { script, onResult ->
                Handler(Looper.getMainLooper()).post {
                    webView.evaluateJavascript(script) { raw -> onResult(unwrapJs(raw)) }
                }
            }
        }
    }

    private fun unwrapJs(raw: String?): String? {
        if (raw == null || raw == "null") return null
        val t = raw.trim()
        if (t.length >= 2 && t.first() == '"' && t.last() == '"') {
            return try {
                JSONArray("[${t}]").getString(0)
            } catch (_: Exception) {
                t.substring(1, t.length - 1)
            }
        }
        return t
    }
}
