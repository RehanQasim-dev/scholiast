package app.scholiast.app

import android.content.Context
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
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
  /** Set from JS on every selectionchange; read on the UI thread below. */
  @Volatile private var selectionInEditable: Boolean = false

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
    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun setSelectionEditable(editable: Boolean) {
        selectionInEditable = editable
      }
    }, "AndroidSelection")
    // Race-free suppression point: WebView populates the selection menu
    // asynchronously *after* the mode starts, so a one-time clear in
    // onActionModeStarted below can lose to a late repopulation (the
    // recurring overlap). onPrepareActionMode runs after population on
    // every show/invalidate, so the strip here always wins. Editable
    // fields return untouched so copy/paste keeps working there.
    // (Returning false from onCreateActionMode would kill the selection
    // itself — never do that here.)
    webView.setCustomSelectionActionModeCallback(object : ActionMode.Callback {
      override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean = true

      override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean {
        if (!selectionInEditable && menu.size() > 0) {
          menu.clear()
          return true
        }
        return false
      }

      override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean = false

      override fun onDestroyActionMode(mode: ActionMode) {}
    })
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    forwardShareIntent(intent)
  }

  /**
   * Suppress the OS floating text-selection toolbar (Copy, Share, Select
   * all) over article text so the in-app SwatchPopup stays reachable.
   * Emptying the menu (rather than killing the mode) preserves the
   * selection and its handles: Android 6+ does not render an empty floating
   * menu at all. Selections inside editable fields (reply boxes, inputs)
   * keep the system menu so copy/paste keeps working there — JS reports
   * the current selection kind via AndroidSelection.setSelectionEditable.
   *
   * (Returning null from onWindowStartingActionMode was tried before: it
   * does NOT suppress anything, it just declines a *custom* mode and the
   * system builds the default toolbar anyway.)
   */
  override fun onActionModeStarted(mode: ActionMode) {
    if (!selectionInEditable) {
      mode.menu?.clear()
    }
    super.onActionModeStarted(mode)
  }

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
