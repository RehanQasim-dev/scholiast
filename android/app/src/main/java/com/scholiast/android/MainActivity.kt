package com.scholiast.android

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.lifecycle.lifecycleScope
import com.scholiast.android.domain.sync.SyncGraph
import com.scholiast.android.domain.sync.SyncScheduler
import com.scholiast.android.domain.sync.drive.KeystoreKeyProvider
import com.scholiast.android.ui.home.HomeViewModel
import com.scholiast.android.ui.navigation.ScholiastApp
import com.scholiast.android.ui.theme.ScholiastTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    // Task 04 hand-off: the SAME activity-scoped HomeViewModel HomeScreen creates
    // (viewModelStoreOwner = activity), so a share intent lands in the open
    // HomeViewModel even when Home is not the composed destination yet.
    private val homeViewModel: HomeViewModel by viewModels { HomeViewModel.factory(application) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Sync wiring (Task 18): real engine chain (OAuth → Drive → reconcile),
        // the 15-minute periodic chain, one run on app start (deduped against an
        // in-flight run), and recovery of the persisted status record so
        // Home/Settings render it before the first run.
        SyncGraph.wire(this)
        SyncScheduler.schedulePeriodic(this)
        SyncScheduler.enqueueOnAppForeground(this)
        lifecycleScope.launch {
            SyncGraph.repository(this@MainActivity).load()
            KeystoreKeyProvider.unlockForApp(this@MainActivity)
        }

        handleShareIntent(intent)

        enableEdgeToEdge()
        setContent {
            ScholiastTheme {
                ScholiastApp()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleShareIntent(intent)
    }

    /** Cold start (onCreate) and warm (onNewIntent) share forwarding. */
    private fun handleShareIntent(intent: Intent?) {
        if (intent?.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            homeViewModel.parseShareText(intent.getStringExtra(Intent.EXTRA_TEXT))
        }
    }
}