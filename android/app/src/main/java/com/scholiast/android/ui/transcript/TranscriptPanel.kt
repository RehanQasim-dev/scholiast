package com.scholiast.android.ui.transcript

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.input.pointer.changedToUp
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.scholiast.android.data.db.AppDatabase
import com.scholiast.android.data.model.VideoItem
import com.scholiast.android.data.notes.RoomVideoItemRepository
import com.scholiast.android.data.normalize.Normalize
import com.scholiast.android.domain.transcript.TranscriptCue
import com.scholiast.android.domain.transcript.TranscriptParagraph
import com.scholiast.android.ui.notes.EditorDraft
import com.scholiast.android.ui.notes.SeekRequestListener
import com.scholiast.android.ui.notes.TimestampChip
import com.scholiast.android.ui.notes.VideoTimeProvider
import com.scholiast.android.ui.notes.editor.CommentEditorSheet
import com.scholiast.android.ui.voice.rememberVoiceEditorSlot
import com.scholiast.android.ui.theme.TextSecondary
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.math.max
import kotlin.math.min

/** Repaint alpha of saved transcript highlights (desktop `.ob-vt-hl` = 0.40). */
private const val HIGHLIGHT_ALPHA = 0.40f

/**
 * Builds one paragraph's display text: the joined cue text with saved
 * transcript highlights repainted inline as colored background spans (0.40
 * alpha, the desktop `.ob-vt-hl` style), each tappable via a
 * [LinkAnnotation.Clickable]; the live-follow cue is emphasized with a heavier
 * weight (desktop `.is-now`). Overlapping segments are skipped after the
 * first (desktop `cueInnerHtml`: `segs.sort(by start)`, `if (seg.start < pos)
 * continue`), in paragraph-text coordinates. A live drag selection
 * ([liveSelection], painted with [selectionColor]) overlays everything.
 */
internal fun buildParagraphAnnotated(
    paragraph: TranscriptParagraph,
    cues: List<TranscriptCue>,
    highlights: List<VideoItem>,
    activeCueIndex: Int,
    liveSelection: IntRange? = null,
    selectionColor: Color? = null,
    onHighlightTap: (VideoItem) -> Unit,
): AnnotatedString {
    val builder = AnnotatedString.Builder(paragraph.text)
    val paraCues = paragraphCues(paragraph, cues)

    data class Seg(val start: Int, val end: Int, val item: VideoItem)
    val segs = mutableListOf<Seg>()
    for (item in highlights) {
        val a = item.anchor ?: continue
        for (cue in paraCues) {
            if (cue.index < a.startCue || cue.index > a.endCue) continue
            val s = if (cue.index == a.startCue) a.startOffset else 0
            val e = if (cue.index == a.endCue) a.endOffset else cue.text.length
            if (e > s) {
                val cueStart = cueStartOffsetInParagraph(paragraph, cues, cue.index) ?: continue
                segs += Seg(
                    start = cueStart + max(0, s),
                    end = cueStart + min(cue.text.length, e),
                    item = item,
                )
            }
        }
    }
    segs.sortBy { it.start }
    var pos = 0
    for (seg in segs) {
        if (seg.start < pos) continue // overlap — first painted wins
        builder.addStyle(
            SpanStyle(background = highlightColor(seg.item.color ?: "yellow").copy(alpha = HIGHLIGHT_ALPHA)),
            seg.start,
            seg.end,
        )
        builder.addLink(
            LinkAnnotation.Clickable(
                tag = seg.item.id,
                styles = TextLinkStyles(),
                linkInteractionListener = { onHighlightTap(seg.item) },
            ),
            seg.start,
            seg.end,
        )
        pos = seg.end
    }

    if (activeCueIndex in paragraph.cueRange) {
        val cue = paraCues.firstOrNull { it.index == activeCueIndex }
        val cueStart = cueStartOffsetInParagraph(paragraph, cues, activeCueIndex)
        if (cue != null && cueStart != null) {
            builder.addStyle(
                SpanStyle(
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                ),
                cueStart,
                cueStart + cue.text.length,
            )
        }
    }

    if (liveSelection != null && selectionColor != null && liveSelection.last > liveSelection.first) {
        val s = liveSelection.first.coerceIn(0, paragraph.text.length)
        val e = liveSelection.last.coerceIn(0, paragraph.text.length)
        if (e > s) builder.addStyle(SpanStyle(background = selectionColor), s, e)
    }
    return builder.toAnnotatedString()
}

/**
 * The Transcript tab (plan §5.6): live-following paragraph list, selection →
 * swatch popup → transcript highlight, inline repaint of saved highlights, and
 * the language picker. Hosted by Task 05's `PlayerScreen` panel slot, side by
 * side with Task 06's `NotesTab`.
 *
 * - Live follow: a 250 ms poll via [VideoTimeProvider] marks the current cue
 *   (only re-renders on cue change) and auto-scrolls when it drifts out of the
 *   10%..80% band, bringing it ~30% from the top (desktop `onPlayback`).
 * - Selection: tap a paragraph = whole-paragraph highlight; drag selects a
 *   range. The swatch popup floats near the selection (desktop `showPopup`).
 * - The panel owns the comment-editor sheet: the swatch's **Comment** button
 *   creates a yellow highlight and opens the sheet for it; tapping a saved
 *   highlight seeks to the range start and opens the sheet. Thread rendering
 *   stays in Task 06's Notes tab cards (see task 13 LOG.md).
 */
@Composable
fun TranscriptPanel(
    url: String,
    modifier: Modifier = Modifier,
    timeProvider: VideoTimeProvider? = null,
    seekListener: SeekRequestListener? = null,
    onPausePlayback: (() -> Unit)? = null,
    onResumePlayback: (() -> Unit)? = null,
    viewModel: TranscriptViewModel = transcriptViewModel(url),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    var draft by remember { mutableStateOf<EditorDraft?>(null) }

    fun openDraft(newDraft: EditorDraft) {
        draft = newDraft
        onPausePlayback?.invoke()
    }

    val listState = rememberLazyListState()
    val layouts = remember { mutableStateMapOf<Int, TextLayoutResult>() }
    val textPositions = remember { mutableStateMapOf<Int, Offset>() }
    val dragRanges = remember { mutableStateMapOf<Int, IntRange?>() }
    val rootPosition = remember { mutableStateOf(Offset.Zero) }
    val selectionColor = LocalTextSelectionColors.current.backgroundColor

    LaunchedEffect(url) {
        viewModel.seekListener = seekListener
        viewModel.load()
        viewModel.onTick(timeProvider?.currentTime() ?: 0.0)
    }
    // Repository exposes no Flow — refresh saved highlights when the tab
    // (re)appears (catches external writes: sync, Notes tab edits).
    LifecycleResumeEffect(url) {
        scope.launch { viewModel.refreshHighlights() }
        onPauseOrDispose { }
    }
    // The 250 ms live-follow poll (desktop setInterval). The VM early-returns
    // when the active cue hasn't changed, so this is cheap while paused.
    LaunchedEffect(timeProvider) {
        while (isActive) {
            viewModel.onTick(timeProvider?.currentTime() ?: 0.0)
            delay(250)
        }
    }
    // Dismiss the swatch popup on scroll, like the desktop's `removePopup()`.
    LaunchedEffect(listState) {
        snapshotFlow { listState.isScrollInProgress }.collect { scrolling ->
            if (scrolling) viewModel.clearSelection()
        }
    }
    // Reset per-paragraph layout caches when the transcript (re)loads — the
    // old cue structure no longer matches (language switch).
    LaunchedEffect(state.transcript) {
        layouts.clear()
        textPositions.clear()
        dragRanges.clear()
    }
    // Initial scroll: land the cue ~30 s behind the current moment at 25% from
    // the top (desktop `scrollToLookback`).
    LaunchedEffect(state.transcript) {
        val transcript = state.transcript ?: return@LaunchedEffect
        val time = timeProvider?.currentTime() ?: 0.0
        val cue = lookbackCueIndex(transcript.cues, time)
        if (cue < 0) return@LaunchedEffect
        val paraIdx = paragraphIndexForCue(transcript.paragraphs, cue) ?: return@LaunchedEffect
        var viewport = listState.layoutInfo.viewportSize.height
        var attempt = 0
        while (viewport == 0 && attempt < 5) {
            delay(50)
            viewport = listState.layoutInfo.viewportSize.height
            attempt++
        }
        listState.scrollToItem(paraIdx, (viewport * LOOKBACK_TARGET).toInt())
    }
    // Live follow: re-mark the active paragraph and, unless the swatch popup is
    // up, auto-scroll when it leaves the 10%..80% band, bringing the active
    // line ~30% from the top.
    LaunchedEffect(state.activeCueIndex, state.pendingSelection) {
        if (state.pendingSelection != null) return@LaunchedEffect
        val idx = state.activeCueIndex
        if (idx < 0) return@LaunchedEffect
        val transcript = state.transcript ?: return@LaunchedEffect
        val paraIdx = paragraphIndexForCue(transcript.paragraphs, idx) ?: return@LaunchedEffect
        val viewport = listState.layoutInfo.viewportSize.height
        if (viewport <= 0) return@LaunchedEffect
        val info = listState.layoutInfo.visibleItemsInfo.firstOrNull { it.index == paraIdx }
        if (info == null) {
            listState.animateScrollToItem(paraIdx)
        } else {
            val top = info.offset
            if (top < viewport * FOLLOW_BAND.start || top > viewport * FOLLOW_BAND.endInclusive) {
                val cueStart = cueStartOffsetInParagraph(transcript.paragraphs[paraIdx], transcript.cues, idx)
                val lineTop = if (cueStart != null) {
                    layouts[paraIdx]?.getLineTop(layouts[paraIdx]!!.getLineForOffset(cueStart)) ?: 0f
                } else 0f
                listState.animateScrollToItem(paraIdx, (viewport * FOLLOW_TARGET - lineTop).toInt())
            }
        }
    }

    // The selection rect for the swatch popup: the paragraph's live drag
    // selection, or the whole paragraph (tap), translated to the root Box's
    // coordinates.
    val pendingIdx = state.selectionParagraphIndex
    val overlayRect = if (state.pendingSelection != null && pendingIdx >= 0) {
        val layout = layouts[pendingIdx]
        val textPos = textPositions[pendingIdx]
        val paragraphs = state.transcript?.paragraphs
        val paragraph = paragraphs?.getOrNull(pendingIdx)
        if (layout != null && textPos != null && paragraph != null) {
            val drag = dragRanges[pendingIdx]
            // TextLayoutResult has no range-rect overload (getBoundingBox is
            // per-offset) — merge the first/last selected glyph boxes. A tap
            // (no drag range) anchors the popup over the whole paragraph.
            val box = if (drag != null && drag.last > drag.first) {
                val s = min(drag.first, paragraph.text.length - 1)
                val e = min(drag.last - 1, paragraph.text.length - 1)
                val sb = layout.getBoundingBox(s)
                val eb = layout.getBoundingBox(e)
                Rect(
                    left = min(sb.left, eb.left),
                    top = min(sb.top, eb.top),
                    right = max(sb.right, eb.right),
                    bottom = max(sb.bottom, eb.bottom),
                )
            } else {
                Rect(0f, 0f, layout.size.width.toFloat(), layout.size.height.toFloat())
            }
            Rect(
                left = textPos.x + box.left - rootPosition.value.x,
                top = textPos.y + box.top - rootPosition.value.y,
                right = textPos.x + box.right - rootPosition.value.x,
                bottom = textPos.y + box.bottom - rootPosition.value.y,
            )
        } else null
    } else null

    Box(modifier.fillMaxSize()) {
        Box(
            Modifier
                .fillMaxSize()
                .onGloballyPositioned { rootPosition.value = it.positionInWindow() },
        ) {
            Column(Modifier.fillMaxSize()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Transcript", style = MaterialTheme.typography.titleMedium)
                    Box(Modifier.weight(1f))
                    val tracks = viewModel.tracks()
                    if (tracks.size > 1 && state.transcript != null) {
                        LanguagePicker(
                            tracks = tracks,
                            currentCode = state.transcript!!.languageCode,
                            onChange = { code -> scope.launch { viewModel.changeLanguage(code) } },
                        )
                    }
                }
                HorizontalDivider()
                when (val status = state.status) {
                    TranscriptStatus.Loading -> Box(
                        Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center,
                    ) { CircularProgressIndicator() }

                    TranscriptStatus.NoCaptions -> Box(
                        Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = "No captions for this video",
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextSecondary,
                            modifier = Modifier.padding(24.dp),
                        )
                    }

                    is TranscriptStatus.Error -> Box(
                        Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = status.message,
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextSecondary,
                            modifier = Modifier.padding(24.dp),
                        )
                    }

                    TranscriptStatus.Ready -> {
                        val transcript = state.transcript ?: return@Column
                        LazyColumn(
                            state = listState,
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(12.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            items(transcript.paragraphs.size, key = { transcript.paragraphs[it].index }) { i ->
                                val paragraph = transcript.paragraphs[i]
                                ParagraphItem(
                                    paragraph = paragraph,
                                    cues = transcript.cues,
                                    highlights = state.highlights,
                                    activeCueIndex = state.activeCueIndex,
                                    liveSelection = dragRanges[paragraph.index],
                                    selectionColor = selectionColor,
                                    onLiveSelectionChange = { r -> dragRanges[paragraph.index] = r },
                                    onTap = { viewModel.onParagraphTap(it) },
                                    onParagraphSelection = { start, end ->
                                        if (start >= end) viewModel.clearSelection()
                                        else viewModel.onParagraphSelection(paragraph, start, end)
                                    },
                                    onHighlightTap = { item ->
                                        viewModel.onHighlightTap(item)
                                        openDraft(EditorDraft(itemId = item.id, videoTime = item.videoTime))
                                    },
                                    onSeek = { seconds -> viewModel.seekTo(seconds) },
                                    onTextLayout = { idx, layout -> layouts[idx] = layout },
                                    onTextPosition = { idx, pos -> textPositions[idx] = pos },
                                )
                            }
                        }
                    }
                }
            }
        }

        if (overlayRect != null) {
            TranscriptSelectionOverlay(
                selectionRect = overlayRect,
                rangeLabel = viewModel.pendingRangeLabel(),
                onPickColor = { color ->
                    scope.launch {
                        viewModel.createHighlight(color)
                        dragRanges[pendingIdx] = null
                    }
                },
                onComment = {
                    scope.launch {
                        val item = viewModel.createHighlight("yellow")
                        dragRanges[pendingIdx] = null
                        if (item != null) {
                            openDraft(EditorDraft(itemId = item.id, videoTime = item.videoTime))
                        }
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )
        }

        // The reply composer docks to the panel's bottom edge — the transcript
        // stays visible while writing.
        draft?.let { d ->
            val voice = rememberVoiceEditorSlot()
            CommentEditorSheet(
                draft = d,
                timestampSeconds = d.videoTime,
                onSave = { text ->
                    draft = null
                    d.itemId?.let { id ->
                        if (text.isNotBlank()) {
                            scope.launch { viewModel.addReply(id, text) }
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
    }
}

/** One transcript paragraph: tappable (whole-paragraph selection) and drag-
 * selectable (a `pointerInput` `detectDragGestures` maps pointer positions to
 * text offsets via [TextLayoutResult.getOffsetForPosition]; Compose 1.8's
 * `SelectionContainer(selection, onSelectionChange)` overload is internal, so
 * the drag is tracked here and painted via [buildParagraphAnnotated]'s live
 * selection span). Dragging on a paragraph selects instead of scrolling —
 * scroll by the gaps, the list's scrollbar, or the live-follow auto-scroll.
 */
@Composable
private fun ParagraphItem(
    paragraph: TranscriptParagraph,
    cues: List<TranscriptCue>,
    highlights: List<VideoItem>,
    activeCueIndex: Int,
    liveSelection: IntRange?,
    selectionColor: Color,
    onLiveSelectionChange: (IntRange?) -> Unit,
    onTap: (TranscriptParagraph) -> Unit,
    onParagraphSelection: (Int, Int) -> Unit,
    onHighlightTap: (VideoItem) -> Unit,
    onSeek: (Double) -> Unit,
    onTextLayout: (Int, TextLayoutResult) -> Unit,
    onTextPosition: (Int, Offset) -> Unit,
    modifier: Modifier = Modifier,
) {
    var layout by remember(paragraph.index) { mutableStateOf<TextLayoutResult?>(null) }
    val isActive = activeCueIndex in paragraph.cueRange
    val annotated = remember(
        paragraph,
        cues,
        highlights,
        activeCueIndex,
        liveSelection,
        selectionColor,
        onHighlightTap,
    ) {
        buildParagraphAnnotated(
            paragraph,
            cues,
            highlights,
            activeCueIndex,
            liveSelection,
            selectionColor,
            onHighlightTap,
        )
    }

    Surface(
        shape = RoundedCornerShape(10.dp),
        color = if (isActive) MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f)
                else MaterialTheme.colorScheme.surfaceContainerLow.copy(alpha = 0.60f),
        border = BorderStroke(
            1.dp,
            if (isActive) MaterialTheme.colorScheme.primary.copy(alpha = 0.50f)
            else MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.18f),
        ),
        modifier = modifier
            .fillMaxWidth()
            .clickable {
                onSeek(paragraph.startMs / 1000.0)
            },
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 10.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                TimestampChip(
                    seconds = paragraph.startMs / 1000.0,
                    onClick = { onSeek(paragraph.startMs / 1000.0) },
                )
                if (isActive) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(5.dp),
                    ) {
                        Box(
                            modifier = Modifier
                                .size(6.dp)
                                .background(MaterialTheme.colorScheme.primary, shape = CircleShape),
                        )
                        Text(
                            text = "Playing",
                            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
            }

            Spacer(Modifier.height(8.dp))

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .pointerInput(paragraph.index) {
                        var anchor = 0
                        fun offsetAt(pos: Offset): Int =
                            (layout?.getOffsetForPosition(pos) ?: 0).coerceIn(0, paragraph.text.length)
                        awaitEachGesture {
                            val down = awaitFirstDown()
                            anchor = offsetAt(down.position)
                            var isDrag = false
                            var dragRange: IntRange? = null

                            while (true) {
                                val event = awaitPointerEvent()
                                val change = event.changes.firstOrNull() ?: break
                                if (change.changedToUp()) {
                                    change.consume()
                                    if (!isDrag) {
                                        onSeek(paragraph.startMs / 1000.0)
                                        onTap(paragraph)
                                    } else {
                                        if (dragRange != null && dragRange.last > dragRange.first) {
                                            onParagraphSelection(dragRange.first, dragRange.last)
                                        } else {
                                            onParagraphSelection(-1, -1)
                                        }
                                    }
                                    break
                                } else if (change.pressed) {
                                    val distance = (change.position - down.position).getDistance()
                                    if (distance > viewConfiguration.touchSlop) {
                                        isDrag = true
                                        change.consume()
                                        val cur = offsetAt(change.position)
                                        val range = min(anchor, cur)..max(anchor, cur)
                                        dragRange = range
                                        onLiveSelectionChange(range)
                                    }
                                } else {
                                    break
                                }
                            }
                        }
                    },
            ) {
                Text(
                    text = annotated,
                    style = MaterialTheme.typography.bodyLarge.copy(
                        lineHeight = 25.sp,
                        letterSpacing = 0.15.sp,
                    ),
                    color = if (isActive) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                    onTextLayout = {
                        layout = it
                        onTextLayout(paragraph.index, it)
                    },
                    modifier = Modifier.onGloballyPositioned { onTextPosition(paragraph.index, it.positionInWindow()) },
                )
            }
        }
    }
}

/** The panel-header language picker (shown only when >1 track exists). */
@Composable
private fun LanguagePicker(
    tracks: List<com.scholiast.android.domain.transcript.CaptionTrack>,
    currentCode: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var open by remember { mutableStateOf(false) }
    val currentName = tracks.firstOrNull { it.languageCode == currentCode }?.name ?: currentCode
    Box(modifier) {
        TextButton(onClick = { open = true }) {
            Text(
                text = currentName,
                style = MaterialTheme.typography.labelMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            tracks.forEach { track ->
                DropdownMenuItem(
                    text = {
                        Text(
                            text = track.name + if (track.isAsr) " (auto)" else "",
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    },
                    onClick = {
                        open = false
                        if (track.languageCode != currentCode) onChange(track.languageCode)
                    },
                )
            }
        }
    }
}

/** Builds the screen's [TranscriptViewModel] against the app's real client and
 * Room repository (videoId via Task 03's [Normalize.extractVideoId]). */
@Composable
fun transcriptViewModel(url: String): TranscriptViewModel {
    val appContext = LocalContext.current.applicationContext
    val db = AppDatabase.getInstance(appContext)
    return viewModel(
        key = "transcript:$url",
        factory = TranscriptViewModelFactory(
            videoId = Normalize.extractVideoId(url).orEmpty(),
            url = url,
            provider = ClientTranscriptProvider(com.scholiast.android.domain.transcript.TranscriptClient()),
            repository = RoomVideoItemRepository(db.videoPageDao()),
        ),
    )
}

/** [ViewModelProvider.Factory] for [TranscriptViewModel]. */
class TranscriptViewModelFactory(
    private val videoId: String,
    private val url: String,
    private val provider: TranscriptProvider,
    private val repository: com.scholiast.android.data.notes.VideoItemRepository,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T =
        TranscriptViewModel(provider, repository, videoId, url) as T
}