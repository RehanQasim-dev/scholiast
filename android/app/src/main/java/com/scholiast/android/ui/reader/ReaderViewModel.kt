package com.scholiast.android.ui.reader

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.scholiast.android.data.db.AppDatabase
import com.scholiast.android.data.db.VideoPageDao
import com.scholiast.android.data.model.LinearArticle
import com.scholiast.android.data.model.ScholiastJson
import com.scholiast.android.data.normalize.Normalize
import com.scholiast.android.data.notes.PageHighlightRepository
import com.scholiast.android.data.notes.RoomPageHighlightRepository
import com.scholiast.android.data.prefs.ReaderPrefs
import com.scholiast.android.data.prefs.ReaderSettings
import com.scholiast.android.domain.reader.ExtractResult
import com.scholiast.android.domain.reader.Extractor
import com.scholiast.android.domain.reader.Linearizer
import com.scholiast.android.ui.home.InMemorySyncStatusHolder
import com.scholiast.android.ui.home.SyncStatus
import com.scholiast.android.ui.home.SyncStatusHolder
import com.scholiast.android.ui.sync.RepositorySyncStatusHolder
import com.scholiast.android.domain.sync.SyncGraph
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient

/** What the reader surface is showing right now (plan §5.2). */
sealed interface ReaderUiState {
    /** Cache lookup / fetch / linearize in flight. */
    data object Loading : ReaderUiState

    /** A [LinearArticle] is on screen (from cache or a fresh extraction). */
    data class Ready(val article: LinearArticle) : ReaderUiState

    /**
     * The page fetched fine but holds no extractable article (CSR/paywall shell)
     * → read-only WebView fallback of the live url.
     */
    data class Shell(val reason: String?) : ReaderUiState

    /** Network/HTTP failure → error card with retry + open-in-browser. */
    data class Failed(val message: String) : ReaderUiState
}

/**
 * Persists the reader scroll position per page so reopening resumes where the
 * user left off (plan §5.3). SharedPreferences keyed by url hash — deliberately
 * NOT a Room column: Task 28 may not touch the schema, and scroll state is
 * device-local by nature (never synced).
 *
 * Stores the exact LazyList restore point (`firstVisibleItemIndex` +
 * `firstVisibleItemScrollOffset`), not a fraction, so restoration is precise.
 */
class ReaderScrollStore(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun load(url: String): Pair<Int, Int>? {
        val key = key(url)
        if (!prefs.contains(KEY_INDEX + key)) return null
        return prefs.getInt(KEY_INDEX + key, 0) to prefs.getInt(KEY_OFFSET + key, 0)
    }

    fun save(url: String, index: Int, offset: Int) {
        if (index <= 0 && offset <= 0) return // don't pin the top of an article nobody scrolled
        prefs.edit()
            .putInt(KEY_INDEX + key(url), index)
            .putInt(KEY_OFFSET + key(url), offset)
            .apply()
    }

    fun clear(url: String) {
        prefs.edit()
            .remove(KEY_INDEX + key(url))
            .remove(KEY_OFFSET + key(url))
            .apply()
    }

    private fun key(url: String): String = Normalize.urlHash(Normalize.normalizeUrl(url))

    private companion object {
        const val PREFS_NAME = "scholiast_reader_scroll"
        const val KEY_INDEX = "idx_"
        const val KEY_OFFSET = "off_"
    }
}

/**
 * Row-level cleanup for reader pages, shared by Home's long-press remove and
 * the reader overflow's "Delete page data". Lives next to the ViewModels that
 * consume it; touches only the annotation/reader columns of `video_pages` and
 * never clobbers video items or sync bookkeeping.
 */
class ReaderPageJanitor(private val dao: VideoPageDao) {

    /**
     * Home long-press "remove from list" (plan §5.1): tombstones nothing. A row
     * with annotations stays (its highlights are real data); otherwise the
     * reader cache is dropped — deleting the whole row when it holds nothing
     * else, so the entry disappears from `pagesWithHighlights()`.
     */
    suspend fun removeFromList(url: String): Boolean {
        val hash = Normalize.urlHash(Normalize.normalizeUrl(url))
        val entity = dao.getEntity(hash) ?: return false
        val hasHighlights = runCatching { entity.highlights }.getOrDefault(emptyList()).isNotEmpty()
        if (hasHighlights) return false
        if (entity.itemsJson == "[]") {
            dao.delete(hash)
        } else {
            dao.upsert(entity.copy(readerJson = null))
        }
        return true
    }

    /**
     * Reader overflow "Delete page data": wipes this page's annotations (the
     * `[ ]` sentinel makes the next sync tombstone them, mirroring a deliberate
     * local delete-to-empty), its reader cache and its scroll position. Video
     * items on the same row are kept.
     */
    suspend fun deletePageData(url: String) {
        val hash = Normalize.urlHash(Normalize.normalizeUrl(url))
        val entity = dao.getEntity(hash) ?: return
        if (entity.itemsJson != "[]") {
            dao.upsert(
                entity.copy(
                    highlightsJson = RoomPageHighlightRepository.EMPTY_HIGHLIGHTS_JSON,
                    readerJson = null,
                )
            )
        } else {
            dao.delete(hash)
        }
    }
}

/**
 * The extraction seam behind [ReaderViewModel]: production wires the real
 * [Extractor] here (`ReaderFetcher { url -> Extractor(client).extract(url) }`);
 * unit tests substitute canned [ExtractResult]s so no test touches a network.
 */
fun interface ReaderFetcher {
    suspend fun extract(url: String): ExtractResult
}

/**
 * State and entry points for one Reader destination (plan §5.1–5.3).
 *
 * Load chain: cached `readerJson`? render instantly : [ReaderFetcher.extract] →
 * Linearizer.linearize → saveReaderArticle → render. Shell → read-only WebView
 * fallback state; Failed → error card state.
 *
 * [loadOnce] is suspend + public so unit tests drive the whole chain without a
 * Main dispatcher (same pattern as HomeViewModel.reload); [load]/[retry] wrap
 * it in viewModelScope for the runtime UI.
 */
class ReaderViewModel(
    /** The NORMALIZED page url — also the repository/sync key. */
    val url: String,
    private val repository: PageHighlightRepository,
    private val fetcher: ReaderFetcher,
    private val linearizer: Linearizer = Linearizer(),
    private val prefs: ReaderPrefs? = null,
    private val scrollStore: ReaderScrollStore? = null,
    private val janitor: ReaderPageJanitor? = null,
    syncStatusHolder: SyncStatusHolder = InMemorySyncStatusHolder(),
) : ViewModel() {

    private val _state = MutableStateFlow<ReaderUiState>(ReaderUiState.Loading)
    val state: StateFlow<ReaderUiState> = _state.asStateFlow()

    val syncStatus: StateFlow<SyncStatus> = syncStatusHolder.status

    /** Typography settings as a cold Flow — the screen collects it (no Main dispatcher needed to construct). */
    val settings: Flow<ReaderSettings> get() = prefs?.settings ?: flowOf(ReaderSettings())

    /** The full load chain; tests drive this directly via runBlocking. */
    suspend fun loadOnce(): ReaderUiState {
        _state.value = ReaderUiState.Loading
        repository.readerArticle(url)?.let { cached ->
            return ReaderUiState.Ready(cached).also { _state.value = it }
        }
        return when (val result = fetcher.extract(url)) {
            is ExtractResult.Success -> {
                val article = linearizer.linearize(
                    article = result.article,
                    baseUrl = url,
                    title = result.title,
                    byline = result.byline,
                    fetchedAt = System.currentTimeMillis(),
                )
                repository.saveReaderArticle(article)
                ReaderUiState.Ready(article).also { _state.value = it }
            }
            is ExtractResult.Shell -> ReaderUiState.Shell(result.reason).also { _state.value = it }
            is ExtractResult.Failed -> ReaderUiState.Failed(result.error).also { _state.value = it }
        }
    }

    /** Runtime entry point (screen composition). */
    fun load() {
        viewModelScope.launch { loadOnce() }
    }

    /** Error-card retry: re-runs the whole chain (cache first, in case a pull landed meanwhile). */
    fun retry() {
        viewModelScope.launch { loadOnce() }
    }

    // --- typography ---------------------------------------------------------

    fun setFontStep(step: Int) {
        val p = prefs ?: return
        viewModelScope.launch { p.setFontStep(step) }
    }

    fun setSerif(serif: Boolean) {
        val p = prefs ?: return
        viewModelScope.launch { p.setSerif(serif) }
    }

    fun setWideWidth(wideWidth: Boolean) {
        val p = prefs ?: return
        viewModelScope.launch { p.setWideWidth(wideWidth) }
    }

    // --- scroll persistence -------------------------------------------------

    private var scrollJob: Job? = null

    /** Called from the list's scroll listener; persisted after [SCROLL_SAVE_DEBOUNCE_MS]. */
    fun onScroll(index: Int, offset: Int) {
        val store = scrollStore ?: return
        scrollJob?.cancel()
        scrollJob = viewModelScope.launch {
            delay(SCROLL_SAVE_DEBOUNCE_MS)
            store.save(url, index, offset)
        }
    }

    /** The saved restore point for this page, if any. */
    fun savedScroll(): Pair<Int, Int>? = scrollStore?.load(url)

    /** Drop the saved scroll (used when the page's data is deleted). */
    fun clearScroll() {
        scrollStore?.clear(url)
    }

    // --- destructive --------------------------------------------------------

    /** Overflow "Delete page data" (typed-confirm dialog lives in the screen). */
    fun deletePageData() {
        viewModelScope.launch {
            janitor?.deletePageData(url)
            scrollStore?.clear(url)
        }
    }

    // --- VOICE-WIRE (Task 30: ui/reader/ReaderVoiceIntegration.kt) ------------
    // Minimal routing surface for the reader's voice-note flow. All flow logic
    // lives in ReaderVoiceIntegration/VoiceNoteController; the ViewModel only
    // exposes the two hooks other surfaces (Task 31 thread sheet, Task 32
    // integration pass) need. No restructuring of the code above.

    /** Hook 1 — mic pressed on the swatch pill → into the voice-note flow. */
    var onMicPressed: ((HighlightDraftTarget) -> Unit)? = null

    /** Hook 2a — repository access so the integration can append to notes[]. */
    val highlightStore: PageHighlightRepository get() = repository

    /** Hook 2b — kept session-draft lookup, installed by [ReaderVoiceIntegration]. */
    internal var voiceDraftLookup: ((String) -> String?)? = null

    /** The session draft kept for [highlightId], if any (pre-fill on reopen). */
    fun voiceDraftFor(highlightId: String): String? = voiceDraftLookup?.invoke(highlightId)

    // --- end VOICE-WIRE -------------------------------------------------------

    companion object {
        const val SCROLL_SAVE_DEBOUNCE_MS = 500L
        const val SHELL_TOAST = "Showing original — can't annotate this page yet"

        fun factory(application: Application, rawUrl: String): ViewModelProvider.Factory =
            viewModelFactory {
                initializer {
                    val appContext = application.applicationContext
                    val dao = AppDatabase.getInstance(appContext).videoPageDao()
                    ReaderViewModel(
                        url = Normalize.normalizeUrl(rawUrl),
                        repository = RoomPageHighlightRepository(dao),
                        fetcher = ReaderFetcher { fetchUrl -> Extractor(OkHttpClient()).extract(fetchUrl) },
                        prefs = ReaderPrefs(appContext),
                        scrollStore = ReaderScrollStore(appContext),
                        janitor = ReaderPageJanitor(dao),
                        syncStatusHolder =
                            RepositorySyncStatusHolder(SyncGraph.repository(appContext)),
                    )
                }
            }
    }
}
