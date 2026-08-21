package com.scholiast.android.ui.reader

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.scholiast.android.R
import com.scholiast.android.ui.home.SyncStatus
import com.scholiast.android.ui.theme.Danger
import com.scholiast.android.ui.theme.Success
import com.scholiast.android.ui.theme.TextSecondary
import kotlin.math.roundToInt

/** Bar height below the status bar, in dp. */
const val READER_TOP_BAR_HEIGHT_DP = 56

/**
 * The reader's translucent top bar (plan §5.3 / §6.5): back · ellipsized title ·
 * sync dot · overflow. It never animates independently of the finger — the
 * screen feeds [hiddenPx] (0 = fully shown, larger = pushed up) derived 1:1
 * from scroll deltas.
 */
@Composable
fun ReaderTopBar(
    title: String?,
    syncStatus: SyncStatus,
    hiddenPx: Float,
    onBack: () -> Unit,
    onShowTypography: () -> Unit,
    onOpenOriginal: () -> Unit,
    onDeletePageData: () -> Unit,
    modifier: Modifier = Modifier,
    onCopyArticle: (() -> Unit)? = null,
) {
    Surface(
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
        modifier = modifier.offset { IntOffset(0, -hiddenPx.roundToInt()) },
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .height(READER_TOP_BAR_HEIGHT_DP.dp)
                .padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = stringResource(R.string.back),
                )
            }
            Text(
                text = title.orEmpty(),
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            SyncDot(syncStatus)
            TopBarOverflow(
                onShowTypography = onShowTypography,
                onOpenOriginal = onOpenOriginal,
                onDeletePageData = onDeletePageData,
                onCopyArticle = onCopyArticle,
            )
        }
    }
}

@Composable
private fun SyncDot(status: SyncStatus) {
    val (color, description) = when (status) {
        SyncStatus.Disconnected -> TextSecondary to "Not connected"
        SyncStatus.Syncing -> MaterialTheme.colorScheme.primary to "Syncing"
        is SyncStatus.Synced -> Success to "Synced"
        is SyncStatus.Error -> Danger to "Sync error"
    }
    Box(
        modifier = Modifier
            .size(8.dp)
            .clip(CircleShape)
            .background(color)
            .semantics { contentDescription = description },
    )
}

@Composable
private fun TopBarOverflow(
    onShowTypography: () -> Unit,
    onOpenOriginal: () -> Unit,
    onDeletePageData: () -> Unit,
    onCopyArticle: (() -> Unit)? = null,
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { expanded = true }) {
            Icon(Icons.Filled.MoreVert, contentDescription = "More options")
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(
                text = { Text("Typography") },
                onClick = {
                    expanded = false
                    onShowTypography()
                },
            )
            if (onCopyArticle != null) {
                DropdownMenuItem(
                    text = { Text("Copy article") },
                    onClick = {
                        expanded = false
                        onCopyArticle()
                    },
                )
            }
            DropdownMenuItem(
                text = { Text("Open original") },
                onClick = {
                    expanded = false
                    onOpenOriginal()
                },
            )
            DropdownMenuItem(
                text = { Text("Delete page data…") },
                onClick = {
                    expanded = false
                    onDeletePageData()
                },
            )
        }
    }
}
