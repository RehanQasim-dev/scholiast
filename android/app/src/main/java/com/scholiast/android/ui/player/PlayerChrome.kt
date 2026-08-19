package com.scholiast.android.ui.player

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.FullscreenExit
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.scholiast.android.player.CaptureState
import com.scholiast.android.player.CaptureStatus
import com.scholiast.android.player.PlaybackState
import com.scholiast.android.player.PlayerViewModel
import com.scholiast.android.player.VideoState
import com.scholiast.android.ui.theme.AccentPurple
import com.scholiast.android.ui.theme.Danger
import com.scholiast.android.ui.theme.SurfaceElevated
import com.scholiast.android.ui.theme.TextSecondary
import kotlinx.coroutines.delay
import java.util.Locale

/**
 * The player chrome: a transparent tap layer (tap the video to toggle controls),
 * the centered play/pause, the bottom seek bar with current/total time and
 * −15s/+15s, the speed menu (0.75×–2×), and the fullscreen toggle — all ≥48dp.
 * Also surfaces the embed-blocked message ("Video can't be played in this app"
 * + open-in-YouTube) and the capture-failure banner. Overlays the WebView.
 *
 * The player chrome auto-hides after 4 s of playback; any interaction (seek
 * drag, button) keeps it alive.
 */
@Composable
fun PlayerChrome(
    state: VideoState,
    capture: CaptureState,
    viewModel: PlayerViewModel,
    onToggleFullscreen: () -> Unit,
    onOpenInYouTube: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var chromeVisible by remember { mutableStateOf(true) }
    var keepAlive by remember { mutableStateOf(0L) }
    val bump: () -> Unit = { keepAlive++ }

    LaunchedEffect(chromeVisible, keepAlive, state.playback) {
        if (chromeVisible && state.playback == PlaybackState.PLAYING) {
            delay(4000)
            chromeVisible = false
        }
    }

    Box(modifier) {
        // Tap the video → toggle chrome.
        Box(
            Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    detectTapGestures {
                        chromeVisible = !chromeVisible
                        bump()
                    }
                },
        )

        if (!state.playerReady && !state.embedBlocked) {
            CircularProgressIndicator(
                modifier = Modifier.align(Alignment.Center).size(40.dp),
                color = AccentPurple,
            )
        }

        if (state.embedBlocked) {
            EmbedBlockedOverlay(
                message = state.error?.message ?: "Video can't be played in this app",
                onOpenInYouTube = { onOpenInYouTube(); bump() },
                modifier = Modifier.fillMaxSize(),
            )
        }

        if (chromeVisible && state.playerReady && !state.embedBlocked) {
            ChromeControls(
                state = state,
                viewModel = viewModel,
                onToggleFullscreen = onToggleFullscreen,
                onInteraction = bump,
                modifier = Modifier.fillMaxSize(),
            )
        }

        if (capture.status == CaptureStatus.FAILED) {
            CaptureFailedBanner(
                error = capture.error,
                onDismiss = viewModel::clearCapture,
                modifier = Modifier.align(Alignment.BottomCenter),
            )
        }
    }
}

@Composable
private fun ChromeControls(
    state: VideoState,
    viewModel: PlayerViewModel,
    onToggleFullscreen: () -> Unit,
    onInteraction: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var dragTime by remember { mutableStateOf<Double?>(null) }

    Box(
        modifier
            .background(
                Brush.verticalGradient(
                    colors = listOf(Color.Transparent, Color.Black.copy(alpha = 0.55f)),
                    endY = Float.POSITIVE_INFINITY,
                ),
            ),
    ) {
        // Centered play / pause.
        IconButton(
            onClick = {
                viewModel.togglePlayback()
                onInteraction()
            },
            modifier = Modifier.align(Alignment.Center).size(72.dp),
        ) {
            Icon(
                imageVector = if (
                    state.playback == PlaybackState.PLAYING || state.playback == PlaybackState.BUFFERING
                ) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                contentDescription = if (state.playback == PlaybackState.PLAYING) "Pause" else "Play",
                tint = Color.White,
                modifier = Modifier.size(56.dp),
            )
        }

        // Bottom bar: −15s · current time · seek bar · total time · +15s · speed · fullscreen.
        Row(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            SkipButton(
                label = "−15",
                contentDescription = "Back 15 seconds",
                onClick = {
                    viewModel.skipBy(-15.0)
                    onInteraction()
                },
            )

            val duration = state.durationSeconds.takeIf { it > 0 } ?: state.timeSeconds.coerceAtLeast(1.0)
            val displayTime = dragTime ?: state.timeSeconds
            Text(
                text = formatMss(displayTime),
                style = MaterialTheme.typography.labelLarge.copy(fontFeatureSettings = "tnum"),
                color = Color.White,
                textAlign = TextAlign.End,
                modifier = Modifier.width(52.dp),
            )

            Slider(
                value = displayTime.toFloat().coerceIn(0f, duration.toFloat()),
                onValueChange = {
                    dragTime = it.toDouble()
                    onInteraction()
                },
                onValueChangeFinished = {
                    dragTime?.let(viewModel::seekTo)
                    dragTime = null
                    onInteraction()
                },
                valueRange = 0f..duration.toFloat(),
                modifier = Modifier.weight(1f),
            )

            Text(
                text = formatMss(state.durationSeconds),
                style = MaterialTheme.typography.labelLarge.copy(fontFeatureSettings = "tnum"),
                color = Color.White,
                textAlign = TextAlign.Start,
                modifier = Modifier.width(52.dp),
            )

            SkipButton(
                label = "+15",
                contentDescription = "Forward 15 seconds",
                onClick = {
                    viewModel.skipBy(15.0)
                    onInteraction()
                },
            )

            SpeedMenu(
                current = state.rate,
                onSelect = { rate ->
                    viewModel.setRate(rate)
                    onInteraction()
                },
                onInteraction = onInteraction,
            )

            IconButton(
                onClick = {
                    onToggleFullscreen()
                    onInteraction()
                },
                modifier = Modifier.size(48.dp),
            ) {
                Icon(
                    imageVector = if (state.isFullscreen) Icons.Filled.FullscreenExit else Icons.Filled.Fullscreen,
                    contentDescription = if (state.isFullscreen) "Exit fullscreen" else "Fullscreen",
                    tint = Color.White,
                )
            }
        }
    }
}

@Composable
private fun SkipButton(label: String, contentDescription: String, onClick: () -> Unit) {
    IconButton(
        onClick = onClick,
        modifier = Modifier.size(48.dp),
    ) {
        Text(
            text = label,
            color = Color.White,
            fontWeight = FontWeight.SemiBold,
            style = MaterialTheme.typography.labelLarge,
        )
    }
}

private val SPEED_OPTIONS = listOf(0.75, 1.0, 1.25, 1.5, 2.0)

@Composable
private fun SpeedMenu(
    current: Double,
    onSelect: (Double) -> Unit,
    onInteraction: () -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        IconButton(
            onClick = {
                expanded = true
                onInteraction()
            },
            modifier = Modifier.size(48.dp),
        ) {
            Text(
                text = formatRate(current),
                color = Color.White,
                fontWeight = FontWeight.SemiBold,
                style = MaterialTheme.typography.labelLarge,
            )
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            SPEED_OPTIONS.forEach { rate ->
                DropdownMenuItem(
                    text = { Text(formatRate(rate)) },
                    onClick = {
                        onSelect(rate)
                        expanded = false
                    },
                    leadingIcon = {
                        if (rate == current) {
                            Icon(Icons.Filled.Check, contentDescription = null)
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun EmbedBlockedOverlay(
    message: String,
    onOpenInYouTube: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.background(Color.Black.copy(alpha = 0.72f)).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            imageVector = Icons.Filled.ErrorOutline,
            contentDescription = null,
            tint = Danger,
            modifier = Modifier.size(48.dp),
        )
        Spacer(Modifier.size(16.dp))
        Text(
            text = message,
            style = MaterialTheme.typography.titleMedium,
            color = Color.White,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.size(8.dp))
        Text(
            text = "Transcript annotation still works for this video.",
            style = MaterialTheme.typography.bodyMedium,
            color = TextSecondary,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.size(20.dp))
        Button(onClick = onOpenInYouTube) {
            Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null)
            Text("Open in YouTube", modifier = Modifier.padding(start = 8.dp))
        }
    }
}

@Composable
private fun CaptureFailedBanner(
    error: String?,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(error) {
        delay(3000)
        onDismiss()
    }
    Surface(
        modifier = modifier.padding(bottom = 72.dp),
        color = SurfaceElevated,
        shape = RoundedCornerShape(12.dp),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.Filled.ErrorOutline,
                contentDescription = null,
                tint = Danger,
                modifier = Modifier.size(20.dp),
            )
            Text(
                text = "This video can't be frame-captured" +
                    (error?.let { " ($it)" } ?: ""),
                style = MaterialTheme.typography.bodyMedium,
                color = Color.White,
                modifier = Modifier.padding(start = 10.dp),
            )
        }
    }
}

/** `M:SS`, or `H:MM:SS` past an hour. Tabular figures. */
internal fun formatMss(seconds: Double): String {
    val total = seconds.toLong().coerceAtLeast(0)
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) {
        String.format(Locale.US, "%d:%02d:%02d", h, m, s)
    } else {
        String.format(Locale.US, "%d:%02d", m, s)
    }
}

private fun formatRate(rate: Double): String =
    rate.toString().trimEnd('0').trimEnd('.') + "×"