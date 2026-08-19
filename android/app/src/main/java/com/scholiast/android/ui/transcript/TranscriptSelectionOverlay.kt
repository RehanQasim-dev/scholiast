package com.scholiast.android.ui.transcript

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChatBubbleOutline
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.scholiast.android.ui.theme.Hairline
import com.scholiast.android.ui.theme.HighlightGreen
import com.scholiast.android.ui.theme.HighlightRed
import com.scholiast.android.ui.theme.HighlightYellow
import com.scholiast.android.ui.theme.SurfaceElevated
import com.scholiast.android.ui.theme.TextSecondary
import kotlin.math.roundToInt

/** The three data highlight hues, keyed by the stored `color` string. */
internal fun highlightColor(color: String): Color = when (color) {
    "red" -> HighlightRed
    "green" -> HighlightGreen
    else -> HighlightYellow
}

/**
 * A 44dp circular swatch (plan §6.2 `ColorSwatch` — the same visual as the
 * desktop's swatch popup): the highlight hue, with an active ring when
 * [selected]. Shared style for the transcript swatch popup and any future
 * swatch bar (frame draw, Task 14).
 */
@Composable
fun ColorSwatch(
    color: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
) {
    val c = highlightColor(color)
    Box(
        modifier = modifier
            .size(44.dp)
            .clip(CircleShape)
            .background(c)
            .clickable(onClick = onClick)
            .then(
                if (selected) {
                    Modifier
                        .padding(4.dp)
                        .size(36.dp)
                        .border(2.dp, Color.White, CircleShape)
                } else {
                    Modifier
                },
            ),
    )
}

/**
 * The selection-end swatch popup (port of the desktop `showPopup` in
 * `video-transcript-panel.ts`): yellow / red / green swatches + a Comment
 * button, floating above the selection rect. Flips below when there isn't
 * room above (desktop: `top < 4`), and clamps 6dp from the host edges.
 *
 * [selectionRect] is in the coordinate space of the [modifier] host (pass
 * `Modifier.fillMaxSize()` on a Box overlaying the transcript list). [rangeLabel]
 * is the derived `M:SS–M:SS` chip (null → hidden). The host box itself is
 * transparent to pointer events — only the popup is interactive.
 */
@Composable
fun TranscriptSelectionOverlay(
    selectionRect: Rect,
    rangeLabel: String?,
    onPickColor: (String) -> Unit,
    onComment: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var popupSize by remember { mutableStateOf(IntSize.Zero) }
    var hostSize by remember { mutableStateOf(IntSize.Zero) }

    Box(modifier = modifier.onSizeChanged { hostSize = it }) {
        val left = (selectionRect.center.x - popupSize.width / 2f)
            .coerceIn(6f, maxOf(6f, hostSize.width - popupSize.width - 6f))
        val aboveTop = selectionRect.top - popupSize.height - 8f
        val top = if (aboveTop >= 4f) aboveTop else selectionRect.bottom + 8f

        Surface(
            shape = RoundedCornerShape(12.dp),
            color = SurfaceElevated,
            border = androidx.compose.foundation.BorderStroke(1.dp, Hairline),
            modifier = Modifier
                .offset { IntOffset(left.roundToInt(), top.roundToInt()) }
                .onSizeChanged { popupSize = it },
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (rangeLabel != null) {
                    Text(
                        text = rangeLabel,
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontFamily = FontFamily.Monospace,
                            fontFeatureSettings = "tnum",
                        ),
                        color = TextSecondary,
                        modifier = Modifier.padding(end = 10.dp),
                    )
                }
                ColorSwatch("yellow", onClick = { onPickColor("yellow") })
                ColorSwatch("red", onClick = { onPickColor("red") }, modifier = Modifier.padding(start = 6.dp))
                ColorSwatch("green", onClick = { onPickColor("green") }, modifier = Modifier.padding(start = 6.dp))
                Box(
                    Modifier
                        .padding(horizontal = 10.dp)
                        .width(1.dp)
                        .height(IntrinsicSize.Min)
                        .background(Hairline),
                )
                Surface(
                    onClick = onComment,
                    shape = RoundedCornerShape(8.dp),
                    color = MaterialTheme.colorScheme.surfaceContainerHighest,
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Filled.ChatBubbleOutline,
                            contentDescription = null,
                            tint = TextSecondary,
                            modifier = Modifier.size(16.dp),
                        )
                        Text(
                            text = "Comment",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(start = 6.dp),
                        )
                    }
                }
            }
        }
    }
}