package com.scholiast.android.ui.reader

import android.provider.Settings
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.scholiast.android.ui.theme.Hairline
import com.scholiast.android.ui.theme.SurfaceElevated
import com.scholiast.android.ui.voice.formatClock
import kotlin.math.roundToInt

/** Plan §6.5: VoiceBubble = high-frequency → 150ms ease-out cubic-bezier(0.23,1,0.32,1). */
private val BUBBLE_EASING = CubicBezierEasing(0.23f, 1f, 0.32f, 1f)
private const val ENTER_MS = 150
private const val EXIT_MS = 100 // exit is a plain fade, faster

/**
 * The recording bubble (plan §5.6): compact ~180×48dp card anchored BELOW the
 * selection's pill anchor (clamped to the viewport), pulsing ring + elapsed
 * mm:ss (tabular figures) while recording — tap toggles stop; a transcribing
 * state while the chain runs; an error state with Retry/Discard. Pure
 * presentation over [VoicePhase] — no recorder, no registry.
 *
 * Motion (plan §6.5): enter = scale+fade from the mic point over [ENTER_MS]
 * (pivot at the anchor edge it grows from), exit = fade only. [reducedMotion]
 * ("Remove animations", detected from ANIMATOR_DURATION_SCALE by default)
 * drops the scale and the ring pulse for opacity-only presentation. The bubble
 * never blocks the page: taps outside it pass through; only its own surface
 * consumes gestures.
 */
@Composable
fun VoiceBubble(
    visible: Boolean,
    anchorRect: Rect?,
    phase: VoicePhase,
    onStop: () -> Unit,
    onRetry: () -> Unit,
    onDiscard: () -> Unit,
    modifier: Modifier = Modifier,
    reducedMotion: Boolean = reducedMotionDefault(),
) {
    var bubbleSize by remember { mutableStateOf(IntSize.Zero) }
    var hostSize by remember { mutableStateOf(IntSize.Zero) }

    // Grow-from-the-mic-point pivot: x follows the anchor, y pins to the top
    // edge so the bubble scales out downward from where the finger just was.
    val origin = remember(anchorRect, bubbleSize) {
        if (anchorRect == null || bubbleSize == IntSize.Zero) {
            TransformOrigin(0.5f, 0f)
        } else {
            TransformOrigin(
                pivotFractionX = (anchorRect.center.x / bubbleSize.width.coerceAtLeast(1)).coerceIn(0f, 1f),
                pivotFractionY = 0f,
            )
        }
    }

    Box(modifier = modifier.onSizeChanged { hostSize = it }) {
        AnimatedVisibility(
            visible = visible && anchorRect != null,
            enter = if (reducedMotion) {
                fadeIn(tween(ENTER_MS))
            } else {
                fadeIn(tween(ENTER_MS)) + scaleIn(
                    initialScale = 0.9f,
                    transformOrigin = origin,
                    animationSpec = tween(ENTER_MS, easing = BUBBLE_EASING),
                )
            },
            exit = fadeOut(tween(EXIT_MS)),
        ) {
            Surface(
                shape = RoundedCornerShape(24.dp),
                color = SurfaceElevated,
                border = BorderStroke(1.dp, Hairline),
                shadowElevation = 6.dp,
                modifier = Modifier
                    .onSizeChanged { bubbleSize = it }
                    .offsetBelow(anchorRect, bubbleSize, hostSize),
            ) {
                when (phase) {
                    is VoicePhase.Recording -> RecordingContent(phase.elapsedMs, onStop, reducedMotion)
                    is VoicePhase.Transcribing -> TranscribingContent()
                    is VoicePhase.Error -> ErrorContent(phase.message, onRetry, onDiscard)
                    is VoicePhase.DraftReady, VoicePhase.Idle -> Unit // hidden via `visible`
                }
            }
        }
    }
}

/** Recording row: pulsing ring around the mic dot + elapsed M:SS; tap stops. */
@Composable
private fun RecordingContent(elapsedMs: Long, onStop: () -> Unit, reducedMotion: Boolean) {
    val pulse = rememberInfiniteTransition(label = "voiceBubblePulse")
    val ringScale by pulse.animateFloat(
        initialValue = 1f,
        targetValue = 1.6f,
        animationSpec = infiniteRepeatable(tween(durationMillis = 1600, easing = LinearEasing)),
        label = "ringScale",
    )
    val ringAlpha by pulse.animateFloat(
        initialValue = 0.45f,
        targetValue = 0f,
        animationSpec = infiniteRepeatable(tween(durationMillis = 1600, easing = LinearEasing)),
        label = "ringAlpha",
    )

    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .width(180.dp)
            .heightIn(min = 48.dp)
            .semantics {
                role = Role.Button
                contentDescription =
                    "Recording voice note. ${formatClock(elapsedMs)} elapsed. Tap to stop."
            }
            .clickable(onClick = onStop)
            .padding(horizontal = 14.dp),
    ) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.size(32.dp)) {
            if (!reducedMotion) {
                Canvas(Modifier.size(32.dp)) {
                    drawCircle(
                        color = Color(0xFFFF5A5A).copy(alpha = ringAlpha),
                        radius = size.minDimension / 2f * ringScale * 0.7f,
                        style = Stroke(width = 2.dp.toPx()),
                    )
                }
            }
            Box(
                Modifier
                    .size(20.dp)
                    .background(Color(0xFFFF5A5A), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                BubbleIcon(Icons.Filled.Mic, "Stop recording")
            }
        }
        Text(
            text = formatClock(elapsedMs),
            style = MaterialTheme.typography.labelLarge.copy(fontFeatureSettings = "tnum"),
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.padding(start = 10.dp),
        )
    }
}

/** Transcribing row: the one allowed spinner + label; taps ignored. */
@Composable
private fun TranscribingContent() {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .width(180.dp)
            .heightIn(min = 48.dp)
            .semantics { contentDescription = "Transcribing recording" }
            .padding(horizontal = 14.dp),
    ) {
        CircularProgressIndicator(
            modifier = Modifier.size(18.dp),
            strokeWidth = 2.dp,
        )
        Text(
            text = "Transcribing…",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 10.dp),
        )
    }
}

/** Error row: message + Retry/Discard; nothing saved silently (plan §5.6). */
@Composable
private fun ErrorContent(message: String, onRetry: () -> Unit, onDiscard: () -> Unit) {
    Column(
        modifier = Modifier
            .width(180.dp)
            .padding(horizontal = 6.dp, vertical = 2.dp),
    ) {
        Text(
            text = message,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onRetry) {
                BubbleIcon(Icons.Filled.Refresh, null)
                Text("Retry")
            }
            TextButton(onClick = onDiscard) {
                BubbleIcon(Icons.Filled.Close, null)
                Text("Discard")
            }
        }
    }
}

@Composable
private fun BubbleIcon(icon: ImageVector, description: String?) {
    Icon(
        imageVector = icon,
        contentDescription = description,
        tint = MaterialTheme.colorScheme.onSurface,
        modifier = Modifier.size(14.dp),
    )
}

/** Centered under the anchor start, clamped inside the host (plan §5.6). */
private fun Modifier.offsetBelow(anchor: Rect?, bubble: IntSize, host: IntSize): Modifier =
    if (anchor == null || bubble == IntSize.Zero) this
    else this.offset {
        IntOffset(
            (anchor.center.x - bubble.width / 2f)
                .coerceIn(6f, maxOf(6f, host.width - bubble.width - 6f))
                .roundToInt(),
            (anchor.bottom + 8f)
                .coerceIn(6f, maxOf(6f, host.height - bubble.height - 6f))
                .roundToInt(),
        )
    }

/** Same signal MicButton uses: animations off ⇒ reduced motion. */
@Composable
private fun reducedMotionDefault(): Boolean {
    val context = LocalContext.current
    return remember(context) {
        Settings.Global.getFloat(
            context.contentResolver,
            Settings.Global.ANIMATOR_DURATION_SCALE,
            1f,
        ) <= 0f
    }
}