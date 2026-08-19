package com.scholiast.android.ui.notes

import androidx.lifecycle.ViewModel
import com.scholiast.android.data.model.VideoItem
import com.scholiast.android.data.notes.VideoItemRepository
import com.scholiast.android.data.notes.makeVideoNote
import java.util.Random
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * UI state for the Notes tab. [items] is the page's items in video-time order
 * (ascending — the timeline reads top-down as the video progresses, ties in
 * repository order, i.e. newest-last). [canUndoDelete] is true between a
 * [NotesViewModel.deleteItem] and the matching [NotesViewModel.undoDelete].
 */
data class NotesUiState(
    val items: List<VideoItem> = emptyList(),
    val canUndoDelete: Boolean = false,
)

/**
 * The editor sheet's draft — what the "＋ New note" / reply / edit flows hand to
 * Task 07's `CommentEditorSheet`. [itemId] is null for a NEW note (the sheet
 * creates one at [videoTime]); non-null when the sheet is editing/replying to an
 * existing item. [videoTime] is baked into the saved item, never into the text.
 */
data class EditorDraft(
    val itemId: String? = null,
    val videoTime: Double,
    val text: String = "",
)

/**
 * Supplies the player's current playback position in seconds. Task 05's
 * `PlayerBridge` implements this (plan §3.4 `getCurrentTime`); the Notes tab
 * reads it when the user taps "＋ New note" to bake the moment into the draft.
 */
fun interface VideoTimeProvider {
    fun currentTime(): Double
}

/**
 * Receives M:SS chip / timestamp-chip seek requests. Task 05's `PlayerBridge`
 * implements this (plan §3.4 `seekTo`); seconds are clamped ≥ 0 by the bridge.
 */
fun interface SeekRequestListener {
    fun seekTo(seconds: Double)
}

/**
 * Deletes the frame JPEG for a deleted frame item. Task 14 (frame store,
 * `filesDir/frames/<itemId>.jpg`) implements this; the ViewModel invokes it on
 * every `kind == "frame"` delete so the file can never outlive its item.
 */
fun interface FrameFileDeleteHook {
    fun deleteFrameFile(itemId: String)
}

/**
 * The Notes tab's state holder: page items from [VideoItemRepository],
 * add/update/delete (with undo), and seek forwarding. All mutations are
 * suspend and update [state] in the calling coroutine, so unit tests run
 * deterministically with `runBlocking` (no Main dispatcher needed).
 *
 * Task 02's repository exposes no change Flow, so the UI drives [load] on
 * resume/tab activation (NotesTab's `LifecycleResumeEffect`); a future
 * repository `observe(url)` can replace that.
 */
class NotesViewModel(
    private val repository: VideoItemRepository,
    private val url: String,
) : ViewModel() {

    private val _state = MutableStateFlow(NotesUiState())
    val state: StateFlow<NotesUiState> = _state.asStateFlow()

    /** Wired by Task 05's PlayerScreen to the player bridge. */
    var seekListener: SeekRequestListener? = null

    /** Wired by Task 14 (frame store). */
    var frameFileDeleteHook: FrameFileDeleteHook? = null

    /** Snapshot of the page items taken at the last delete (for undo). */
    private var undoSnapshot: List<VideoItem>? = null

    /** Reload items from the repository, sorted by video time (stable). */
    suspend fun load() {
        val page = repository.loadPage(url)
        val sorted = page?.items.orEmpty().sortedBy { it.videoTime }
        _state.update { it.copy(items = sorted, canUndoDelete = it.canUndoDelete) }
    }

    /**
     * Create a new `kind = "note"` item at [videoTime] with [text] as its first
     * comment (stamped `<!--timestamp:N-->` via Task 02's helper, so sync merge
     * gets a stable id). Returns the stored item (with `updatedAt` stamped).
     */
    suspend fun addNote(text: String, videoTime: Double): VideoItem {
        val item = VideoItem(
            id = genVideoId(),
            kind = "note",
            videoTime = videoTime,
            notes = listOf(makeVideoNote(text.trim(), System.currentTimeMillis())),
        )
        val stored = repository.addItem(url, item)
        upsertInState(stored)
        return stored
    }

    /** Append a comment to [itemId]'s thread. False if the item is unknown. */
    suspend fun addReply(itemId: String, text: String): Boolean {
        val current = _state.value.items.firstOrNull { it.id == itemId } ?: return false
        val updated = current.copy(
            notes = current.notes + makeVideoNote(text.trim(), System.currentTimeMillis()),
        )
        val stored = repository.updateItem(url, updated) ?: return false
        upsertInState(stored)
        return true
    }

    /** Generic replace-by-id passthrough (Task 07/13 edit flows). */
    suspend fun updateItem(item: VideoItem): VideoItem? {
        val stored = repository.updateItem(url, item) ?: return null
        upsertInState(stored)
        return stored
    }

    /**
     * Delete [itemId] and enable undo. The page items are snapshotted FIRST
     * (the requirement) so [undoDelete] restores exactly what was there. Returns
     * the deleted item, or null when it didn't exist. Frame items also invoke
     * [FrameFileDeleteHook] (Task 14) so their JPEG file goes with them.
     */
    suspend fun deleteItem(itemId: String): VideoItem? {
        val deleted = _state.value.items.firstOrNull { it.id == itemId } ?: return null
        if (!repository.deleteItem(url, itemId)) return null
        if (deleted.kind == "frame") frameFileDeleteHook?.deleteFrameFile(itemId)
        undoSnapshot = _state.value.items
        _state.update {
            it.copy(
                items = it.items.filterNot { i -> i.id == itemId },
                canUndoDelete = true,
            )
        }
        return deleted
    }

    /**
     * Restore the page items snapshotted by the last [deleteItem]. Re-adds via
     * [VideoItemRepository.addItem] (recreates the page row if the delete
     * emptied it; stamps `updatedAt`), then reloads the authoritative list.
     */
    suspend fun undoDelete() {
        val snapshot = undoSnapshot ?: return
        for (item in snapshot) repository.addItem(url, item)
        undoSnapshot = null
        load()
        _state.update { it.copy(canUndoDelete = false) }
    }

    /** Forward a chip tap to the player (Task 05's bridge), if wired. */
    fun seekTo(seconds: Double) {
        seekListener?.seekTo(seconds)
    }

    private fun upsertInState(stored: VideoItem) {
        _state.update {
            it.copy(
                items = (it.items.filterNot { i -> i.id == stored.id } + stored)
                    .sortedBy { i -> i.videoTime },
            )
        }
    }
}

/**
 * Item id generator, ported from the desktop `genVideoId()`
 * (`Date.now().toString(36) + Math.random().toString(36).slice(2,7)`):
 * base-36 ms timestamp + 5 random base-36 chars. Format-identical to the
 * desktop (ids are opaque and cross-device unique); NOT bit-identical, because
 * Kotlin's `Double.toString(Math.random())` isn't always 7+ chars ("0.5").
 */
fun genVideoId(): String {
    val time = java.lang.Long.toString(System.currentTimeMillis(), 36)
    val rand = Random().nextInt(36 * 36 * 36 * 36 * 36).toString(36).padStart(5, '0')
    return time + rand
}