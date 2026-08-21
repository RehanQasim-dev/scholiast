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
import com.scholiast.android.data.notes.PageHighlightRepository
import com.scholiast.android.data.notes.RoomPageHighlightRepository
import com.scholiast.android.data.notes.RoomVideoItemRepository
import com.scholiast.android.data.notes.VideoItemRepository
import com.scholiast.android.domain.sync.SyncGraph
import com.scholiast.android.ui.reader.ReaderPageJanitor
import com.scholiast.android.ui.sync.RepositorySyncStatusHolder
import java.net.URI
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
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
 * (`SyncStatusRepository`); until it landed, Home read this through a
 * [SyncStatusHolder] stub so the surface contract stayed stable.
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

/** Where Home reads/writes sync status. Task 18 swapped the stub for a repository-backed one. */
interface SyncStatusHolder {
    val status: StateFlow<SyncStatus>
    fun set(status: SyncStatus)
}

/** Plain in-memory [SyncStatusHolder] — used by unit tests. */
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
 * - Recent videos come from [VideoItemRepository.listRecentPages]; note counts
 *   decode each page's `itemsJson`.
 * - Pages-tab rows come from [PageHighlightRepository.pagesWithHighlights]
 *   (Task 28): every page carrying highlights or reader content.
 * - Opening is exposed via two pending StateFlows — NOT one-shot events —
 *   because MainActivity's share intent can fire before the screen's
 *   composition subscribes, and a SharedFlow(replay=0) would silently drop it:
 *     - [pendingOpen] carries a YouTube videoId → Player.
 *     - [pendingOpenUrl] carries any other http(s) page url → Reader (Task 28).
 * - Toasts go through [pendingToast] for the same reason.
 * - [parseShareText] / [submitOpenLink] route by URL type: YouTube → Player,
 *   other URL → Reader, invalid → toast.
 *
 * The ViewModel is ACTIVITY-scoped so MainActivity resolves the same instance;
 * see [factory].
 */
class HomeViewModel(
    private val repository: VideoItemRepository,
    private val syncStatusHolder: SyncStatusHolder = InMemorySyncStatusHolder(),
    private val pageRepository: PageHighlightRepository? = null,
    private val removePageItem: suspend (url: String) -> Boolean = { false },
) : ViewModel() {

    private val _recentPages = MutableStateFlow<List<RecentVideo>>(emptyList())
    val recentPages: StateFlow<List<RecentVideo>> = _recentPages.asStateFlow()

    /** Pages-tab rows (Task 28): pages with highlights or reader content, newest first. */
    private val _pages = MutableStateFlow<List<com.scholiast.android.data.notes.PageListItem>>(emptyList())
    val pages: StateFlow<List<com.scholiast.android.data.notes.PageListItem>> = _pages.asStateFlow()

    private val _openLink = MutableStateFlow("")
    val openLink: StateFlow<String> = _openLink.asStateFlow()

    /** A videoId the user wants opened. The screen consumes it once and navigates. */
    private val _pendingOpen = MutableStateFlow<String?>(null)
    val pendingOpen: StateFlow<String?> = _pendingOpen.asStateFlow()

    /** A non-YouTube page url the user wants opened → Reader. Same contract as [pendingOpen]. */
    private val _pendingOpenUrl = MutableStateFlow<String?>(null)
    val pendingOpenUrl: StateFlow<String?> = _pendingOpenUrl.asStateFlow()

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

    /**
     * Open-link field submit: strict single-URL parse routed by type —
     * YouTube → Player, other http(s) URL → Reader, invalid → toast.
     */
    fun submitOpenLink() {
        val value = _openLink.value.trim()
        extractVideoIdFromText(value)?.let { videoId ->
            _openLink.value = ""
            openVideo(videoId)
            return
        }
        extractUrlFromText(value)?.let { url ->
            _openLink.value = ""
            openPage(url)
            return
        }
        _pendingToast.value = NOT_YOUTUBE_LINK
    }

    /**
     * Share-intent entry point (MainActivity ACTION_SEND text/plain). Extracts
     * a YouTube id or a plain URL from the shared text — tolerating surrounding
     * prose — routes by type, invalid text → toast.
     */
    fun parseShareText(text: String?) {
        val value = text.orEmpty()
        extractVideoIdFromText(value)?.let { openVideo(it); return }
        extractUrlFromText(value)?.let { openPage(it); return }
        _pendingToast.value = NOT_YOUTUBE_LINK
    }

    /** Re-fetch both lists (initial load; re-runs when Home re-enters composition). */
    fun refresh() {
        viewModelScope.launch { reload() }
    }

    /** Suspend reload — public so unit tests can drive it without a Main dispatcher. */
    suspend fun reload() {
        _recentPages.value = repository.listRecentPages(RECENT_LIMIT).mapNotNull(::toRecentVideo)
        _pages.value = pageRepository?.pagesWithHighlights()?.first().orEmpty()
    }

    /** Task 18 wired real sync status in here. */
    fun updateSyncStatus(status: SyncStatus) {
        syncStatusHolder.set(status)
    }

    /** Consume the pending video open request; returns null when there is none. */
    fun consumePendingOpen(): String? {
        val videoId = _pendingOpen.value
        if (videoId != null) _pendingOpen.value = null
        return videoId
    }

    /** Consume the pending reader open request; returns null when there is none. */
    fun consumePendingOpenUrl(): String? {
        val url = _pendingOpenUrl.value
        if (url != null) _pendingOpenUrl.value = null
        return url
    }

    /** Consume the pending toast; returns null when there is none. */
    fun consumePendingToast(): String? {
        val message = _pendingToast.value
        if (message != null) _pendingToast.value = null
        return message
    }

    /**
     * Long-press remove on a Pages row (plan §5.1): tombstones nothing. Only
     * reader-only entries can leave the list; pages with highlights stay.
     * Returns whether the entry was removed (list refresh follows).
     */
    suspend fun removeFromPages(item: com.scholiast.android.data.notes.PageListItem): Boolean =
        removePageItem(item.url)

    private fun openVideo(videoId: String) {
        _pendingOpen.value = videoId
    }

    private fun openPage(url: String) {
        _pendingOpenUrl.value = url
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

    /**
     * Non-YouTube http(s) URL extraction (Task 28 routing): strict single-URL
     * first, then prose scan; normalized so Reader keys match storage/sync.
     */
    private fun extractUrlFromText(text: String): String? {
        val candidate = if (text.startsWith("http://") || text.startsWith("https://")) {
            text.trim()
        } else {
            URL_TOKEN_REGEX.find(text)?.value ?: return null
        }
        return normalizeHttpUrl(candidate)
    }

    private fun normalizeHttpUrl(url: String): String? = try {
        val uri = URI(url)
        val scheme = uri.scheme?.lowercase()
        if ((scheme == "http" || scheme == "https") && !uri.host.isNullOrBlank()) {
            Normalize.normalizeUrl(url)
        } else {
            null
        }
    } catch (_: Exception) {
        null
    }

    companion object {
        /** Kept from Task 04 (existing toast copy; spec: "invalid → existing toast"). */
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
                val dao = database.videoPageDao()
                HomeViewModel(
                    repository = RoomVideoItemRepository(dao),
                    // The sync worker owns writes; Home only reads.
                    syncStatusHolder = RepositorySyncStatusHolder(SyncGraph.repository(application)),
                    pageRepository = RoomPageHighlightRepository(dao),
                    removePageItem = { url -> ReaderPageJanitor(dao).removeFromList(url) },
                )
            }
        }
    }
}
