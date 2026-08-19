package com.scholiast.android.ui.home

import android.content.ClipboardManager
import android.content.Context
import android.text.format.DateUtils
import androidx.activity.ComponentActivity
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.OndemandVideo
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarData
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import coil3.compose.AsyncImage
import com.scholiast.android.R
import com.scholiast.android.ui.theme.AccentPurple
import com.scholiast.android.ui.theme.Danger
import com.scholiast.android.ui.theme.Success
import com.scholiast.android.ui.theme.TextDisabled
import com.scholiast.android.ui.theme.TextSecondary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onOpenVideo: (String) -> Unit,
    onOpenSettings: () -> Unit,
    viewModel: HomeViewModel = rememberHomeViewModel(),
) {
    val context = LocalContext.current
    val clipboardManager = remember(context) {
        context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    }

    val recentPages by viewModel.recentPages.collectAsStateWithLifecycle()
    val openLink by viewModel.openLink.collectAsStateWithLifecycle()
    val syncStatus by viewModel.syncStatus.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(Unit) { viewModel.refresh() }

    // Navigation is driven by pendingOpen (a StateFlow) so a share intent that
    // fires before this effect subscribes is still picked up on cold start.
    LaunchedEffect(viewModel) {
        viewModel.pendingOpen.collect { videoId ->
            if (videoId != null) {
                viewModel.consumePendingOpen()
                onOpenVideo(videoId)
            }
        }
    }

    // Toast delivery. pendingToast is a StateFlow (not a one-shot channel) so a
    // cold-start share toast is still delivered once this effect subscribes.
    LaunchedEffect(viewModel) {
        viewModel.pendingToast.collect { message ->
            if (message != null) {
                viewModel.consumePendingToast()
                snackbarHostState.showSnackbar(message)
            }
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = {
            SnackbarHost(snackbarHostState) { data -> ScholiastToast(data) }
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 24.dp, vertical = 12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(R.string.home_title),
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.weight(1f),
                )
                SyncStatusChip(syncStatus)
                IconButton(onClick = onOpenSettings) {
                    Icon(
                        imageVector = Icons.Filled.Settings,
                        contentDescription = stringResource(R.string.settings_title),
                    )
                }
            }

            Spacer(Modifier.height(12.dp))

            OutlinedTextField(
                value = openLink,
                onValueChange = viewModel::onOpenLinkChange,
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Paste a YouTube link") },
                trailingIcon = {
                    IconButton(
                        onClick = {
                            pasteFromClipboard(context, clipboardManager) { text ->
                                viewModel.onOpenLinkChange(text)
                                viewModel.submitOpenLink()
                            }
                        },
                    ) {
                        Icon(Icons.Filled.ContentPaste, contentDescription = "Paste from clipboard")
                    }
                },
                singleLine = true,
                shape = RoundedCornerShape(16.dp),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { viewModel.submitOpenLink() }),
            )

            Spacer(Modifier.height(24.dp))

            Text(
                text = "Recent videos",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )

            Spacer(Modifier.height(12.dp))

            Box(modifier = Modifier.fillMaxSize()) {
                if (recentPages.isEmpty()) {
                    EmptyState()
                } else {
                    LazyVerticalGrid(
                        columns = GridCells.Adaptive(minSize = 340.dp),
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(bottom = 16.dp),
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        items(recentPages, key = { it.videoId }) { video ->
                            RecentVideoCard(video, onClick = { onOpenVideo(video.videoId) })
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun rememberHomeViewModel(): HomeViewModel {
    val activity = LocalContext.current as? ComponentActivity
        ?: error("HomeScreen must be hosted in a ComponentActivity")
    return viewModel(
        viewModelStoreOwner = activity,
        factory = HomeViewModel.factory(activity.application),
    )
}

/** The app's own dark toast, bottom-center. */
@Composable
private fun ScholiastToast(data: SnackbarData) {
    Snackbar(
        snackbarData = data,
        shape = RoundedCornerShape(8.dp),
        containerColor = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurface,
    )
}

@Composable
private fun SyncStatusChip(status: SyncStatus) {
    val (label, dotColor) = when (status) {
        SyncStatus.Disconnected -> "Not connected" to TextSecondary
        SyncStatus.Syncing -> "Syncing…" to AccentPurple
        is SyncStatus.Synced -> "Synced" to Success
        is SyncStatus.Error -> "Sync error" to Danger
    }
    Surface(
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

@Composable
private fun EmptyState() {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            imageVector = Icons.Filled.OndemandVideo,
            contentDescription = null,
            tint = TextDisabled,
            modifier = Modifier.size(56.dp),
        )
        Spacer(Modifier.height(16.dp))
        Text(
            text = "No videos yet",
            style = MaterialTheme.typography.titleMedium,
            color = TextSecondary,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = stringResource(R.string.home_empty_hint),
            style = MaterialTheme.typography.bodyMedium,
            color = TextDisabled,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun RecentVideoCard(video: RecentVideo, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Column {
            AsyncImage(
                model = thumbnailUrl(video.videoId),
                contentDescription = video.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(16f / 9f),
            )
            Column(modifier = Modifier.padding(12.dp)) {
                Text(
                    text = video.title,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    text = "${video.noteCount} ${if (video.noteCount == 1) "note" else "notes"}" +
                        " · ${relativeTime(video.lastOpenedAt)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

private fun thumbnailUrl(videoId: String): String =
    "https://img.youtube.com/vi/$videoId/hqdefault.jpg"

private fun relativeTime(time: Long): String =
    DateUtils.getRelativeTimeSpanString(time).toString()

private fun pasteFromClipboard(
    context: Context,
    clipboard: ClipboardManager,
    onText: (String) -> Unit,
) {
    val clip = clipboard.primaryClip ?: return
    if (clip.itemCount == 0) return
    val text = clip.getItemAt(0).coerceToText(context)?.toString()?.trim().orEmpty()
    if (text.isNotEmpty()) onText(text)
}