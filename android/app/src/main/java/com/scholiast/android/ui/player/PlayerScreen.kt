package com.scholiast.android.ui.player

import android.app.Activity
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.scholiast.android.player.CaptureState
import com.scholiast.android.player.PlayerWebView
import com.scholiast.android.player.PlayerViewModel
import com.scholiast.android.player.VideoState
import com.scholiast.android.ui.theme.TextSecondary

/**
 * The player screen shell (plan §5.3): the player on the left (landscape) or on
 * top at 16:9 (portrait), with the [panelSlot] — filled by Tasks 06/13 (Notes +
 * Transcript) — docked right (fixed share, min 320dp) or below.
 *
 * One [PlayerWebView] instance is created per screen composition and reused
 * across videos ([PlayerViewModel.loadVideo] just swaps the videoId).
 */
@Composable
fun PlayerScreen(
    videoId: String,
    onBack: () -> Unit,
    panelSlot: @Composable () -> Unit,
    viewModel: PlayerViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val capture by viewModel.capture.collectAsStateWithLifecycle()

    LaunchedEffect(videoId) {
        viewModel.loadVideo(videoId)
    }

    val context = LocalContext.current
    val activity = context as? Activity
    val isLandscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE

    fun toggleFullscreen() {
        val next = !state.isFullscreen
        viewModel.setFullscreen(next)
        activity?.requestedOrientation =
            if (next) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            else ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    }

    fun openInYouTube() {
        context.startActivity(
            Intent(
                Intent.ACTION_VIEW,
                Uri.parse("https://www.youtube.com/watch?v=${state.videoId}"),
            ),
        )
    }

    if (isLandscape) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val panelWidth = (maxWidth * 0.38f).coerceAtLeast(320.dp)
            Row(Modifier.fillMaxSize()) {
                PlayerStage(
                    state = state,
                    capture = capture,
                    viewModel = viewModel,
                    onToggleFullscreen = ::toggleFullscreen,
                    onOpenInYouTube = ::openInYouTube,
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                )
                Box(
                    Modifier
                        .fillMaxHeight()
                        .width(panelWidth),
                ) {
                    panelSlot()
                }
            }
        }
    } else {
        Column(Modifier.fillMaxSize()) {
            PlayerStage(
                state = state,
                capture = capture,
                viewModel = viewModel,
                onToggleFullscreen = ::toggleFullscreen,
                onOpenInYouTube = ::openInYouTube,
                modifier = Modifier.fillMaxWidth().aspectRatio(16f / 9f),
            )
            Box(Modifier.fillMaxWidth().weight(1f)) {
                panelSlot()
            }
        }
    }
}

/**
 * The player region: the WebView host plus its Compose chrome. The WebView is
 * remembered here (one instance per screen, reused across videos) and wired to
 * the ViewModel once via [PlayerViewModel.bind]. Lifecycle-aware: paused when
 * the host pauses, destroyed when the screen leaves composition.
 */
@Composable
private fun PlayerStage(
    state: VideoState,
    capture: CaptureState,
    viewModel: PlayerViewModel,
    onToggleFullscreen: () -> Unit,
    onOpenInYouTube: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val webView = remember { PlayerWebView(context) }

    LaunchedEffect(webView) {
        viewModel.bind(webView)
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner, webView) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> webView.onHostResume()
                Lifecycle.Event.ON_PAUSE -> webView.onHostPause()
                Lifecycle.Event.ON_DESTROY -> webView.onHostDestroy()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            webView.onHostDestroy()
        }
    }

    Box(modifier.background(Color.Black)) {
        AndroidView(
            factory = { webView.asView() },
            modifier = Modifier.fillMaxSize(),
        )
        PlayerChrome(
            state = state,
            capture = capture,
            viewModel = viewModel,
            onToggleFullscreen = onToggleFullscreen,
            onOpenInYouTube = onOpenInYouTube,
            modifier = Modifier.fillMaxSize(),
        )
    }
}

/**
 * Task 05's stub panel — Tasks 06 (Notes timeline) / 13 (Transcript) replace
 * this via [PlayerScreen]'s `panelSlot`. Keeps the M2 voice-edit and M4 frame
 * routes reachable until they land.
 */
@Composable
fun PlayerPanelPlaceholder(
    onOpenVoiceEdit: () -> Unit,
    onOpenFrame: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Notes & Transcript", style = MaterialTheme.typography.titleMedium)
        Text(
            text = "Task 06/13 fill this panel.",
            style = MaterialTheme.typography.bodyMedium,
            color = TextSecondary,
            modifier = Modifier.padding(top = 8.dp),
        )
        Row(Modifier.padding(top = 24.dp)) {
            OutlinedButton(onClick = onOpenVoiceEdit) {
                Icon(Icons.Filled.Mic, contentDescription = null)
                Text("Voice edit", modifier = Modifier.padding(start = 8.dp))
            }
            OutlinedButton(onClick = onOpenFrame, modifier = Modifier.padding(start = 12.dp)) {
                Icon(Icons.Filled.PhotoCamera, contentDescription = null)
                Text("Frame", modifier = Modifier.padding(start = 8.dp))
            }
        }
    }
}