package com.scholiast.android.ui.player

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.FullscreenExit
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import com.scholiast.android.player.CaptureState
import com.scholiast.android.player.CaptureStatus
import com.scholiast.android.player.PlaybackState
import com.scholiast.android.player.PlayerViewModel
import com.scholiast.android.player.VideoState
import com.scholiast.android.ui.theme.Danger
import com.scholiast.android.ui.theme.SurfaceElevated
import com.scholiast.android.ui.theme.TextSecondary
import kotlinx.coroutines.delay
import java.util.Locale

/**
 * The player chrome: a transparent tap layer (tap the video to toggle controls),
 * the centered play/pause, the bottom seek bar with current/total time and
 * −15s/+15s, the speed menu (0.5×–2×), and the fullscreen toggle — all ≥48dp.
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
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var chromeVisible by remember { mutableStateOf(true) }
    var keepAlive by remember { mutableStateOf(0L) }
    val bump: () -> Unit = { keepAlive++ }

    LaunchedEffect(state.playback) {
        if (state.playback == PlaybackState.PAUSED) {
            chromeVisible = true
        }
    }

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
                color = MaterialTheme.colorScheme.primary,
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
                onOpenInYouTube = onOpenInYouTube,
                onBack = onBack,
                onInteraction = bump,
                onDismiss = { chromeVisible = false },
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
    onOpenInYouTube: () -> Unit,
    onBack: () -> Unit,
    onInteraction: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var dragTime by remember { mutableStateOf<Double?>(null) }

    Box(
        modifier
            .pointerInput(Unit) {
                detectTapGestures {
                    onDismiss()
                }
            }
            .background(
                Brush.verticalGradient(
                    colors = listOf(
                        Color.Black.copy(alpha = 0.75f),
                        Color.Transparent,
                        Color.Black.copy(alpha = 0.75f),
                    ),
                ),
            ),
    ) {
        // Top bar: Back · Video Title
        Row(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(
                onClick = {
                    onBack()
                    onInteraction()
                },
                modifier = Modifier.size(44.dp),
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back",
                    tint = Color.White,
                )
            }
            Text(
                text = state.title.ifEmpty { "YouTube Video" },
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Medium),
                color = Color.White,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = 8.dp),
            )
        }

        // Centered controls: −15s · Play/Pause · +15s
        Row(
            modifier = Modifier.align(Alignment.Center),
            horizontalArrangement = Arrangement.spacedBy(24.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(
                onClick = {
                    viewModel.skipBy(-15.0)
                    onInteraction()
                },
                modifier = Modifier
                    .size(52.dp)
                    .background(Color.Black.copy(alpha = 0.5f), shape = CircleShape),
            ) {
                Text(
                    text = "−15",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                )
            }

            IconButton(
                onClick = {
                    viewModel.togglePlayback()
                    onInteraction()
                },
                modifier = Modifier
                    .size(72.dp)
                    .background(Color.Black.copy(alpha = 0.65f), shape = CircleShape),
            ) {
                Icon(
                    imageVector = if (
                        state.playback == PlaybackState.PLAYING || state.playback == PlaybackState.BUFFERING
                    ) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                    contentDescription = if (state.playback == PlaybackState.PLAYING) "Pause" else "Play",
                    tint = Color.White,
                    modifier = Modifier.size(44.dp),
                )
            }

            IconButton(
                onClick = {
                    viewModel.skipBy(15.0)
                    onInteraction()
                },
                modifier = Modifier
                    .size(52.dp)
                    .background(Color.Black.copy(alpha = 0.5f), shape = CircleShape),
            ) {
                Text(
                    text = "+15",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                )
            }
        }

        // Bottom bar: current time · seek bar · total time · CC · speed · fullscreen.
        Row(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            val duration = state.durationSeconds.takeIf { it > 0 } ?: state.timeSeconds.coerceAtLeast(1.0)
            val displayTime = dragTime ?: state.timeSeconds
            Text(
                text = formatMss(displayTime),
                style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"),
                color = Color.White,
                textAlign = TextAlign.End,
                // widthIn, not width: a fixed 48dp clips H:MM:SS past the hour.
                modifier = Modifier.widthIn(min = 48.dp, max = 80.dp),
            )

            @OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
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
                thumb = {
                    Box(
                        modifier = Modifier
                            .size(16.dp)
                            .background(MaterialTheme.colorScheme.primary, shape = CircleShape),
                    )
                },
                track = { sliderState ->
                    SliderDefaults.Track(
                        sliderState = sliderState,
                        colors = SliderDefaults.colors(
                            activeTrackColor = MaterialTheme.colorScheme.primary,
                            inactiveTrackColor = Color.White.copy(alpha = 0.24f),
                        ),
                        thumbTrackGapSize = 0.dp,
                        trackInsideCornerSize = 0.dp,
                        modifier = Modifier.height(4.dp),
                    )
                },
                modifier = Modifier.weight(1f),
            )

            Text(
                text = formatMss(state.durationSeconds),
                style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"),
                color = Color.White,
                textAlign = TextAlign.Start,
                modifier = Modifier.widthIn(min = 48.dp, max = 80.dp),
            )

            ClosedCaptionsButton(
                enabled = state.captionsEnabled,
                available = state.captionsAvailable,
                onToggle = {
                    viewModel.toggleCaptions()
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
                modifier = Modifier.size(44.dp),
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
private fun ClosedCaptionsButton(
    enabled: Boolean,
    available: Boolean,
    onToggle: () -> Unit,
) {
    IconButton(
        onClick = onToggle,
        enabled = available,
        modifier = Modifier.size(44.dp),
    ) {
        Surface(
            shape = RoundedCornerShape(4.dp),
            color = if (enabled && available) MaterialTheme.colorScheme.primary else Color.Transparent,
            border = if (enabled && available) null else BorderStroke(
                1.5.dp,
                if (available) Color.White.copy(alpha = 0.8f) else Color.White.copy(alpha = 0.3f),
            ),
            modifier = Modifier.size(width = 28.dp, height = 20.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text(
                    text = "CC",
                    style = MaterialTheme.typography.labelSmall.copy(
                        fontWeight = FontWeight.Bold,
                        fontSize = 11.sp,
                    ),
                    color = if (enabled && available) Color.White else if (available) Color.White.copy(alpha = 0.85f) else Color.White.copy(alpha = 0.3f),
                )
            }
        }
    }
}

private val SPEED_OPTIONS = listOf(0.5, 0.75, 1.0, 1.25, 1.5, 2.0)

/**
 * Speed picker as a compact 3×2 chip grid in a popup anchored above the trigger
 * button — the stock DropdownMenu floated a huge list over the video.
 */
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
        if (expanded) {
            // TopEnd against the small anchor Box: the popup's bottom edge lands
            // at the button's top; focusable so outside taps dismiss it.
            Popup(
                alignment = Alignment.TopEnd,
                onDismissRequest = { expanded = false },
                properties = PopupProperties(focusable = true),
            ) {
                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color = SurfaceElevated,
                    border = BorderStroke(1.dp, Color.White.copy(alpha = 0.10f)),
                    shadowElevation = 8.dp,
                ) {
                    Column(modifier = Modifier.padding(8.dp)) {
                        SPEED_OPTIONS.chunked(3).forEach { rowRates ->
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                rowRates.forEach { rate ->
                                    SpeedChip(
                                        rate = rate,
                                        selected = rate == current,
                                        onClick = {
                                            onSelect(rate)
                                            expanded = false
                                            onInteraction()
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SpeedChip(
    rate: Double,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        modifier = Modifier.size(width = 64.dp, height = 40.dp),
        shape = RoundedCornerShape(10.dp),
        color = if (selected) {
            MaterialTheme.colorScheme.primary
        } else {
            Color.White.copy(alpha = 0.08f)
        },
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(
                text = formatRate(rate),
                style = MaterialTheme.typography.labelLarge,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                color = if (selected) MaterialTheme.colorScheme.onPrimary else Color.White,
            )
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