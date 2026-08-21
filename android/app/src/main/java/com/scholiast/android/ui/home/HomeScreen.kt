package com.scholiast.android.ui.home

import android.content.ClipboardManager
import android.content.Context
import android.text.format.DateUtils
import androidx.activity.ComponentActivity
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.MenuBook
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import coil3.compose.AsyncImage
import com.scholiast.android.R
import com.scholiast.android.data.notes.PageListItem
import com.scholiast.android.ui.theme.Danger
import com.scholiast.android.ui.theme.Success
import com.scholiast.android.ui.theme.TextDisabled
import com.scholiast.android.ui.theme.TextSecondary
import kotlinx.coroutines.launch

/** The Home content tabs (Task 28): the video library and the reader pages. */
enum class HomeTab(val label: String) {
    VIDEOS("Videos"),
    PAGES("Pages"),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onOpenVideo: (String) -> Unit,
    onOpenReader: (String) -> Unit,
    onOpenSettings: () -> Unit,
    viewModel: HomeViewModel = rememberHomeViewModel(),
) {
    val context = LocalContext.current
    val clipboardManager = remember(context) {
        context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    }

    val recentPages by viewModel.recentPages.collectAsStateWithLifecycle()
    val pages by viewModel.pages.collectAsStateWithLifecycle()
    val openLink by viewModel.openLink.collectAsStateWithLifecycle()
    val syncStatus by viewModel.syncStatus.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    var tab by rememberSaveable { mutableStateOf(HomeTab.VIDEOS) }

    LaunchedEffect(Unit) { viewModel.refresh() }

    // Navigation is driven by pendingOpen/pendingOpenUrl (StateFlows) so a share
    // intent that fires before this effect subscribes is still picked up.
    LaunchedEffect(viewModel) {
        viewModel.pendingOpen.collect { videoId ->
            if (videoId != null) {
                viewModel.consumePendingOpen()
                onOpenVideo(videoId)
            }
        }
    }
    LaunchedEffect(viewModel) {
        viewModel.pendingOpenUrl.collect { url ->
            if (url != null) {
                viewModel.consumePendingOpenUrl()
                onOpenReader(url)
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
                placeholder = { Text("Paste a link") },
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

            Spacer(Modifier.height(16.dp))

            SegmentedTabs(tab, onSelect = { tab = it })

            Spacer(Modifier.height(16.dp))

            Box(modifier = Modifier.fillMaxSize()) {
                when (tab) {
                    HomeTab.VIDEOS -> VideosTab(recentPages, onOpenVideo)
                    HomeTab.PAGES -> PagesTab(
                        pages = pages,
                        onOpen = onOpenReader,
                        onRemove = { item ->
                            // Optimistic UI: drop locally, then let the janitor decide.
                            viewModel.removeFromPages(item)
                        },
                    )
                }

                Text(
                    text = "Build: ${com.scholiast.android.BuildConfig.BUILD_TIME} (${com.scholiast.android.BuildConfig.VERSION_NAME})",
                    style = MaterialTheme.typography.labelSmall,
                    color = TextDisabled,
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(bottom = 4.dp),
                )
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

// ------------------------------------------------------------------ tabs

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SegmentedTabs(selected: HomeTab, onSelect: (HomeTab) -> Unit) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(modifier = Modifier.padding(4.dp)) {
            for (tab in HomeTab.entries) {
                val isSelected = tab == selected
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(9.dp))
                        .background(
                            if (isSelected) MaterialTheme.colorScheme.primary
                            else Color.Transparent
                        )
                        .combinedClickable(onClick = { onSelect(tab) })
                        .padding(vertical = 8.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = tab.label,
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (isSelected) MaterialTheme.colorScheme.onPrimary
                        else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun VideosTab(recentPages: List<RecentVideo>, onOpenVideo: (String) -> Unit) {
    if (recentPages.isEmpty()) {
        EmptyState()
    } else {
        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 340.dp),
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 24.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            items(recentPages, key = { it.videoId }) { video ->
                RecentVideoCard(video, onClick = { onOpenVideo(video.videoId) })
            }
        }
    }
}

/** Reader pages (Task 28): favicon rows over `pagesWithHighlights()`. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PagesTab(
    pages: List<PageListItem>,
    onOpen: (String) -> Unit,
    onRemove: suspend (PageListItem) -> Boolean,
) {
    val scope = rememberCoroutineScope()
    if (pages.isEmpty()) {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.MenuBook,
                contentDescription = null,
                tint = TextDisabled,
                modifier = Modifier.size(56.dp),
            )
            Spacer(Modifier.height(16.dp))
            Text(
                text = "No pages yet",
                style = MaterialTheme.typography.titleMedium,
                color = TextSecondary,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = "Share any webpage to Scholiast",
                style = MaterialTheme.typography.bodyMedium,
                color = TextDisabled,
                textAlign = TextAlign.Center,
            )
        }
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        items(pages, key = { it.url }) { page ->
            PageRow(
                page = page,
                onClick = { onOpen(page.url) },
                onLongClick = { scope.launch { onRemove(page) } },
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PageRow(
    page: PageListItem,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .combinedClickable(onClick = onClick, onLongClickLabel = "Remove from list", onLongClick = onLongClick)
            .padding(horizontal = 4.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FaviconAvatar(domain = page.domain)
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = cleanTitle(page.title) ?: page.domain,
                style = MaterialTheme.typography.bodyLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = pageMetadata(page),
                style = MaterialTheme.typography.bodySmall,
                color = TextSecondary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/**
 * Coil favicon (`https://<domain>/favicon.ico`) over a letter-avatar fallback:
 * the avatar paints underneath, so a failed/slow fetch simply shows through.
 */
@Composable
private fun FaviconAvatar(domain: String) {
    Box(
        modifier = Modifier
            .size(40.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(avatarColor(domain)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = domain.removePrefix("www.").firstOrNull()?.uppercase() ?: "?",
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onPrimary,
        )
        AsyncImage(
            model = "https://$domain/favicon.ico",
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(40.dp),
        )
    }
}

/** Deterministic per-domain avatar tint. */
private fun avatarColor(domain: String): Color {
    val palette = listOf(
        Color(0xFF5B5BD6), Color(0xFF9C4DCC), Color(0xFFB3577A),
        Color(0xFF8A6D3B), Color(0xFF2E7D6B), Color(0xFF4560A0),
    )
    return palette[domain.hashCode().mod(palette.size)]
}

/** Dashboard rule: drop the CMS's trailing ` | Site` tail. */
internal fun cleanTitle(title: String?): String? =
    title?.takeIf { it.isNotBlank() }?.substringBeforeLast(" | ", missingDelimiterValue = title)

private fun pageMetadata(page: PageListItem): String {
    val parts = mutableListOf(page.domain)
    when (page.highlightCount) {
        0 -> Unit
        1 -> parts += "1 highlight"
        else -> parts += "${page.highlightCount} highlights"
    }
    page.lastOpenedAt?.let {
        parts += DateUtils.getRelativeTimeSpanString(it).toString()
    }
    return parts.joinToString(" · ")
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
        SyncStatus.Syncing -> "Syncing…" to MaterialTheme.colorScheme.primary
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
