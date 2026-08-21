package com.scholiast.android.ui.notes

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExtendedFloatingActionButton
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
import com.scholiast.android.ui.voice.rememberVoiceEditorSlot
import kotlinx.coroutines.launch

/**
 * The Notes tab (plan §5.4): the video's items as a time-ordered timeline
 * (newest-last in video time), each with a seekable `M:SS` chip, plus the
 * note-creation flow that captures the player's current time into the docked
 * composer. Creation lives in an Extended FAB pinned to the panel's
 * bottom-end (zero layout cost); the empty state carries its own centered
 * CTA instead.
 *
 * @param timeProvider Task 05's bridge — read at note creation to bake
 *   the moment into the draft.
 * @param seekListener Task 05's bridge — chip taps forward here via the VM.
 */
@Composable
fun NotesTab(
    url: String,
    modifier: Modifier = Modifier,
    timeProvider: VideoTimeProvider? = null,
    seekListener: SeekRequestListener? = null,
    onPausePlayback: (() -> Unit)? = null,
    onResumePlayback: (() -> Unit)? = null,
    viewModel: NotesViewModel = notesViewModel(url),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }

    var draft by remember { mutableStateOf<EditorDraft?>(null) }
    var pendingDelete by remember { mutableStateOf<VideoItem?>(null) }

    fun openDraft(newDraft: EditorDraft) {
        draft = newDraft
        onPausePlayback?.invoke()
    }

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
        if (state.items.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                    modifier = Modifier.padding(24.dp),
                ) {
                    Text(
                        text = "No notes yet",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = "Capture timestamped notes & voice notes while watching.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    )
                    Spacer(Modifier.height(16.dp))
                    Button(
                        onClick = {
                            openDraft(
                                EditorDraft(
                                    itemId = null,
                                    videoTime = timeProvider?.currentTime() ?: 0.0,
                                )
                            )
                        },
                        modifier = Modifier.height(48.dp),
                    ) {
                        Icon(Icons.Filled.Add, contentDescription = null)
                        Text("Create note", modifier = Modifier.padding(start = 6.dp))
                    }
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 12.dp, bottom = 96.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(state.items, key = { it.id }) { item ->
                    NoteItemCard(
                        item = item,
                        onSeek = { seconds -> viewModel.seekTo(seconds) },
                        onDelete = { pendingDelete = it },
                        onAddComment = { target ->
                            openDraft(
                                EditorDraft(
                                    itemId = target.id,
                                    videoTime = target.videoTime,
                                )
                            )
                        },
                    )
                }
            }

            // Creation entry point: floats over the list's bottom-end, hidden
            // while the composer is open (its Save/× own the interaction then).
            if (draft == null) {
                ExtendedFloatingActionButton(
                    onClick = {
                        openDraft(
                            EditorDraft(
                                itemId = null,
                                videoTime = timeProvider?.currentTime() ?: 0.0,
                            )
                        )
                    },
                    icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                    text = { Text("New note") },
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .navigationBarsPadding()
                        .padding(16.dp),
                )
            }
        }

        // The composer docks to the panel's bottom edge — the video and the
        // timeline stay visible while writing.
        draft?.let { d ->
            val voice = rememberVoiceEditorSlot()
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
                    onResumePlayback?.invoke()
                },
                onCancel = {
                    draft = null
                    onResumePlayback?.invoke()
                },
                seekListener = { seconds -> viewModel.seekTo(seconds) },
                voice = voice.slot,
                onEditorViewModel = { voice.editorViewModel = it },
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .imePadding()
                    .padding(horizontal = 12.dp, vertical = 12.dp),
            )
        }

        SnackbarHost(
            hostState = snackbarHostState,
            modifier = Modifier.align(Alignment.BottomCenter),
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