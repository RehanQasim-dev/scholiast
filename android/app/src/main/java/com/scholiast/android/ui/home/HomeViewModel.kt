package com.scholiast.android.ui.home

import android.app.Application
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.scholiast.android.data.db.AppDatabase
import com.scholiast.android.data.db.VideoPageEntity
import com.scholiast.android.data.model.ScholiastJson
import com.scholiast.android.data.model.VideoItem
import com.scholiast.android.data.normalize.Normalize
import com.scholiast.android.data.notes.RoomVideoItemRepository
import com.scholiast.android.data.notes.VideoItemRepository
import com.scholiast.android.domain.sync.SyncGraph
import com.scholiast.android.ui.sync.RepositorySyncStatusHolder
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** One card in the Home recent-videos grid. */
data class RecentVideo(
    val videoId: String,
    val title: String,
    val noteCount: Int,
    val lastOpenedAt: Long,
    val url: String,
)

/**
 * Home's sync-status chip state. Task 18 owns the real status source
 * (`SyncStatusRepository`); until it lands, Home reads this through a
 * [SyncStatusHolder] stub so the surface contract is stable.
 */
sealed interface SyncStatus {
    /** Not connected to Google Drive (default until Task 16/18). */
    data object Disconnected : SyncStatus

    /** A sync run is in flight. */
    data object Syncing : SyncStatus

    /** Last full reconcile finished at [lastSyncedAt] (ms). */
    data class Synced(val lastSyncedAt: Long) : SyncStatus

    /** A sync run failed with [message]. */
    data class Error(val message: String) : SyncStatus
}

/** Where Home reads/writes sync status. Task 18 swaps the in-memory stub for a repository-backed one. */
interface SyncStatusHolder {
    val status: StateFlow<SyncStatus>
    fun set(status: SyncStatus)
}

/** Plain in-memory [SyncStatusHolder] — the stub until Task 18's SyncStatusRepository exists. */
class InMemorySyncStatusHolder : SyncStatusHolder {
    private val _status = MutableStateFlow<SyncStatus>(SyncStatus.Disconnected)
    override val status: StateFlow<SyncStatus> = _status.asStateFlow()
    override fun set(status: SyncStatus) {
        _status.value = status
    }
}

/**
 * State and entry points for the Home screen.
 *
 * - Recent pages come from [VideoItemRepository.listRecentPages] (newest first
 *   by last item mutation); note counts decode each page's `itemsJson`.
 * - Opening a video (paste, share intent, open-link submit) is exposed via
 *   [pendingOpen] — a StateFlow, NOT a one-shot event — because MainActivity's
 *   share intent can fire before the screen's composition subscribes, and a
 *   SharedFlow(replay=0) would silently drop it. The screen consumes the value
 *   and navigates.
 * - Toasts go through [pendingToast] for the same reason: a share intent with
 *   invalid text on cold start must still show its "Not a YouTube link" toast
 *   once Home composes. The screen consumes the value when it shows the snackbar.
 * - [parseShareText] is the share-intent entry point (ACTION_SEND text/plain).
 *   It tolerates surrounding prose in the shared text; the Open-link field uses
 *   the strict [Normalize.extractVideoId] form.
 *
 * The ViewModel is ACTIVITY-scoped (created against the activity's
 * ViewModelStore) so MainActivity can resolve the same instance and call
 * [parseShareText]; see [factory].
 */
class HomeViewModel(
    private val repository: VideoItemRepository,
    private val syncStatusHolder: SyncStatusHolder = InMemorySyncStatusHolder(),
) : ViewModel() {

    private val _recentPages = MutableStateFlow<List<RecentVideo>>(emptyList())
    val recentPages: StateFlow<List<RecentVideo>> = _recentPages.asStateFlow()

    private val _openLink = MutableStateFlow("")
    val openLink: StateFlow<String> = _openLink.asStateFlow()

    /** A videoId the user wants opened. The screen consumes it once and navigates. */
    private val _pendingOpen = MutableStateFlow<String?>(null)
    val pendingOpen: StateFlow<String?> = _pendingOpen.asStateFlow()

    /**
     * A toast waiting to be shown. A StateFlow, not a one-shot SharedFlow, so a
     * toast emitted before Home's composition subscribes (cold-start share with
     * invalid text) is not dropped — the collector reads the current value on
     * subscribe. The screen consumes it after showing the snackbar.
     */
    private val _pendingToast = MutableStateFlow<String?>(null)
    val pendingToast: StateFlow<String?> = _pendingToast.asStateFlow()

    val syncStatus: StateFlow<SyncStatus> = syncStatusHolder.status

    /** Open-link field text. */
    fun onOpenLinkChange(text: String) {
        _openLink.value = text
    }

    /** Open-link field submit: strict single-URL parse; invalid → "Not a YouTube link" toast. */
    fun submitOpenLink() {
        val videoId = Normalize.extractVideoId(_openLink.value.trim())
        if (videoId == null) {
            _pendingToast.value = NOT_YOUTUBE_LINK
        } else {
            _openLink.value = ""
            openVideo(videoId)
        }
    }

    /**
     * Share-intent entry point (MainActivity ACTION_SEND text/plain). Extracts
     * a YouTube id from the shared text — tolerating surrounding prose — and
     * opens the player; invalid text → toast.
     */
    fun parseShareText(text: String?) {
        val videoId = extractVideoIdFromText(text.orEmpty())
        if (videoId != null) {
            openVideo(videoId)
        } else {
            _pendingToast.value = NOT_YOUTUBE_LINK
        }
    }

    /** Re-fetch recent pages (initial load; pull-to-refresh later). Runtime entry point. */
    fun refresh() {
        viewModelScope.launch { reload() }
    }

    /** Suspend reload — public so unit tests can drive it without a Main dispatcher. */
    suspend fun reload() {
        _recentPages.value = repository.listRecentPages(RECENT_LIMIT).mapNotNull(::toRecentVideo)
    }

    /** Task 18 wires real sync status in here. */
    fun updateSyncStatus(status: SyncStatus) {
        syncStatusHolder.set(status)
    }

    /** Consume the pending open request; returns null when there is none. */
    fun consumePendingOpen(): String? {
        val videoId = _pendingOpen.value
        if (videoId != null) _pendingOpen.value = null
        return videoId
    }

    /** Consume the pending toast; returns null when there is none. */
    fun consumePendingToast(): String? {
        val message = _pendingToast.value
        if (message != null) _pendingToast.value = null
        return message
    }

    private fun openVideo(videoId: String) {
        _pendingOpen.value = videoId
    }

    private fun toRecentVideo(page: VideoPageEntity): RecentVideo? {
        val videoId = page.videoId ?: return null
        val items = runCatching { ScholiastJson.decode<List<VideoItem>>(page.itemsJson) }
            .getOrDefault(emptyList())
        return RecentVideo(
            videoId = videoId,
            title = page.title?.takeIf { it.isNotBlank() } ?: "Untitled video",
            noteCount = items.size,
            lastOpenedAt = page.updatedAt,
            url = page.url,
        )
    }

    /** Strict single-URL first, then scan for a URL token inside longer share text. */
    private fun extractVideoIdFromText(text: String): String? {
        Normalize.extractVideoId(text.trim())?.let { return it }
        val token = URL_TOKEN_REGEX.find(text)?.value ?: return null
        return Normalize.extractVideoId(token)
    }

    companion object {
        const val NOT_YOUTUBE_LINK = "Not a YouTube link"
        private const val RECENT_LIMIT = 50
        private val URL_TOKEN_REGEX = Regex("https?://[^\\s<>\"']+", RegexOption.IGNORE_CASE)

        /**
         * Builds the activity-scoped instance from Room. MainActivity wires the
         * same factory via `by viewModels { HomeViewModel.factory(application) }`
         * so share intents reach the exact instance HomeScreen collects.
         */
        fun factory(application: Application): ViewModelProvider.Factory = viewModelFactory {
            initializer {
                val database = AppDatabase.getInstance(application)
                HomeViewModel(
                    repository = RoomVideoItemRepository(database.videoPageDao()),
                    // Task 18: repository-backed holder — the sync worker owns
                    // writes; Home only reads (the old in-memory stub is gone).
                    syncStatusHolder = RepositorySyncStatusHolder(SyncGraph.repository(application)),
                )
            }
        }
    }
}