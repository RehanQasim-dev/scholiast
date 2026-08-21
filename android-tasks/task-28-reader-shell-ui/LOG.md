# LOG — task-28-reader-shell-ui

## [2026-08-21 22:55] ox-alpha (Task 28 agent) — final
- **What I learned:**
  - `Modifier.onTextLayout` does NOT exist in compose-ui (checked the 1.9.0 jar byte-for-byte); a block's `TextLayoutResult` can only be captured via `Text(onTextLayout = …)` — relevant to anyone wiring Task 29's selection state.
  - The top bar's "tracks the finger 1:1" requirement maps cleanly onto a `NestedScrollConnection`: consume positive dy in `onPreScroll` (hide), negative leftover in `onPostScroll` (show), clamp to bar height. No animation code at all — the offset IS the scroll delta.
  - Scroll persistence went to SharedPreferences (`scholiast_reader_scroll`, keyed by url hash), NOT Room: schema is frozen for this task and scroll is device-local by nature. Stores exact `(firstVisibleItemIndex, firstVisibleItemScrollOffset)` so restore is precise.
  - `HomeViewModel`'s activity-scoped + pending-StateFlow pattern extends cleanly to a second destination: added `pendingOpenUrl` beside `pendingOpen`; MainActivity needed ZERO changes (routing happens in the ViewModel; HomeScreen collects both flows).
- **Decisions made:**
  - Extraction seam: `fun interface ReaderFetcher { suspend fun extract(url: String): ExtractResult }` — production factory wires `ReaderFetcher { url -> Extractor(OkHttpClient()).extract(url) }`, tests substitute canned results without network. Real Extractor API unchanged.
  - Long-press remove on Pages rows implements plan §5.1 literally via `ReaderPageJanitor.removeFromList`: pages WITH highlights stay in the list (tombstones nothing); reader-only entries drop their cache — whole row deleted when it holds nothing else, else just `readerJson = null`.
  - Overflow "Delete page data" writes the `[ ]` sentinel (`RoomPageHighlightRepository.EMPTY_HIGHLIGHTS_JSON`) so the next sync tombstones the page's highlights exactly like a deliberate local delete-to-empty; video items on the same row are kept.
  - Shell fallback is a read-only WebView with a steady (non-hiding) top bar + toast; typography menu is inert there (nothing to re-type).
- **Cross-task hotfixes (documented for the Task 29 agent — all mechanical, zero logic redesign):**
  - `HighlightController.create`: fixed two destructuring bugs — `for ((bi, selection) in touched)` bound `selection` to the IntRange component (so `.range` didn't resolve), and `neighbors` was Pair<Pair<…>> so `.first.id` missed one level. Now iterates `touchedSel` explicitly and flattens neighbors to `Triple<PageHighlight, Hint?, IntRange?>` using the file's own `hintRangeOf`. Behavior identical to the comments' intent.
  - `HighlightPainter.paint`: local `sealed interface Tok` (+Txt/Bdg) moved to private top-level declarations of the same file (local interfaces are illegal in Kotlin). Same names, same usage.
  - `SelectionTracker.kt`: I repaired an earlier broken revision (wrong packages + nonexistent `Modifier.onTextLayout`) but the Task 29 agent rewrote the file concurrently and landed their own working version — my edit was fully superseded; final file is theirs, build green with it.
- **Deviations from task.md:** ReaderFetcher seam (above); scroll store in SharedPreferences instead of a Room column (schema untouchable per spec); MainActivity unedited because routing lives in HomeViewModel (spec allowed "minimal edit"); updated ONE Task-04 test (`invalid open link shows a toast…` → `non-youtube open link routes to the reader…`) because the routing change is this task's mandated behavior.
- **Verification:** `./gradlew assembleDevDebug` BUILD SUCCESSFUL. Targeted tests: `*ReaderViewModelTest*` → 5 tests, 0 failures, 0 errors, 0 skipped; `*HomeViewModelTest*` → 13 tests, 0 failures (after the one mandated update). No Waydroid install per instructions.

### Exact public APIs as landed (for Tasks 30/31/32)

```kotlin
// ui/navigation/Routes.kt
const val READER = "reader?url={url}"
fun reader(url: String): String   // percent-encodes the url

// ui/reader/ReaderViewModel.kt
sealed interface ReaderUiState {
    data object Loading : ReaderUiState
    data class Ready(val article: LinearArticle) : ReaderUiState
    data class Shell(val reason: String?) : ReaderUiState      // read-only WebView fallback
    data class Failed(val message: String) : ReaderUiState     // error card
}
fun interface ReaderFetcher { suspend fun extract(url: String): ExtractResult }
class ReaderScrollStore(context: Context) {                    // device-local, SharedPreferences
    fun load(url: String): Pair<Int, Int>?                     // (firstVisibleItemIndex, offset)
    fun save(url: String, index: Int, offset: Int)
    fun clear(url: String)
}
class ReaderPageJanitor(dao: VideoPageDao) {
    suspend fun removeFromList(url: String): Boolean           // Home long-press; false if highlights exist
    suspend fun deletePageData(url: String)                    // overflow action; sync-tombstones highlights
}
class ReaderViewModel(
    val url: String,                                           // NORMALIZED url (= storage/sync key)
    repository: PageHighlightRepository,
    fetcher: ReaderFetcher,
    linearizer: Linearizer = Linearizer(),
    prefs: ReaderPrefs? = null,
    scrollStore: ReaderScrollStore? = null,
    janitor: ReaderPageJanitor? = null,
    syncStatusHolder: SyncStatusHolder = InMemorySyncStatusHolder(),
) : ViewModel {
    val state: StateFlow<ReaderUiState>
    val syncStatus: StateFlow<SyncStatus>                      // Home's sealed type, for the top-bar dot
    val settings: Flow<ReaderSettings>                         // cold flow; screen collects w/ initial
    suspend fun loadOnce(): ReaderUiState                      // full chain; test entry point
    fun load(); fun retry()
    fun setFontStep(step: Int); fun setSerif(serif: Boolean); fun setWideWidth(wideWidth: Boolean)
    fun onScroll(index: Int, offset: Int)                      // 500ms debounced persist
    fun savedScroll(): Pair<Int, Int>?; fun clearScroll()
    fun deletePageData()
    companion object {
        const val SCROLL_SAVE_DEBOUNCE_MS = 500L
        const val SHELL_TOAST = "Showing original — can't annotate this page yet"
        fun factory(application: Application, rawUrl: String): ViewModelProvider.Factory
    }
}

// ui/reader/ReaderScreen.kt
@Composable fun ReaderScreen(url: String, onBack: () -> Unit, viewModel: ReaderViewModel = readerViewModel(url))
// internal states render: Loading spinner · NativeReader(article, settings, listState) ·
// ShellFallback(read-only WebView) · FailedContent(ExtractErrorCard). SHEET-SLOT comment region
// sits at the bottom of ReaderScreen's root Box for Tasks 30/31.

// ui/reader/NativeReader.kt
data class ReaderTypography(val body: TextUnit, val family: FontFamily, val maxWidth: Dp) {
    companion object { fun from(settings: ReaderSettings): ReaderTypography }  // 16+1.5·step sp, serif?, 640/920dp
}
@Composable fun NativeReader(
    article: LinearArticle, settings: ReaderSettings, listState: LazyListState,
    modifier: Modifier = Modifier, contentPadding: PaddingValues = PaddingValues(top = 72.dp, bottom = 96.dp),
)
// ANNOTATION-SLOT comment region inside its root Box (Task 29 mounts painter/pill there);
// listState is hoisted into ReaderScreen for anchor math.

// ui/reader/ReaderTopBar.kt / TypographyPopover.kt / ExtractErrorCard.kt
const val READER_TOP_BAR_HEIGHT_DP = 56
@Composable fun ReaderTopBar(title: String?, syncStatus: SyncStatus, hiddenPx: Float,
    onBack: () -> Unit, onShowTypography: () -> Unit, onOpenOriginal: () -> Unit, onDeletePageData: () -> Unit,
    modifier: Modifier = Modifier)   // hiddenPx fed 1:1 by NestedScrollConnection in ReaderScreen
@Composable fun TypographyPopover(settings: ReaderSettings, onDismiss: () -> Unit,
    onFontStep: (Int) -> Unit, onSerif: (Boolean) -> Unit, onWideWidth: (Boolean) -> Unit)
@Composable fun ExtractErrorCard(message: String, url: String, onRetry: () -> Unit, modifier: Modifier = Modifier)

// ui/home/HomeViewModel.kt additions
val pendingOpenUrl: StateFlow<String?>          // non-YouTube page url → Reader (normalized)
fun consumePendingOpenUrl(): String?
val pages: StateFlow<List<PageListItem>>        // refreshed by reload()/refresh()
suspend fun removeFromPages(item: PageListItem): Boolean
// parseShareText/submitOpenLink now route: YouTube id → pendingOpen · other http(s) URL → pendingOpenUrl · else NOT_YOUTUBE_LINK toast

// ui/home/HomeScreen.kt
enum class HomeTab(val label: String) { VIDEOS("Videos"), PAGES("Pages") }
@Composable fun HomeScreen(onOpenVideo: (String) -> Unit, onOpenReader: (String) -> Unit,
    onOpenSettings: () -> Unit, viewModel: HomeViewModel = rememberHomeViewModel())
internal fun cleanTitle(title: String?): String?   // drops trailing " | Site" tail
```
