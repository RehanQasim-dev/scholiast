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
import androidx.compose.animation.core.animateFloatAsState
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
import androidx.compose.runtime.mutableDoubleStateOf
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
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
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

    // ---- highlights + sheets (shared) — WebView owns selection ------------
    var highlights by remember { mutableStateOf<List<PageHighlight>>(emptyList()) }
    var lastPillRect by remember { mutableStateOf<Rect?>(null) }
    val voiceIntegration = rememberReaderVoiceIntegration(viewModel)

    LaunchedEffect(viewModel.url) {
        highlights = viewModel.highlightStore.highlights(viewModel.url)
    }

    var focusedGroupKey by remember { mutableStateOf<String?>(null) }
    var sheetDraft by remember { mutableStateOf(TextFieldValue("")) }
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

    BackHandler(enabled = focusedGroupKey != null) { closeSheet() }

    // Deep link now handled via webHandles.revealHighlight in bridge onReady.

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

    // Top bar stays hidden by default — the article gets the full screen from
    // the first frame — and only reappears on scroll-up or near the top. The
    // WebView owns its own scrolling (it's a native View, not a Compose
    // scrollable), so this is driven by the JS bundle's throttled onScrollPct
    // bridge callback rather than a NestedScrollConnection (which never sees
    // WebView-internal scroll deltas at all).
    var rawHiddenPx by remember { mutableFloatStateOf(barHeightPx) }
    val hiddenPx by animateFloatAsState(targetValue = rawHiddenPx, label = "readerTopBarHide")
    var lastScrollPct by remember { mutableDoubleStateOf(0.0) }
    fun onArticleScrollPct(pct: Double) {
        val delta = pct - lastScrollPct
        when {
            delta > 0.6 -> rawHiddenPx = barHeightPx
            delta < -0.6 -> rawHiddenPx = 0f
        }
        lastScrollPct = pct
    }

    var showTypography by remember { mutableStateOf(false) }
    var showDeleteConfirm by remember { mutableStateOf(false) }

    // WebView reader host — replaces NativeReader (Revision B). The JS bundle
    // handles Readability cleaning, selection, pill, and highlight painting;
    // Kotlin owns persistence, sync, voice, and sheets.
    val deepLinkId = remember(rawUrl) { DeepLink.highlightId(rawUrl) }
    val (bridge, handlesFactory) = remember { ReaderWebViewFactory.create() }
    var webHandles by remember { mutableStateOf<ReaderWebHandles?>(null) }
    var webReady by remember { mutableStateOf(false) }
    var pendingSelectionJson by remember { mutableStateOf<String?>(null) }

    // Bridge routing — JS → Kotlin persistence.
    val bridgeCallbacks = remember(highlights) {
        object : ReaderBridgeCallbacks {
            override fun onReady() {
                webReady = true
                scope.launch {
                    // Paint saved highlights once JS is ready.
                    val json = com.scholiast.android.data.model.ScholiastJson.encode(highlights)
                    webHandles?.paintHighlights(json)
                    // Apply current theme.
                    webHandles?.setReaderTheme(true, (16 + settings.fontStep * 1) , settings.serif, settings.wideWidth)
                    // Deep link reveal after paint.
                    deepLinkId?.let { id -> webHandles?.revealHighlight(id) }
                    // Scroll restore is handled via onScrollPct; initial position 0.
                }
            }
            override fun onHighlightCreated(json: String) {
                scope.launch {
                    val hl = try { com.scholiast.android.data.model.ScholiastJson.decode<com.scholiast.android.data.model.PageHighlight>(json) } catch (_: Exception) { null } ?: return@launch
                    highlights = highlights + hl
                    persistUpsert(hl)
                    enqueueSync()
                }
            }
            override fun onHighlightUpdated(json: String) {
                scope.launch {
                    val hl = try { com.scholiast.android.data.model.ScholiastJson.decode<com.scholiast.android.data.model.PageHighlight>(json) } catch (_: Exception) { null } ?: return@launch
                    highlights = highlights.map { if (it.id == hl.id) hl else it }
                    persistUpsert(hl)
                    enqueueSync()
                }
            }
            override fun onHighlightDeleted(id: String) {
                scope.launch {
                    highlights = highlights.filterNot { it.id == id }
                    viewModel.highlightStore.delete(viewModel.url, id)
                    enqueueSync()
                }
            }
            override fun onLinkTap(url: String) { runCatching { uriHandler.openUri(url) } }
            override fun onScrollPct(pct: Double) { onArticleScrollPct(pct) }
            override fun onSelectionState(json: String?) { pendingSelectionJson = json }
        }
    }
    DisposableEffect(bridge) {
        bridge.callbacks = bridgeCallbacks
        onDispose { bridge.callbacks = null }
    }
    // Keep theme in sync.
    LaunchedEffect(settings) {
        if (webReady) webHandles?.setReaderTheme(true, 16 + settings.fontStep, settings.serif, settings.wideWidth)
    }
    // Repaint when highlights change externally (e.g., pull).
    LaunchedEffect(highlights, webReady) {
        if (webReady) {
            val json = com.scholiast.android.data.model.ScholiastJson.encode(highlights)
            webHandles?.paintHighlights(json)
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize(),
    ) {
        // WebView content — replaces NativeReader (kept for history, deleted in Task 36).
        androidx.compose.ui.viewinterop.        AndroidView(
            factory = { ctx ->
                WebView(ctx).apply {
                    this.settings.javaScriptEnabled = true
                    this.settings.domStorageEnabled = true
                    this.settings.allowFileAccess = true
                    setBackgroundColor(0xFF0B0D14.toInt())
                    addJavascriptInterface(bridge, "AndroidBridge")
                    bridge.webView = this
                    webViewClient = object : WebViewClient() {
                        override fun onPageFinished(view: WebView?, url: String?) {
                            super.onPageFinished(view, url)
                            if (webHandles == null && view != null) {
                                webHandles = handlesFactory(view)
                            }
                            // Inject reader CSS.
                            try {
                                val css = ctx.assets.open("wwwreader/android-reader.css").bufferedReader().readText()
                                val escCss = css.replace("\\", "\\\\").replace("`", "\\`").replace("$", "\\$")
                                evaluateJavascript("(function(){var s=document.createElement('style');s.textContent=`$escCss`;document.head.appendChild(s);})();", null)
                            } catch (_: Exception) {}
                            // Inject reader JS bundle — it does Readability swap + kernel boot.
                            try {
                                val js = ctx.assets.open("wwwreader/android-reader.js").bufferedReader().readText()
                                evaluateJavascript(js, null)
                            } catch (_: Exception) {}
                        }
                    }
                    loadUrl(viewModel.url)
                }
            },
            modifier = Modifier.fillMaxSize(),
            update = { view ->
                if (webHandles == null) {
                    webHandles = handlesFactory(view)
                    bridge.webView = view
                    view.addJavascriptInterface(bridge, "AndroidBridge")
                }
            },
        )

        // The WebView briefly renders the live page in ITS OWN (often light)
        // theme before our CSS/JS injection lands on onPageFinished; cover
        // that flash with the reader's own dark background until the kernel
        // reports onReady() (DOM swapped + painted).
        if (!webReady) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color(0xFF0B0D14)),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
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
                // Prefer WebView's cleaned text (via JS) when available; fallback to blocks.
                val handles = webHandles
                if (handles != null && webReady) {
                    handles.getArticleText { text ->
                        val plain = text?.takeIf { it.isNotBlank() } ?: article.blocks.joinToString("\n\n") { b ->
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
                    }
                } else {
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
                }
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
