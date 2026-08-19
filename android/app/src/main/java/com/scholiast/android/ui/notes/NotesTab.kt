package com.scholiast.android.ui.notes

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.scholiast.android.data.db.AppDatabase
import com.scholiast.android.data.model.VideoItem
import com.scholiast.android.data.notes.RoomVideoItemRepository
import com.scholiast.android.ui.notes.editor.CommentEditorSheet
import kotlinx.coroutines.launch

/**
 * The Notes tab (plan §5.4): the video's items as a time-ordered timeline
 * (newest-last in video time), each with a seekable `M:SS` chip, plus the
 * "＋ New note" flow that captures the player's current time into the editor
 * sheet. Hosted by Task 05's PlayerScreen panel slot.
 *
 * @param timeProvider Task 05's bridge — read at "＋ New note" press to bake
 *   the moment into the draft.
 * @param seekListener Task 05's bridge — chip taps forward here via the VM.
 */
@Composable
fun NotesTab(
    url: String,
    modifier: Modifier = Modifier,
    timeProvider: VideoTimeProvider? = null,
    seekListener: SeekRequestListener? = null,
    viewModel: NotesViewModel = notesViewModel(url),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }

    var draft by remember { mutableStateOf<EditorDraft?>(null) }
    var pendingDelete by remember { mutableStateOf<VideoItem?>(null) }

    // Live updates: Task 02's repository exposes no Flow, so reload whenever
    // the tab (re)appears — catches external writes (sync, transcript panel).
    LifecycleResumeEffect(url) {
        scope.launch { viewModel.load() }
        onPauseOrDispose { }
    }
    LaunchedEffect(url) {
        viewModel.seekListener = seekListener
    }

    Box(modifier = modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("Notes", style = MaterialTheme.typography.titleMedium)
                Button(
                    onClick = {
                        draft = EditorDraft(
                            itemId = null,
                            videoTime = timeProvider?.currentTime() ?: 0.0,
                        )
                    },
                    modifier = Modifier.height(48.dp),
                ) {
                    Icon(Icons.Filled.Add, contentDescription = null)
                    Text("New note", modifier = Modifier.padding(start = 6.dp))
                }
            }
            HorizontalDivider()
            if (state.items.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        text = "No notes yet — tap ＋ New note to add one at the current moment.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(24.dp),
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(12.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(state.items, key = { it.id }) { item ->
                        NoteItemCard(
                            item = item,
                            onSeek = { seconds -> viewModel.seekTo(seconds) },
                            onDelete = { pendingDelete = it },
                            onAddComment = { target ->
                                draft = EditorDraft(
                                    itemId = target.id,
                                    videoTime = target.videoTime,
                                )
                            },
                        )
                    }
                }
            }
        }

        SnackbarHost(
            hostState = snackbarHostState,
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }

    draft?.let { d ->
        CommentEditorSheet(
            draft = d,
            timestampSeconds = d.videoTime,
            onSave = { text ->
                draft = null
                if (text.isNotBlank()) {
                    scope.launch {
                        if (d.itemId == null) {
                            viewModel.addNote(text, d.videoTime)
                        } else {
                            viewModel.addReply(d.itemId, text)
                        }
                    }
                }
            },
            onCancel = { draft = null },
            seekListener = { seconds -> viewModel.seekTo(seconds) },
        )
    }

    pendingDelete?.let { item ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("Delete ${kindLabel(item)}?") },
            text = { Text("This removes the item and its comment thread.") },
            confirmButton = {
                TextButton(onClick = {
                    val id = item.id
                    pendingDelete = null
                    scope.launch {
                        val deleted = viewModel.deleteItem(id)
                        if (deleted != null) {
                            val result = snackbarHostState.showSnackbar(
                                message = "Note deleted",
                                actionLabel = "Undo",
                                duration = SnackbarDuration.Short,
                            )
                            if (result == SnackbarResult.ActionPerformed) {
                                viewModel.undoDelete()
                            }
                        }
                    }
                }) {
                    Text("Delete", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { pendingDelete = null }) {
                    Text("Cancel")
                }
            },
        )
    }
}

/** Kind label used by the delete dialog; mirrors the card's icon label. */
private fun kindLabel(item: VideoItem): String = when (item.kind) {
    "frame" -> "frame"
    "transcript" -> "transcript highlight"
    else -> "note"
}

/** Builds the screen's [NotesViewModel] against the app's Room repository. */
@Composable
fun notesViewModel(url: String): NotesViewModel {
    val appContext = LocalContext.current.applicationContext
    val db = AppDatabase.getInstance(appContext)
    return viewModel(
        key = "notes:$url",
        factory = NotesViewModelFactory(url, RoomVideoItemRepository(db.videoPageDao())),
    )
}

/** [ViewModelProvider.Factory] for [NotesViewModel]. */
class NotesViewModelFactory(
    private val url: String,
    private val repository: com.scholiast.android.data.notes.VideoItemRepository,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T =
        NotesViewModel(repository, url) as T
}