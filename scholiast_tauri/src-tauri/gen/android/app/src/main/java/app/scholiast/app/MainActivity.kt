package app.scholiast.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var lastShareHash = 0

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    forwardShareIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    forwardShareIntent(intent)
  }

  /** ACTION_SEND text/plain → scholiast://share?url= VIEW intent, so the
   * deep-link plugin's single pipeline delivers it to the frontend. */
  private fun forwardShareIntent(incoming: Intent?) {
    if (incoming == null) return
    if (incoming.action != Intent.ACTION_SEND) return
    if (incoming.type != "text/plain") return
    val text = incoming.getStringExtra(Intent.EXTRA_TEXT) ?: return
    val hash = text.hashCode()
    if (hash == lastShareHash) return
    val url = SHARE_URL.find(text)?.value ?: return
    lastShareHash = hash
    val view = Intent(
      Intent.ACTION_VIEW,
      Uri.parse("scholiast://share?url=${Uri.encode(url)}"),
    ).setPackage(packageName)
    startActivity(view)
  }

  companion object {
    private val SHARE_URL = Regex("https?://\\S+")
  }
}
