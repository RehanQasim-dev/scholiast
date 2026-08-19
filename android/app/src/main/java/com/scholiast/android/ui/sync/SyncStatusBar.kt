package com.scholiast.android.ui.sync

import android.text.format.DateUtils
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.scholiast.android.domain.sync.SyncPhase
import com.scholiast.android.domain.sync.SyncState
import com.scholiast.android.domain.sync.SyncStatus
import com.scholiast.android.ui.theme.AccentPurple
import com.scholiast.android.ui.theme.Danger
import com.scholiast.android.ui.theme.Success
import com.scholiast.android.ui.theme.TextDisabled
import com.scholiast.android.ui.theme.TextSecondary

/**
 * The compact sync-status chip (plan §6.2 `SyncStatusBar`): a state dot + label,
 * mirroring the desktop settings panel's status line. Renders every [SyncStatus]
 * state the worker can produce — a richer superset of the Home chip Task 04
 * renders; Task 19 embeds it in the Settings Sync section.
 *
 * Labels: "Synced 5 min ago" (idle, relative) · "Syncing… 3/14" (in-flight count) ·
 * "Looking for changes…" (discovery) · "Sync failed" · "Offline — will retry" ·
 * "Not connected".
 */
@Composable
fun SyncStatusChip(status: SyncStatus, modifier: Modifier = Modifier) {
    val (label, dotColor) = chipContent(status)
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(dotColor),
            )
            Spacer(Modifier.width(6.dp))
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private fun chipContent(status: SyncStatus): Pair<String, Color> = when {
    !status.connected && !status.isRunning -> "Not connected" to TextSecondary
    status.state == SyncState.ERROR -> "Sync failed" to Danger
    status.state == SyncState.OFFLINE -> "Offline — will retry" to Danger
    status.state == SyncState.CONNECTING -> "Connecting…" to AccentPurple
    status.state == SyncState.DISCOVERING -> "Looking for changes…" to AccentPurple
    status.state == SyncState.SYNCING -> "Syncing… ${countLabel(status)}" to AccentPurple
    status.lastSyncedAt != null -> "Synced ${relativeTime(status.lastSyncedAt)}" to Success
    else -> "Connected" to Success
}

/**
 * The progress card for the Settings Sync section (desktop `sync-settings.ts`
 * `sync-progress-card`): state + percentage on top, a bar (indeterminate sweep
 * during discovery or when total is unknown), and the page being synced with a
 * `done / total` count below. Red on failure, hidden entirely when idle.
 *
 * The card is the run mirror: it appears the moment a run starts and disappears
 * when the run ends cleanly. [status.isRunning] decides visibility, exactly like
 * the desktop's `if (!status.syncing && !failed) hide`.
 */
@Composable
fun SyncStatusCard(status: SyncStatus, modifier: Modifier = Modifier) {
    val failed = status.state == SyncState.ERROR || status.state == SyncState.OFFLINE
    if (!status.isRunning && !failed) return

    val progress = status.progress
    val indeterminate = progress == null || progress.phase == SyncPhase.DISCOVERING || progress.total <= 0

    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = if (failed) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surface,
        border = BorderStroke(
            1.dp,
            if (failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outline,
        ),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            if (failed) {
                Text(
                    text = if (status.state == SyncState.OFFLINE) "Sync failed — offline, will retry" else "Sync failed",
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.error,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    text = status.lastError ?: "Check your connection and try again.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                )
                return@Column
            }

            val percent = if (indeterminate) null else percentOf(progress!!)
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = if (indeterminate) "Looking for changes…" else "Syncing…",
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f),
                )
                if (percent != null) {
                    Text(
                        text = "$percent%",
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
            }

            Spacer(Modifier.height(8.dp))

            if (indeterminate) {
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth(),
                    color = AccentPurple,
                    trackColor = MaterialTheme.colorScheme.surfaceVariant,
                )
            } else {
                LinearProgressIndicator(
                    progress = { percent!! / 100f },
                    modifier = Modifier.fillMaxWidth(),
                    color = AccentPurple,
                    trackColor = MaterialTheme.colorScheme.surfaceVariant,
                )
            }

            Spacer(Modifier.height(8.dp))

            val pageLabel = pageLabel(progress!!)
            if (pageLabel != null) {
                Text(
                    text = pageLabel,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
            }
            Text(
                text = "${progress.done + 1} / ${progress.total}",
                style = MaterialTheme.typography.bodySmall,
                color = TextSecondary,
            )
        }
    }
}

private fun percentOf(progress: com.scholiast.android.domain.sync.SyncProgress): Int =
    Math.min(100, Math.round(progress.done.toFloat() / progress.total * 100f))

private fun countLabel(status: SyncStatus): String {
    val p = status.progress ?: return ""
    return if (p.phase == SyncPhase.PAGE && p.total > 0) "${p.done + 1}/${p.total}" else ""
}

/** The page being synced: its recorded title, else a readable form of the url. */
private fun pageLabel(progress: com.scholiast.android.domain.sync.SyncProgress): String? {
    progress.title?.takeIf { it.isNotBlank() }?.let { return it }
    val url = progress.url ?: return null
    return runCatching {
        val parsed = java.net.URI(url)
        val host = parsed.host ?: return@runCatching url
        host + (parsed.path.takeIf { it.isNotBlank() && it != "/" } ?: "")
    }.getOrDefault(url)
}

private fun relativeTime(time: Long): String =
    DateUtils.getRelativeTimeSpanString(time).toString()