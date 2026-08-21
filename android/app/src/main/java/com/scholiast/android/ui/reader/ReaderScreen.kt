package com.scholiast.android.ui.reader

import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.background
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.scholiast.android.data.model.LinearArticle
import com.scholiast.android.data.model.PageHighlight
import com.scholiast.android.data.prefs.ReaderSettings
import com.scholiast.android.domain.sync.SyncScheduler
import com.scholiast.android.ui.home.SyncStatus
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.sin

/**
 * The Reader surface (plan §5.1–5.3): native article reading with an auto-hide
 * translucent top bar, typography controls, scroll persistence, read-only
 * WebView shell fallback and the extraction error card.
 *
 * Task 32 integration: NativeReader's ANNOTATION-SLOT carries the selection /
 * paint / SwatchPill layer ([AnnotationHost]); this screen mounts Task 30's
 * voice overlay + Task 31's ThreadSheet (replies · recolor · delete-undo),
 * deep-link reveal (#sc-hl=), the first-visit coach mark and the back-gesture
 * unwind (sheet → selection → exit).
 */
@Composable
fun ReaderScreen(
    url: String,
    onBack: () -> Unit,
    viewModel: ReaderViewModel = readerViewModel(url),
) {
    val context = LocalContext.current
    val state by viewModel.state.collectAsStateWithLifecycle()
    val settings by viewModel.settings.collectAsStateWithLifecycle(initialValue = ReaderSettings())
    val syncStatus by viewModel.syncStatus.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { viewModel.load() }

    // Shell-fallback toast — once per Shell entry, not on recomposition.
    var shellToastShown by remember { mutableStateOf(false) }
    LaunchedEffect(state) {
        when (state) {
            is ReaderUiState.Shell -> {
                if (!shellToastShown) {
                    shellToastShown = true
                    Toast.makeText(context, ReaderViewModel.SHELL_TOAST, Toast.LENGTH_LONG).show()
                }
            }
            is ReaderUiState.Ready, is ReaderUiState.Failed -> shellToastShown = false
            ReaderUiState.Loading -> Unit
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        when (val current = state) {
            is ReaderUiState.Loading -> Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }

            is ReaderUiState.Ready -> ReadyContent(
                article = current.article,
                settings = settings,
                syncStatus = syncStatus,
                viewModel = viewModel,
                onBack = onBack,
                rawUrl = url,
            )

            is ReaderUiState.Shell -> ShellFallback(
                url = viewModel.url,
                title = hostOf(viewModel.url),
                syncStatus = syncStatus,
                onBack = onBack,
                onDeletePageData = viewModel::deletePageData,
            )

            is ReaderUiState.Failed -> FailedContent(
                message = current.message,
                url = viewModel.url,
                title = hostOf(viewModel.url),
                syncStatus = syncStatus,
                onRetry = viewModel::retry,
                onBack = onBack,
                onDeletePageData = viewModel::deletePageData,
            )
        }

        /* SHEET-SLOT — mounted inside ReadyContent (it owns the annotation/sheet
         * state): ThreadSheet + RecolorRow + ReaderVoiceOverlay + ReaderToast.
         */
    }
}

@Composable
private fun ReadyContent(
    article: LinearArticle,
    settings: ReaderSettings,
    syncStatus: SyncStatus,
    viewModel: ReaderViewModel,
    onBack: () -> Unit,
    rawUrl: String,
) {
    val listState = rememberLazyListState()
    val context = LocalContext.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val uriHandler = LocalUriHandler.current
    val barHeightPx = with(LocalDensity.current) { READER_TOP_BAR_HEIGHT_DP.dp.toPx() }
    val reducedMotion =
        android.provider.Settings.Global.getFloat(
            context.contentResolver,
            android.provider.Settings.Global.ANIMATOR_DURATION_SCALE,
            1f,
        ) == 0f

    fun hapticTick() {
        view.performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP)
    }

    // ---- annotation state (Task 32 mounting) -------------------------------
    val tracker = remember { SelectionTracker() }
    val selection = rememberReaderSelection()
    var highlights by remember { mutableStateOf<List<PageHighlight>>(emptyList()) }
    var lastPillRect by remember { mutableStateOf<Rect?>(null) }
    val voiceIntegration = rememberReaderVoiceIntegration(viewModel)

    DisposableEffect(tracker) {
        selectionTrackerGlobal = tracker
        onDispose {
            selectionTrackerGlobal = null
            tracker.clearLayouts()
        }
    }
    LaunchedEffect(viewModel.url) {
        highlights = viewModel.highlightStore.highlights(viewModel.url)
    }

    // Thread sheet focus + draft (Task 31) — declared before the callbacks that
    // capture them.
    var focusedGroupKey by remember { mutableStateOf<String?>(null) }
    var sheetDraft by remember { mutableStateOf(TextFieldValue("")) }

    /** Delete-undo toast payload (desktop parity: snapshot → optimistic delete → Undo). */
    var undoToast by remember { mutableStateOf<UndoToast?>(null) }

    fun persistUpsert(hl: PageHighlight) {
        scope.launch { viewModel.highlightStore.upsert(viewModel.url, hl) }
    }

    fun enqueueSync() {
        SyncScheduler.enqueueSyncNow(context)
    }

    fun openSheet(key: String) {
        if (key == focusedGroupKey) return
        val owner = HighlightActionsController.ownerOf(highlights, key)
        val restored = owner?.id?.let { viewModel.voiceDraftFor(it) }
        focusedGroupKey = key
        sheetDraft = TextFieldValue(restored.orEmpty())
    }

    fun closeSheet() {
        focusedGroupKey = null
        sheetDraft = TextFieldValue("")
    }

    /** Create highlights from the committed selection; returns the thread key. */
    fun createFromSelection(color: String): String? {
        val spans = selection.committed ?: return null
        if (spans.isEmpty()) return null
        val created = HighlightController.create(
            article.blocks, spans, color, existing = highlights,
        )
        if (created.isEmpty()) return null
        lastPillRect = selection.commitPill
        highlights = created // create() returns the full merged list (absorbed removed)
        created.forEach(::persistUpsert)
        hapticTick() // plan §6.5: haptic tick in the same frame as the visual commit
        selection.consumeCommit()
        enqueueSync()
        return HighlightController.groupIdOf(created.last()) ?: created.last().id
    }

    val host = remember(article) {
        AnnotationHost(
            tracker = tracker,
            selection = selection,
            articleProvider = { article },
            highlights = { highlights },
            onTapHighlight = { hit ->
                openSheet(hit.groupId ?: hit.highlightId)
            },
            onHintRewrite = { rehints ->
                rehints.forEach { r ->
                    highlights.firstOrNull { it.id == r.highlightId }?.let { hl ->
                        persistUpsert(RehintWriter.apply(hl, r))
                    }
                }
            },
            // Task 33 C6 + same-page anchors: a link whose scheme/host/path
            // matches THIS page scrolls to its #fragment block instead of
            // leaving the reader; anything else opens in the browser.
            onLinkTap = { target ->
                val parsed = runCatching { android.net.Uri.parse(target) }.getOrNull()
                val page = runCatching { android.net.Uri.parse(viewModel.url) }.getOrNull()
                val samePage = parsed != null && page != null &&
                    parsed.scheme == page.scheme &&
                    parsed.host == page.host &&
                    (parsed.path ?: "") == (page.path ?: "")
                val fragment = parsed?.fragment.orEmpty()
                if (samePage && fragment.isNotBlank()) {
                    val blockIdx = article.blocks.indexOfFirst {
                        it.anchorId == fragment || it.anchorId?.startsWith(fragment) == true
                    }
                    if (blockIdx >= 0) {
                        selection.clear()
                        scope.launch {
                            runCatching {
                                val viewport = listState.layoutInfo.viewportSize.height
                                listState.scrollToItem(blockIdx, -(viewport / 4))
                            }
                            hapticTick()
                        }
                    } else {
                        android.widget.Toast.makeText(
                            context, "Section not found on this page", android.widget.Toast.LENGTH_SHORT,
                        ).show()
                    }
                } else if (!samePage) {
                    runCatching { uriHandler.openUri(target) }
                }
            },
            onCommit = {},
            pillVisible = { selection.committed != null && focusedGroupKey == null },
            pillRect = { selection.commitPill ?: lastPillRect },
            onColor = { color -> createFromSelection(color) },
            onMic = {
                val key = createFromSelection("yellow")
                    ?: voiceIntegration.controller.drafts.value.keys.firstOrNull()?.let { id ->
                        highlights.firstOrNull { it.id == id }?.let {
                            HighlightController.groupIdOf(it) ?: it.id
                        }
                    }
                    ?: return@AnnotationHost
                voiceIntegration.onMicPressed(HighlightDraftTarget(key))
            },
            onComment = {
                val key = createFromSelection("yellow") ?: return@AnnotationHost
                openSheet(key)
            },
            onPillDismiss = { selection.clear() },
        )
    }

    // ---- back-gesture unwind: sheet → selection → exit (plan §6.4) ----------
    // Composed BEFORE the sheet so ThreadSheet's own handlers win while visible.
    BackHandler(enabled = !selection.isDragging && selection.committed != null) {
        selection.clear()
    }
    BackHandler(enabled = focusedGroupKey != null) { closeSheet() }

    // ---- deep link reveal (#sc-hl=<id>), plan §5.9 --------------------------
    val deepLinkId = remember(rawUrl) { DeepLink.highlightId(rawUrl) }
    var flashTarget by remember { mutableStateOf<PlacedHighlight?>(null) }
    val flashProgress = remember { Animatable(0f) }
    LaunchedEffect(deepLinkId, highlights, article.fetchedAt) {
        val id = deepLinkId ?: return@LaunchedEffect
        if (highlights.isEmpty() || listState.layoutInfo.totalItemsCount == 0) {
            snapshotFlow { listState.layoutInfo.totalItemsCount }.first { it > 0 }
        }
        val resolved = DeepLink.resolve(article, highlights, id) ?: return@LaunchedEffect
        runCatching {
            // Block top lands ~⅓ viewport from the screen top (plan §5.9).
            val viewport = listState.layoutInfo.viewportSize.height
            listState.scrollToItem(resolved.blockIndex, -(viewport / 3))
        }
        // single soft emphasis pulse ~2.6s (static hold under reduced motion)
        flashTarget = resolved
        flashProgress.snapTo(0f)
        if (reducedMotion) {
            flashProgress.snapTo(1f)
            delay(REVEAL_HOLD_REDUCED_MS)
        } else {
            flashProgress.animateTo(1f, tween(REVEAL_PULSE_MS, easing = LinearEasing))
        }
        flashTarget = null
    }

    // Restore the saved scroll once content exists (exact index+offset pair).
    LaunchedEffect(listState, article.fetchedAt) {
        val saved = viewModel.savedScroll()
        if (saved != null) {
            snapshotFlow { listState.layoutInfo.totalItemsCount }.first { it > 0 }
            if (saved.first < listState.layoutInfo.totalItemsCount) {
                listState.scrollToItem(saved.first, saved.second)
            }
        }
    }

    // Persist scroll ~500ms after it stops moving (debounce lives in the VM).
    LaunchedEffect(listState) {
        snapshotFlow {
            listState.firstVisibleItemIndex to listState.firstVisibleItemScrollOffset
        }.collect { (index, offset) ->
            viewModel.onScroll(index, offset)
        }
    }

    // Pending selection SURVIVES scrolling (user report: auto-dismiss lost
    // work). The pill hides while the list is in motion and re-anchors from
    // fresh layouts on settle; it clears only when the anchor block was
    // disposed (scrolled far away).
    LaunchedEffect(listState, article.fetchedAt) {
        snapshotFlow { listState.isScrollInProgress }.collect { scrolling ->
            if (scrolling) {
                selection.hidePill()
            } else {
                val spans = selection.committed
                when {
                    spans == null -> Unit
                    tracker.layoutResults[spans.first().blockIndex] == null -> selection.clear()
                    else -> {
                        val first = spans.first()
                        selection.commitPill =
                            pillRectFor(article.blocks, first.blockIndex to first.range, density)
                            ?: lastPillRect
                    }
                }
            }
        }
    }

    // ---- coach mark: first Reader visit only (plan §6.2) --------------------
    var coachVisible by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        if (!CoachMarkPrefs.shown(context)) {
            coachVisible = true
            delay(COACH_AUTO_DISMISS_MS)
            if (coachVisible) {
                coachVisible = false
                CoachMarkPrefs.markShown(context)
            }
        }
    }
    CoachMarkOverlay(visible = coachVisible, onDismiss = {
        coachVisible = false
        CoachMarkPrefs.markShown(context)
    })

    // Top bar tracks scroll 1:1 (plan §6.5): a nested-scroll connection absorbs
    // finger/fling deltas before (hide) or after (show) the list consumes them.
    // No independent animation anywhere.
    var hiddenPx by remember { mutableFloatStateOf(0f) }
    val barConnection = remember(barHeightPx) {
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                val dy = available.y
                if (dy <= 0f) return Offset.Zero
                val old = hiddenPx
                val new = (old + dy).coerceAtMost(barHeightPx)
                hiddenPx = new
                return Offset(0f, new - old)
            }

            override fun onPostScroll(
                consumed: Offset,
                available: Offset,
                source: NestedScrollSource,
            ): Offset {
                val dy = available.y
                if (dy >= 0f) return Offset.Zero
                val old = hiddenPx
                val new = (old + dy).coerceAtLeast(0f)
                hiddenPx = new
                return Offset(0f, new - old)
            }
        }
    }

    var showTypography by remember { mutableStateOf(false) }
    var showDeleteConfirm by remember { mutableStateOf(false) }

    // Task 33 C7: hardware-keyboard select-all — Ctrl+A / Meta+A selects the
    // whole article and raises the pill over its first block. Preview phase,
    // but inert while the sheet is open so the comment field keeps its own
    // select-all.
    fun onSelectAll(): Boolean {
        if (focusedGroupKey != null) return false
        val all = selection.selectAll(article)
        if (all.isEmpty()) return false
        val first = all.first()
        selection.commitPill = pillRectFor(article.blocks, first.blockIndex to first.range, density)
        return true
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .onPreviewKeyEvent { event ->
                val isSelectAll =
                    event.type == KeyEventType.KeyUp &&
                        event.key == Key.A &&
                        (event.isCtrlPressed || event.isMetaPressed)
                if (isSelectAll) onSelectAll() else false
            }
            .nestedScroll(barConnection),
    ) {
        NativeReader(
            article = article,
            settings = settings,
            listState = listState,
            annotation = host,
        )

        // Deep-link emphasis pulse over the painted highlight (root coords).
        flashTarget?.let { placed ->
            Canvas(modifier = Modifier.fillMaxSize()) {
                val t = flashProgress.value
                if (t <= 0f) return@Canvas
                val layout = tracker.layoutResults[placed.blockIndex] ?: return@Canvas
                val bounds = tracker.rootBounds[placed.blockIndex] ?: return@Canvas
                val boost = if (reducedMotion) REVEAL_STATIC_BOOST else sin(PI * t).toFloat() * REVEAL_PULSE_AMPLITUDE
                val hue = highlightColor(placed.highlight.color ?: "yellow")
                for (r in rangeRectsInBlock(layout, placed.range)) {
                    drawRect(
                        color = hue.copy(alpha = HIGHLIGHT_FILL_ALPHA + boost),
                        topLeft = Offset(r.left + bounds.left, r.top + bounds.top),
                        size = Size(r.width, r.height),
                    )
                }
            }
        }

        ReaderTopBar(
            title = article.title ?: article.byline?.takeIf { it.isNotBlank() },
            syncStatus = syncStatus,
            hiddenPx = hiddenPx,
            onBack = onBack,
            onShowTypography = { showTypography = true },
            onOpenOriginal = { openInBrowser(context, viewModel.url) },
            onDeletePageData = { showDeleteConfirm = true },
            onCopyArticle = {
                val plain = article.blocks.joinToString("\n\n") { b ->
                    when (b.kind) {
                        "li" -> (b.listOrdinal?.let { "$it. " } ?: "• ") + b.text
                        "img" -> b.imgAlt.orEmpty().ifBlank { "[image]" }
                        else -> b.text
                    }
                }
                val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                cm.setPrimaryClip(
                    android.content.ClipData.newPlainText(
                        article.title ?: "Article",
                        (article.title?.plus("\n\n") ?: "") + plain,
                    ),
                )
                Toast.makeText(context, "Article copied", Toast.LENGTH_SHORT).show()
            },
        )
        if (showTypography) {
            TypographyPopover(
                settings = settings,
                onDismiss = { showTypography = false },
                onFontStep = viewModel::setFontStep,
                onSerif = viewModel::setSerif,
                onWideWidth = viewModel::setWideWidth,
            )
        }
        if (showDeleteConfirm) {
            DeletePageDataDialog(
                onConfirm = {
                    showDeleteConfirm = false
                    viewModel.deletePageData()
                },
                onDismiss = { showDeleteConfirm = false },
            )
        }

        /* SHEET-SLOT ---------------------------------------------------------- */

        val sheetOwner = focusedGroupKey?.let {
            HighlightActionsController.ownerOf(highlights, it)
        }
        if (sheetOwner != null) {
            RecolorRow(
                modifier = Modifier.align(Alignment.TopCenter).padding(top = 64.dp),
                onColor = { color ->
                    val key = focusedGroupKey ?: return@RecolorRow
                    val next = HighlightActionsController.recolor(highlights, key, color)
                    if (next !== highlights) {
                        highlights = next
                        HighlightActionsController.piecesOf(next, key).forEach(::persistUpsert)
                        hapticTick()
                        enqueueSync()
                    }
                },
            )
        }
        ThreadSheet(
            visible = sheetOwner != null,
            quote = sheetOwner?.let { HighlightController.contentOf(it) },
            color = sheetOwner?.color,
            replies = sheetOwner?.notes.orEmpty(),
            draft = sheetDraft,
            voice = null, // sheet mic stays a disabled glyph in v1 (logged deviation)
            onDraftChange = { sheetDraft = it },
            onSendReply = {
                val key = focusedGroupKey ?: return@ThreadSheet
                val text = sheetDraft.text.trim()
                if (text.isEmpty()) return@ThreadSheet
                val next = HighlightActionsController.addReply(highlights, key, text)
                if (next !== highlights) {
                    highlights = next
                    sheetDraft = TextFieldValue("")
                    HighlightActionsController.ownerOf(next, key)?.let(::persistUpsert)
                    enqueueSync()
                }
            },
            onEditReply = { index, newText ->
                val key = focusedGroupKey ?: return@ThreadSheet
                val next = HighlightActionsController.editReply(highlights, key, index, newText)
                if (next !== highlights) {
                    highlights = next
                    HighlightActionsController.ownerOf(next, key)?.let(::persistUpsert)
                    enqueueSync()
                }
            },
            onDeleteReply = { index ->
                val key = focusedGroupKey ?: return@ThreadSheet
                val next = HighlightActionsController.deleteReply(highlights, key, index)
                if (next !== highlights) {
                    highlights = next
                    HighlightActionsController.ownerOf(next, key)?.let(::persistUpsert)
                    enqueueSync()
                }
            },
            onDeleteThread = {
                val key = focusedGroupKey ?: return@ThreadSheet
                val before = highlights
                val undo = HighlightActionsController.snapshotForUndo(before, key)
                when (val result = HighlightActionsController.deleteThread(before, key)) {
                    is HighlightActionsController.ThreadDeleteResult.Deleted -> {
                        val removedIds =
                            HighlightActionsController.piecesOf(before, key).map { it.id }.toSet()
                        highlights = result.highlights
                        scope.launch {
                            removedIds.forEach { viewModel.highlightStore.delete(viewModel.url, it) }
                            enqueueSync()
                        }
                        undoToast = UndoToast("Thread deleted", undo)
                        closeSheet()
                    }
                    is HighlightActionsController.ThreadDeleteResult.Blocked -> Unit
                }
            },
            onDismiss = ::closeSheet,
        )
        ReaderVoiceOverlay(
            viewModel = viewModel,
            anchorRect = lastPillRect,
            integration = voiceIntegration,
        )
        undoToast?.let { toast ->
            ReaderToast(
                message = toast.message,
                actionLabel = toast.undo?.let { "Undo" },
                onAction = toast.undo?.let { undo ->
                    {
                        scope.launch {
                            HighlightActionsController.restore(undo).forEach { hl ->
                                viewModel.highlightStore.upsert(viewModel.url, hl)
                            }
                            highlights = HighlightActionsController.restore(undo)
                            enqueueSync()
                        }
                        undoToast = null
                    }
                },
                onDismiss = { undoToast = null },
                modifier = Modifier.align(Alignment.BottomCenter),
            )
        }
    }
}

/** Delete-undo snackbar payload. */
private data class UndoToast(
    val message: String,
    val undo: HighlightActionsController.DeleteUndo?,
)

/** Deep-link reveal timing (plan §5.9: single soft pulse ~2.6s). */
private const val REVEAL_PULSE_MS = 2600
private const val REVEAL_HOLD_REDUCED_MS = 1200L
private const val REVEAL_PULSE_AMPLITUDE = 0.4f
private const val REVEAL_STATIC_BOOST = 0.25f

/**
 * Three mini swatches shown with the thread sheet — group recolor without
 * leaving the thread (desktop action-bar parity). ≥48dp targets.
 */
@Composable
private fun RecolorRow(onColor: (String) -> Unit, modifier: Modifier = Modifier) {
    val description = "Recolor this highlight"
    Row(
        modifier = modifier
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .semantics { contentDescription = description }
            .padding(horizontal = 6.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        listOf("yellow", "green", "red").forEach { colorName ->
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clickable(onClick = { onColor(colorName) }),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    Modifier
                        .size(24.dp)
                        .background(highlightColor(colorName), CircleShape),
                )
            }
        }
    }
}

/** Read-only WebView of the live page (annotation bundle is a v1.1 follow-up). */
@Composable
private fun ShellFallback(
    url: String,
    title: String?,
    syncStatus: SyncStatus,
    onBack: () -> Unit,
    onDeletePageData: () -> Unit,
) {
    val context = LocalContext.current
    var progress by remember { mutableIntStateOf(0) }
    var failed by remember { mutableStateOf(false) }
    Box(modifier = Modifier.fillMaxSize()) {
        AndroidWebView(
            url = url,
            modifier = Modifier.fillMaxSize(),
            onProgress = { progress = it; if (it > 0) failed = false },
            onError = { failed = true },
        )
        if (!failed && progress in 1..99) {
            LinearProgressIndicator(
                progress = { progress / 100f },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (failed) {
            Text(
                text = "Couldn't load the original page.",
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.align(Alignment.Center),
            )
        }
        ReaderTopBar(
            title = title,
            syncStatus = syncStatus,
            hiddenPx = 0f, // WebView owns its own scrolling; keep the bar steady
            onBack = onBack,
            onShowTypography = { /* typography applies to the article renderer only */ },
            onOpenOriginal = { openInBrowser(context, url) },
            onDeletePageData = onDeletePageData,
        )
    }
}

@Composable
private fun FailedContent(
    message: String,
    url: String,
    title: String?,
    syncStatus: SyncStatus,
    onRetry: () -> Unit,
    onBack: () -> Unit,
    onDeletePageData: () -> Unit,
) {
    val context = LocalContext.current
    Box(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize()) {
            ExtractErrorCard(message = message, url = url, onRetry = onRetry)
        }
        ReaderTopBar(
            title = title,
            syncStatus = syncStatus,
            hiddenPx = 0f,
            onBack = onBack,
            onShowTypography = { /* nothing to re-type without an article */ },
            onOpenOriginal = { openInBrowser(context, url) },
            onDeletePageData = onDeletePageData,
        )
    }
}

/** Chrome UA so sites that gate their shell on UA still render readably. */
private const val SHELL_UA =
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/124.0.0.0 Mobile Safari/537.36"

@Composable
private fun AndroidWebView(
    url: String,
    modifier: Modifier = Modifier,
    onProgress: (Int) -> Unit = {},
    onError: () -> Unit = {},
) {
    androidx.compose.ui.viewinterop.AndroidView(
        factory = { context ->
            WebView(context).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.userAgentString = SHELL_UA
                webChromeClient = object : android.webkit.WebChromeClient() {
                    override fun onProgressChanged(view: WebView?, newProgress: Int) {
                        onProgress(newProgress)
                    }
                }
                webViewClient = object : WebViewClient() {
                    override fun onReceivedError(
                        view: WebView?,
                        request: android.webkit.WebResourceRequest?,
                        error: android.webkit.WebResourceError?,
                    ) {
                        if (request?.isForMainFrame == true) onError()
                    }
                }
                loadUrl(url)
            }
        },
        update = { view -> if (view.url == null) view.loadUrl(url) },
        modifier = modifier,
    )
}

/** Typed-confirm destructive dialog — same pattern as Settings' Drive wipe. */
@Composable
private fun DeletePageDataDialog(onConfirm: () -> Unit, onDismiss: () -> Unit) {
    var confirmText by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Delete this page's data?") },
        text = {
            Column {
                Text(
                    "This deletes the saved article and every highlight and comment on this " +
                        "page from this device. The deletions sync to Google Drive as tombstones.",
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = confirmText,
                    onValueChange = { confirmText = it },
                    singleLine = true,
                    label = { Text("Type DELETE to confirm") },
                )
            }
        },
        confirmButton = {
            TextButton(onClick = onConfirm, enabled = confirmText == "DELETE") {
                Text("Delete", color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}

// ------------------------------------------------------------- helpers

/** Rewrites `extras.hint` after the painter re-resolved from the quote anchor. */
private object RehintWriter {
    fun apply(hl: PageHighlight, r: Rehint): PageHighlight =
        hl.copy(
            extras = kotlinx.serialization.json.JsonObject(
                hl.extras + ("hint" to HighlightController.hintJson(r.hint)),
            ),
        )
}

@Composable
private fun readerViewModel(url: String): ReaderViewModel {
    val app = LocalContext.current.applicationContext as Application
    return viewModel(factory = ReaderViewModel.factory(app, url))
}

private fun hostOf(url: String): String =
    runCatching { Uri.parse(url).host ?: url }.getOrDefault(url)

internal fun openInBrowser(context: Context, url: String) {
    runCatching {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    }
}
