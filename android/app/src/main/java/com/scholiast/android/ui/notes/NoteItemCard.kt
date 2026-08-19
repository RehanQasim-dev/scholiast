package com.scholiast.android.ui.notes

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChatBubbleOutline
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.FormatQuote
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.scholiast.android.data.model.VideoItem
import com.scholiast.android.data.notes.parseVideoNote
import com.scholiast.android.ui.frame.FrameThumb
import com.scholiast.android.ui.notes.render.CommentBody
import com.scholiast.android.ui.theme.Hairline
import com.scholiast.android.ui.theme.HighlightGreen
import com.scholiast.android.ui.theme.HighlightRed
import com.scholiast.android.ui.theme.HighlightYellow
import com.scholiast.android.ui.theme.SurfaceElevated
import com.scholiast.android.ui.theme.TextDisabled
import com.scholiast.android.ui.theme.TextSecondary
import kotlin.math.floor
import kotlin.math.max

/**
 * Seconds → `"M:SS"`, or `"H:MM:SS"` beyond an hour. Ported from
 * `src/utils/video/video-notes.ts` `formatVideoTime` (same clamping of
 * negatives to `0:00`, same zero-padding). Lives here until a `util/` time-
 * formatting owner exists (AGENTS.md package map); Task 07's timestamp chip
 * imports it from this package.
 */
fun formatVideoTime(seconds: Double): String {
    val s = max(0, floor(seconds).toInt())
    val h = s / 3600
    val m = (s % 3600) / 60
    val sec = s % 60
    val pad = { n: Int -> n.toString().padStart(2, '0') }
    return if (h > 0) "$h:${pad(m)}:${pad(sec)}" else "$m:${pad(sec)}"
}

/** The fixed highlight hues, keyed by the item's `color` string (desktop values). */
private fun colorFor(item: VideoItem): Color? = when (item.color) {
    "yellow" -> HighlightYellow
    "red" -> HighlightRed
    "green" -> HighlightGreen
    else -> null
}

private fun kindIcon(kind: String): ImageVector = when (kind) {
    "frame" -> Icons.Filled.PhotoCamera
    "transcript" -> Icons.Filled.FormatQuote
    else -> Icons.Filled.EditNote
}

private fun kindLabel(kind: String): String = when (kind) {
    "frame" -> "Frame"
    "transcript" -> "Transcript highlight"
    else -> "Note"
}

/**
 * One item in the Notes timeline: kind icon, seekable `M:SS` chip, quote/
 * preview, and the collapsed comment thread (tap to expand; count badge +
 * last-comment preview while collapsed). Transcript items add a color rail and
 * an `M:SS–M:SS` range chip; frame items show a thumbnail (Task 14).
 *
 * Thread bodies render through Task 08's [CommentBody]; the raw note string
 * (markers included) is passed so the "edited" label shows.
 */
@Composable
fun NoteItemCard(
    item: VideoItem,
    onSeek: (Double) -> Unit,
    onDelete: (VideoItem) -> Unit,
    onAddComment: (VideoItem) -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by rememberSaveable(item.id) { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    val railColor = colorFor(item)

    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = SurfaceElevated,
        border = androidx.compose.foundation.BorderStroke(1.dp, Hairline),
    ) {
        Row {
            if (railColor != null) {
                Box(
                    Modifier
                        .width(4.dp)
                        .fillMaxHeight()
                        .background(railColor),
                )
            }
            Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
                CardHeader(
                    item = item,
                    menuOpen = menuOpen,
                    onMenuOpenChange = { menuOpen = it },
                    onSeek = onSeek,
                    onDelete = onDelete,
                )
                ItemBody(item)
                ThreadSection(
                    item = item,
                    expanded = expanded,
                    onToggle = { expanded = !expanded },
                    onAddComment = { onAddComment(item) },
                )
            }
        }
    }
}

@Composable
private fun CardHeader(
    item: VideoItem,
    menuOpen: Boolean,
    onMenuOpenChange: (Boolean) -> Unit,
    onSeek: (Double) -> Unit,
    onDelete: (VideoItem) -> Unit,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            imageVector = kindIcon(item.kind),
            contentDescription = kindLabel(item.kind),
            tint = TextSecondary,
            modifier = Modifier.size(18.dp),
        )
        Spacer(Modifier.width(8.dp))
        TimestampChip(
            seconds = item.videoTime,
            endSeconds = item.timeEnd,
            onClick = { onSeek(item.videoTime) },
        )
        Spacer(Modifier.weight(1f))
        Box {
            IconButton(onClick = { onMenuOpenChange(true) }) {
                Icon(
                    Icons.Filled.MoreVert,
                    contentDescription = "Item actions",
                    tint = TextSecondary,
                )
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { onMenuOpenChange(false) }) {
                DropdownMenuItem(
                    text = { Text("Delete") },
                    leadingIcon = { Icon(Icons.Filled.Delete, contentDescription = null) },
                    onClick = {
                        onMenuOpenChange(false)
                        onDelete(item)
                    },
                )
            }
        }
    }
}

/**
 * The mono, tabular `M:SS` seek chip (plan §6.2 `TimestampChip`). Transcript
 * items show the range `M:SS–M:SS` (en dash, desktop style); tapping seeks to
 * the range start. Shared component — lives here until a `ui/components/`
 * owner exists.
 */
@Composable
internal fun TimestampChip(
    seconds: Double,
    endSeconds: Double? = null,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val text = if (endSeconds != null && endSeconds > seconds) {
        "${formatVideoTime(seconds)}–${formatVideoTime(endSeconds)}"
    } else {
        formatVideoTime(seconds)
    }
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(999.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f),
        modifier = modifier,
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium.copy(
                fontFamily = FontFamily.Monospace,
                fontFeatureSettings = "tnum",
            ),
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

@Composable
private fun ItemBody(item: VideoItem) {
    when (item.kind) {
        "frame" -> {
            FrameThumb(itemId = item.id, markup = item.markup, modifier = Modifier.padding(top = 8.dp))
        }
        "transcript" -> {
            if (!item.quote.isNullOrBlank()) {
                Text(
                    text = item.quote,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 4,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }
        else -> {
            val preview = item.notes.lastOrNull()?.let { parseVideoNote(it).text }
            if (!preview.isNullOrBlank()) {
                Text(
                    text = preview,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 4,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun ThreadSection(
    item: VideoItem,
    expanded: Boolean,
    onToggle: () -> Unit,
    onAddComment: () -> Unit,
) {
    if (item.notes.isEmpty()) {
        TextButton(onClick = onAddComment) {
            Text("Add comment")
        }
        return
    }
    Column {
        val last = parseVideoNote(item.notes.last()).text
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onToggle)
                .padding(top = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(
                Icons.Filled.ChatBubbleOutline,
                contentDescription = null,
                tint = TextDisabled,
                modifier = Modifier.size(14.dp),
            )
            Text(
                text = "${item.notes.size}",
                style = MaterialTheme.typography.labelMedium,
                color = TextSecondary,
            )
            if (!expanded && last.isNotBlank()) {
                Text(
                    text = last,
                    style = MaterialTheme.typography.bodySmall,
                    color = TextSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (expanded) {
            Column(Modifier.padding(top = 4.dp)) {
                item.notes.forEach { note ->
                    CommentBody(
                        markdown = note,
                        modifier = Modifier.padding(vertical = 4.dp),
                    )
                }
                TextButton(onClick = onAddComment) {
                    Text("Add comment")
                }
            }
        }
    }
}

/**
 * The frame item's thumbnail: JPEG from [com.scholiast.android.ui.frame.FrameStore]
 * with the markup baked on top. Implemented by Task 14
 * (`ui/frame/FrameThumb.kt`); this file only imports it.
 */