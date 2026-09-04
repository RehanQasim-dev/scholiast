package app.scholiast.app

import android.content.Context
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.ActionMode
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

class MainActivity : TauriActivity() {
  override val handleBackNavigation: Boolean = true
  private var lastShareHash = 0

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Ensure app content begins below the status bar and above bottom navigation / Samsung taskbar
    ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content)) { v, insets ->
      val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      v.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom)
      insets
    }

    forwardShareIntent(intent)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun getClipboardText(): String {
        return try {
          val future = CompletableFuture<String>()
          Handler(Looper.getMainLooper()).post {
            try {
              val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
              val clip = clipboard?.primaryClip
              if (clip != null && clip.itemCount > 0) {
                val text = clip.getItemAt(0).coerceToText(this@MainActivity)?.toString() ?: ""
                future.complete(text)
              } else {
                future.complete("")
              }
            } catch (t: Throwable) {
              future.complete("")
            }
          }
          future.get(1500, TimeUnit.MILLISECONDS)
        } catch (e: Throwable) {
          ""
        }
      }
    }, "AndroidBridge")
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    forwardShareIntent(intent)
  }

  /**
   * Suppress the OS-level floating text selection Action Mode (Copy, Share, Select all)
   * so the in-app annotation SwatchPopup is not covered or obstructed.
   */
  override fun onWindowStartingActionMode(callback: ActionMode.Callback?): ActionMode? = null
  override fun onWindowStartingActionMode(callback: ActionMode.Callback?, type: Int): ActionMode? = null

  /** ACTION_SEND text/plain → scholiast://share?url= VIEW intent, so the
   * deep-link plugin's single pipeline delivers it to the frontend. */
  private fun forwardShareIntent(incoming: Intent?) {
    if (incoming == null) return
    if (incoming.action != Intent.ACTION_SEND) return
    val text = incoming.getStringExtra(Intent.EXTRA_TEXT)
      ?: incoming.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
      ?: incoming.dataString
      ?: return
    val hash = text.hashCode()
    if (hash == lastShareHash) return
    val url = SHARE_URL.find(text)?.value ?: return
    lastShareHash = hash
    val view = Intent(
      Intent.ACTION_VIEW,
      Uri.parse("scholiast://share?url=${Uri.encode(url)}"),
    ).setPackage(packageName)
    setIntent(view)
    startActivity(view)
  }

  companion object {
    private val SHARE_URL = Regex("https?://\\S+")
  }
}
