package com.scholiast.android.ui.reader

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.scholiast.android.ui.theme.Hairline
import com.scholiast.android.ui.theme.SurfaceElevated
import kotlin.math.roundToInt

/** Plan §6.5: pill = high-frequency → 150ms ease-out cubic-bezier(0.23,1,0.32,1). */
private val PILL_EASING = CubicBezierEasing(0.23f, 1f, 0.32f, 1f)
private const val ENTER_MS = 150
private const val EXIT_MS = 100 // exit reverse, faster

/** Task 33 B: placement/flip margin — pill floats 8dp clear of edges & text. */
private val EDGE_GAP = 8.dp

/**
 * The two-tap highlight pill (plan §5.4): 🟡 🟢 🔴 · 🎤 · 💬, floating above the
 * selection. Pure state + callbacks — no ViewModel/Room/network; the host owns
 * visibility ([visible]) and dismisses on scroll/collapse/outside-tap.
 *
 * Task 33 B redesign: compact strip ≤52dp tall (10dp h-padding, 26dp corners,
 * surface + hairline + subtle shadow), 36dp swatch buttons with 24dp dots,
 * 40dp icon buttons with 20dp icons. Placement is anchored to the selection:
 * horizontally centered on its start-x, bottom 8dp ABOVE the selection rect,
 * flipped below (+8dp) only when there is no room above, always ≥8dp from the
 * screen edges — it never overlaps the first selected line.
 *
 * Motion (plan §6.5): origin-aware scale .95→1 + fade over [ENTER_MS]; the
 * pivot is the top-center of the selection rect — the pill grows out of the
 * point of the selection it points at (its own bottom-center when above,
 * top-center when flipped below). [reducedMotion] ("Remove animations") turns
 * both into opacity-only cross-fades. Tapping outside fires [onDismiss].
 */
@Composable
fun SwatchPill(
    visible: Boolean,
    anchorRect: Rect?,
    onColor: (String) -> Unit,
    onMic: () -> Unit,
    onComment: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    reducedMotion: Boolean = false,
) {
    var pillSize by remember { mutableStateOf(IntSize.Zero) }
    var hostSize by remember { mutableStateOf(IntSize.Zero) }
    val edgePx = with(LocalDensity.current) { EDGE_GAP.toPx() }

    // One placement decision drives both the offset and the animation pivot.
    val placement = remember(anchorRect, pillSize, hostSize, edgePx) {
        placePill(anchorRect, pillSize, hostSize, edgePx)
    }

    Box(
        modifier = modifier
            .onSizeChanged { hostSize = it }
            .pointerInput(onDismiss, visible) {
                // Outside tap = auto-dismiss — but ONLY while visible: the pill
                // host stays mounted (exit animation) and must pass every tap
                // through to the page when hidden.
                if (visible) detectTapGestures(onTap = { onDismiss() })
            },
    ) {
        AnimatedVisibility(
            visible = visible && anchorRect != null,
            enter = if (reducedMotion) {
                fadeIn(tween(ENTER_MS))
            } else {
                fadeIn(tween(ENTER_MS)) + scaleIn(
                    initialScale = 0.95f,
                    transformOrigin = placement.origin,
                    animationSpec = tween(ENTER_MS, easing = PILL_EASING),
                )
            },
            exit = if (reducedMotion) {
                fadeOut(tween(EXIT_MS))
            } else {
                fadeOut(tween(EXIT_MS)) + scaleOut(
                    targetScale = 0.95f,
                    transformOrigin = placement.origin,
                    animationSpec = tween(EXIT_MS, easing = PILL_EASING),
                )
            },
        ) {
            Surface(
                shape = RoundedCornerShape(26.dp), // fully rounded ≤52dp pill
                color = SurfaceElevated,
                border = BorderStroke(1.dp, Hairline),
                shadowElevation = 8.dp,
                modifier = Modifier
                    .onSizeChanged { pillSize = it }
                    .offset { placement.offset },
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    PillSwatch("yellow", onColor)
                    PillSwatch("green", onColor)
                    PillSwatch("red", onColor)
                    PillDivider()
                    PillIconButton(Icons.Filled.Mic, "Record a voice note", onClick = onMic)
                    PillIconButton(Icons.AutoMirrored.Filled.Chat, "Write a comment", onClick = onComment)
                }
            }
        }
    }
}

/** Where the pill sits for a given selection rect + how its entrance pivots. */
internal data class PillPlacement(val offset: IntOffset, val origin: TransformOrigin)

/**
 * Task 33 B placement: pill center-x on the selection's start-x (clamped ≥8dp
 * from screen edges); vertically 8dp ABOVE the selection top so the first
 * selected line stays readable, flipped to 8dp BELOW its bottom when the space
 * above is too tight. Origin = top-center of the selection rect → pivot at the
 * pill's near edge (bottom when above, top when below).
 */
internal fun placePill(anchor: Rect?, pill: IntSize, host: IntSize, edgePx: Float): PillPlacement {
    if (anchor == null || pill == IntSize.Zero || pill.width <= 0 || pill.height <= 0) {
        return PillPlacement(IntOffset.Zero, TransformOrigin(0.5f, 1f))
    }
    val maxX = maxOf(edgePx, host.width - pill.width - edgePx)
    val x = (anchor.left - pill.width / 2f).coerceIn(edgePx, maxX).roundToInt()
    val aboveY = anchor.top - pill.height - edgePx
    val fitsAbove = aboveY >= edgePx
    val y = if (fitsAbove) {
        aboveY
    } else {
        (anchor.bottom + edgePx).coerceAtMost(maxOf(edgePx, host.height - pill.height - edgePx))
    }.roundToInt()
    val origin = TransformOrigin(0.5f, if (fitsAbove) 1f else 0f)
    return PillPlacement(IntOffset(x, y), origin)
}

/**
 * 36dp circular swatch button with a 24dp color dot (task 33 B); pressed adds
 * a 2dp white active ring around the dot and scales to 0.97.
 */
@Composable
private fun PillSwatch(color: String, onColor: (String) -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        modifier = Modifier
            .size(36.dp)
            .graphicsLayer { scaleX = if (pressed) 0.97f else 1f; scaleY = scaleX }
            .clickable(interactionSource = interaction, indication = null) { onColor(color) },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(28.dp) // 24dp dot + 2dp white ring all round
                .background(
                    if (pressed) androidx.compose.ui.graphics.Color.White else androidx.compose.ui.graphics.Color.Transparent,
                    CircleShape,
                )
                .padding(2.dp),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                Modifier
                    .size(24.dp)
                    .background(highlightColor(color), CircleShape),
            )
        }
    }
}

/** 40dp icon target (mic / comment) with a 20dp onSurface icon; presses to 0.97. */
@Composable
private fun PillIconButton(icon: ImageVector, label: String, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        modifier = Modifier
            .size(40.dp)
            .graphicsLayer { scaleX = if (pressed) 0.97f else 1f; scaleY = scaleX }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon,
            contentDescription = label, // TalkBack label (plan §6.4)
            tint = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.size(20.dp),
        )
    }
}

@Composable
private fun PillDivider() {
    Box(
        Modifier
            .width(1.dp)
            .height(20.dp)
            .background(Hairline),
    )
}
