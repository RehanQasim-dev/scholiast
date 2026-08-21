package com.scholiast.android.ui.player

import android.app.Activity
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.net.Uri
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
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
import androidx.compose.foundation.focusable
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.scholiast.android.player.CaptureState
import com.scholiast.android.player.PlaybackPositionStore
import com.scholiast.android.player.PlayerWebView
import com.scholiast.android.player.PlayerViewModel
import com.scholiast.android.player.VideoState
import com.scholiast.android.ui.theme.TextSecondary

import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.input.pointer.pointerInput
import com.scholiast.android.data.normalize.Normalize
import com.scholiast.android.ui.notes.NotesTab
import com.scholiast.android.ui.transcript.TranscriptPanel

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
    viewModel: PlayerViewModel = viewModel(),
    panelSlot: @Composable () -> Unit = {
        PlayerPanel(
            url = Normalize.normalizeUrl("https://www.youtube.com/watch?v=$videoId"),
            viewModel = viewModel,
        )
    },
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val capture by viewModel.capture.collectAsStateWithLifecycle()

    val context = LocalContext.current
    val activity = context as? Activity
    val isLandscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE

    LaunchedEffect(Unit) {
        viewModel.setPositionStore(PlaybackPositionStore.getInstance(context))
    }

    LaunchedEffect(videoId) {
        viewModel.loadVideo(videoId)
    }

    // Immersive system bars: hidden only while fullscreen (swipe reveals them
    // temporarily); restored on dispose so leaving the screen never strands
    // them hidden. WindowInsetsControllerCompat works pre-API-30.
    val view = LocalView.current
    DisposableEffect(state.isFullscreen) {
        val controller = activity?.window?.let { WindowCompat.getInsetsController(it, view) }
        if (controller != null) {
            if (state.isFullscreen) {
                controller.systemBarsBehavior =
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                controller.hide(
                    WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.navigationBars(),
                )
            } else {
                controller.show(
                    WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.navigationBars(),
                )
            }
        }
        onDispose {
            controller?.show(
                WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.navigationBars(),
            )
        }
    }

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

    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        focusRequester.requestFocus()
    }

    val keyModifier = Modifier
        .fillMaxSize()
        .focusRequester(focusRequester)
        .focusable()
        .onPreviewKeyEvent { keyEvent ->
            if (keyEvent.type == KeyEventType.KeyDown) {
                when (keyEvent.key) {
                    Key.Spacebar, Key.K -> {
                        viewModel.togglePlayback()
                        true
                    }
                    Key.DirectionLeft, Key.J -> {
                        viewModel.skipBy(-15.0)
                        true
                    }
                    Key.DirectionRight, Key.L -> {
                        viewModel.skipBy(15.0)
                        true
                    }
                    Key.F -> {
                        toggleFullscreen()
                        true
                    }
                    Key.C -> {
                        viewModel.captureFrame()
                        true
                    }
                    Key.Escape, Key.Back -> {
                        onBack()
                        true
                    }
                    else -> false
                }
            } else {
                false
            }
        }

    var panelWidthRatio by remember { mutableFloatStateOf(0.35f) }

    if (isLandscape) {
        BoxWithConstraints(keyModifier) {
            val totalWidth = maxWidth
            val density = androidx.compose.ui.platform.LocalDensity.current
            val totalPx = with(density) { totalWidth.toPx() }.coerceAtLeast(1f)
            val minPanelDp = 280.dp
            val maxPanelDp = totalWidth * 0.58f
            val currentPanelWidth = (totalWidth * panelWidthRatio).coerceIn(minPanelDp, maxPanelDp)

            if (state.isFullscreen) {
                // Real fullscreen: the stage alone fills the screen — no
                // divider, no notes panel (fullscreen forces sensor-landscape,
                // so the portrait split is never seen in this state).
                PlayerStage(
                    state = state,
                    capture = capture,
                    viewModel = viewModel,
                    onToggleFullscreen = ::toggleFullscreen,
                    onOpenInYouTube = ::openInYouTube,
                    onBack = onBack,
                    modifier = Modifier.fillMaxSize(),
                )
            } else {
                Row(Modifier.fillMaxSize()) {
                    PlayerStage(
                        state = state,
                        capture = capture,
                        viewModel = viewModel,
                        onToggleFullscreen = ::toggleFullscreen,
                        onOpenInYouTube = ::openInYouTube,
                        onBack = onBack,
                        modifier = Modifier.weight(1f).fillMaxHeight(),
                    )
                    SplitPaneDivider(
                        onDragDelta = { deltaPx ->
                            val deltaRatio = -deltaPx / totalPx
                            panelWidthRatio = (panelWidthRatio + deltaRatio).coerceIn(0.18f, 0.58f)
                        },
                        onReset = { panelWidthRatio = 0.35f },
                    )
                    Box(
                        Modifier
                            .fillMaxHeight()
                            .width(currentPanelWidth)
                            .statusBarsPadding(),
                    ) {
                        panelSlot()
                    }
                }
            }
        }
    } else {
        Column(keyModifier.statusBarsPadding()) {
            PlayerStage(
                state = state,
                capture = capture,
                viewModel = viewModel,
                onToggleFullscreen = ::toggleFullscreen,
                onOpenInYouTube = ::openInYouTube,
                onBack = onBack,
                modifier = Modifier.fillMaxWidth().aspectRatio(16f / 9f),
            )
            Box(Modifier.fillMaxWidth().weight(1f)) {
                panelSlot()
            }
        }
    }
}

@Composable
private fun SplitPaneDivider(
    onDragDelta: (Float) -> Unit,
    onReset: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var isDragging by remember { mutableStateOf(false) }
    Box(
        modifier = modifier
            .fillMaxHeight()
            .width(12.dp)
            .background(Color.Transparent)
            .pointerInput(Unit) {
                detectTapGestures(
                    onDoubleTap = { onReset() },
                )
            }
            .pointerInput(Unit) {
                detectHorizontalDragGestures(
                    onDragStart = { isDragging = true },
                    onDragEnd = { isDragging = false },
                    onDragCancel = { isDragging = false },
                    onHorizontalDrag = { change, dragAmount ->
                        change.consume()
                        onDragDelta(dragAmount)
                    },
                )
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .fillMaxHeight()
                .width(1.dp)
                .background(Color.White.copy(alpha = 0.12f)),
        )
        Box(
            modifier = Modifier
                .size(width = 3.dp, height = 36.dp)
                .background(
                    if (isDragging) MaterialTheme.colorScheme.primary else Color.White.copy(alpha = 0.40f),
                    shape = RoundedCornerShape(2.dp),
                ),
        )
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
    onBack: () -> Unit,
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

    BoxWithConstraints(
        modifier = modifier.background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        val containerWidth = maxWidth
        val containerHeight = maxHeight
        val videoAspectRatio = 16f / 9f

        val (videoWidth, videoHeight) = if (containerWidth / containerHeight > videoAspectRatio) {
            (containerHeight * videoAspectRatio) to containerHeight
        } else {
            containerWidth to (containerWidth / videoAspectRatio)
        }

        Box(
            modifier = Modifier
                .size(videoWidth, videoHeight)
                .background(Color.Black),
        ) {
            AndroidView(
                factory = { webView.asView() },
                modifier = Modifier.fillMaxSize(),
            )
        }

        // The chrome fills the whole pane, not the letterboxed 16:9 box — under
        // heavy letterboxing the back/title and controls would otherwise float
        // mid-screen. The tap-to-toggle layer inside it covers the whole pane.
        PlayerChrome(
            state = state,
            capture = capture,
            viewModel = viewModel,
            onToggleFullscreen = onToggleFullscreen,
            onOpenInYouTube = onOpenInYouTube,
            onBack = onBack,
            modifier = Modifier.fillMaxSize(),
        )
    }
}

/**
 * The unified panel docked beside or below the video player: provides tabbed
 * switching between the [NotesTab] (timeline & timestamped comments) and the
 * [TranscriptPanel] (live transcript with sync & highlights).
 */
@Composable
fun PlayerPanel(
    url: String,
    viewModel: PlayerViewModel,
    modifier: Modifier = Modifier,
) {
    var selectedTab by remember { mutableIntStateOf(0) }
    Column(modifier = modifier.fillMaxSize()) {
        TabRow(selectedTabIndex = selectedTab) {
            Tab(
                selected = selectedTab == 0,
                onClick = { selectedTab = 0 },
                text = { Text("Notes") },
            )
            Tab(
                selected = selectedTab == 1,
                onClick = { selectedTab = 1 },
                text = { Text("Transcript") },
            )
        }
        when (selectedTab) {
            0 -> NotesTab(
                url = url,
                timeProvider = { viewModel.state.value.timeSeconds },
                seekListener = { viewModel.seekTo(it) },
                onPausePlayback = { viewModel.pause() },
                onResumePlayback = { viewModel.play() },
            )
            1 -> TranscriptPanel(
                url = url,
                timeProvider = { viewModel.state.value.timeSeconds },
                seekListener = { viewModel.seekTo(it) },
                onPausePlayback = { viewModel.pause() },
                onResumePlayback = { viewModel.play() },
            )
        }
    }
}

/**
 * Task 05's legacy stub panel preserved for backward compatibility.
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