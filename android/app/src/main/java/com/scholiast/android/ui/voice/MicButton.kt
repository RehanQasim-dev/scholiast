package com.scholiast.android.ui.voice

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import android.provider.Settings
import kotlin.math.abs

/**
 * Tap-to-toggle microphone button (Task 09, plan §5.5.1 / §6.2).
 *
 * - **Idle** — neutral mic glyph; tap starts recording.
 * - **Recording** — pulsing red ring around the mic with the elapsed `M:SS`; tap stops, swipe
 *   down cancels (discards the samples).
 * - **Processing** — quiet pulse while a transcriber (Task 10/11) runs; taps ignored.
 * - **Stopped** — green mic (captured); the owning screen usually moves on/back to Idle quickly.
 * - **Error** — red error glyph; tap opens the app settings (permission/settings link).
 *
 * Pure presentation: all decisions (permission, start/stop, events) live in the owning
 * [VoiceRecorderViewModel]; this composable only renders [RecorderState] and forwards gestures.
 */
@Composable
fun MicButton(
    state: RecorderState,
    modifier: Modifier = Modifier,
    onToggle: () -> Unit,
    onCancel: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
) {
    val context = LocalContext.current
    val animationsEnabled = remember(context) { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) > 0f }

    val isRecording = state is RecorderState.Recording
    val description = when (state) {
        is RecorderState.Idle -> "Start recording"
        is RecorderState.Recording -> "Stop recording. ${formatClock(state.elapsedMs)} elapsed. Swipe down to cancel."
        is RecorderState.Processing -> "Processing audio"
        is RecorderState.Stopped -> "Recording captured"
        is RecorderState.Error -> "Microphone error: ${state.message}. Tap to open settings."
    }

    val accent = MaterialTheme.colorScheme.primary
    val micTint = when (state) {
        is RecorderState.Error -> MaterialTheme.colorScheme.error
        is RecorderState.Processing -> MaterialTheme.colorScheme.onSurfaceVariant
        is RecorderState.Idle -> accent
        is RecorderState.Recording -> MaterialTheme.colorScheme.onSurface
        is RecorderState.Stopped -> Color(0xFF5FE3A0)
    }

    val infiniteTransition = rememberInfiniteTransition(label = "micPulse")
    val ringScale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 1.45f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 900, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "ringScale",
    )
    val ringAlpha by infiniteTransition.animateFloat(
        initialValue = 0.55f,
        targetValue = 0f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 900, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "ringAlpha",
    )

    var dragTotal by remember { mutableStateOf(0f) }

    Box(
        modifier = modifier
            .size(72.dp)
            .semantics {
                role = Role.Button
                contentDescription = description
            }
            .pointerInput(state) {
                dragTotal = 0f
                detectVerticalDragGestures(
                    onDragEnd = {},
                    onDragCancel = {},
                ) { change, dragAmount ->
                    change.consume()
                    dragTotal += dragAmount
                    if (state is RecorderState.Recording && abs(dragTotal) > SWIPE_CANCEL_THRESHOLD_PX) {
                        onCancel()
                    }
                }
            }
            .clickable(
                enabled = state !is RecorderState.Processing,
                onClick = {
                    when (state) {
                        is RecorderState.Error -> onOpenSettings()
                        else -> onToggle()
                    }
                },
            )
    ) {
        // Pulsing red ring while recording.
        if (isRecording && animationsEnabled) {
            Canvas(modifier = Modifier.size(72.dp)) {
                drawCircle(
                    color = Color(0xFFFF5A5A).copy(alpha = ringAlpha),
                    radius = size.minDimension / 2f * ringScale,
                    style = Stroke(width = 3.dp.toPx()),
                )
            }
        }

        Column(
            modifier = Modifier
                .align(Alignment.Center)
                .size(64.dp)
                .clip(CircleShape)
                .background(
                    when (state) {
                        is RecorderState.Recording -> MaterialTheme.colorScheme.surfaceContainerHighest
                        is RecorderState.Error -> MaterialTheme.colorScheme.errorContainer
                        else -> MaterialTheme.colorScheme.surfaceContainerHighest
                    }
                ),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
        ) {
            MicGlyph(tint = micTint, modifier = Modifier.size(26.dp))
            if (state is RecorderState.Recording) {
                Text(
                    text = formatClock(state.elapsedMs),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}

/** Draws a simple mic glyph (capsule + holder) without depending on a material-icons artifact. */
@Composable
private fun MicGlyph(tint: Color, modifier: Modifier = Modifier) {
    Canvas(modifier = modifier) {
        val w = size.width
        val h = size.height
        val capsule = Stroke(width = w * 0.16f)
        val capsuleLeft = w * 0.32f
        val capsuleTop = h * 0.16f
        val capsuleW = w - capsuleLeft * 2f

        // Mic capsule
        drawRoundRect(
            color = tint,
            topLeft = androidx.compose.ui.geometry.Offset(capsuleLeft, capsuleTop),
            size = androidx.compose.ui.geometry.Size(capsuleW, h * 0.5f),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(capsuleW / 2f, capsuleW / 2f),
            style = capsule,
        )
        // Holder arms
        val armSpread = w * 0.22f
        drawArc(
            color = tint,
            startAngle = 210f,
            sweepAngle = 120f,
            useCenter = false,
            topLeft = androidx.compose.ui.geometry.Offset(w / 2f - armSpread, h * 0.42f),
            size = androidx.compose.ui.geometry.Size(armSpread * 2f, armSpread * 2f),
            style = capsule,
        )
    }
}

/** M:SS clock from milliseconds. */
internal fun formatClock(elapsedMs: Long): String {
    val totalSeconds = (elapsedMs / 1000L).coerceAtLeast(0L)
    val minutes = totalSeconds / 60L
    val seconds = (totalSeconds % 60L).toInt()
    return "%d:%02d".format(minutes, seconds)
}

private const val SWIPE_CANCEL_THRESHOLD_PX = 48f