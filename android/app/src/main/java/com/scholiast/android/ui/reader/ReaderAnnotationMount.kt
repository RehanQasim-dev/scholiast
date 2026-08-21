package com.scholiast.android.ui.reader

import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import com.scholiast.android.data.model.LinearArticle
import com.scholiast.android.data.model.LinearBlock
import com.scholiast.android.data.model.PageHighlight

/**
 * Task 32 mounting layer: the selection-drag state machine and the per-block
 * painted text that ties Tasks 29/30/31 components into the reader.
 *
 * Task 33 fixes: nearest-block-by-vertical-distance focus resolution (strict
 * contains left inter-block gaps as dead zones), word-boundary snapping at
 * preview AND commit ([snapToWords]), touch-slop gating and a 2-char minimum.
 */

/**
 * Snap a raw char range onto word boundaries (task 33 A3): start expands back
 * to the first char of its word, end forward to the last char of its word;
 * whitespace is the only separator, so punctuation counts as part of a word.
 * Inputs are clamped to `0..text.length`; a whitespace-only or degenerate
 * range snaps to an empty range so callers can cancel.
 */
internal fun snapToWords(text: String, start: Int, endExclusive: Int): IntRange {
    val len = text.length
    var s = start.coerceIn(0, len)
    var e = endExclusive.coerceIn(0, len)
    while (s < e && text[s].isWhitespace()) s++
    while (e > s && text[e - 1].isWhitespace()) e--
    if (s == e) return IntRange.EMPTY
    while (s > 0 && !text[s - 1].isWhitespace()) s--
    while (e < len && !text[e].isWhitespace()) e++
    return s until e
}

/**
 * Long-press-drag selection state (plan §5.4). Anchor = where the long press
 * landed; focus = where the finger is now. Blocks touched between them form
 * the selection; [commit] normalizes into ascending [HighlightController.BlockSelection]s.
 */
@Stable
class ReaderSelectionState {
    var anchor by mutableStateOf<Pair<Int, Int>?>(null)
        private set
    var focus by mutableStateOf<Pair<Int, Int>?>(null)
        private set
    val isDragging: Boolean get() = anchor != null && focus != null

    fun start(blockIndex: Int, offset: Int) {
        // Drop any committed selection first: a new drag must never show the
        // stale pill from the previous one while it runs (task 33 D).
        committed = null
        commitPill = null
        anchor = blockIndex to offset
        focus = blockIndex to offset
    }

    /**
     * Drag move, in ROOT coordinates. Focus block = nearest block by vertical
     * distance to the root Y (task 33 A1): inside a block's span → distance 0,
     * otherwise the gap to its nearest edge — inter-block padding gaps and
     * heading dead zones resolve to the visually closest block instead of
     * being dropped (stale focus) or collapsing to a block prefix.
     */
    fun updateTo(root: Offset, article: LinearArticle, tracker: SelectionTracker) {
        anchor ?: return
        val bi = tracker.rootBounds.entries
            .filter { it.key in article.blocks.indices && it.value.height >= 0f }
            .minByOrNull { (_, r) ->
                when {
                    root.y < r.top -> r.top - root.y
                    root.y > r.bottom -> root.y - r.bottom
                    else -> 0f
                }
            }
            ?.key ?: return
        val bounds = tracker.rootBounds[bi] ?: return
        val layout = tracker.layoutResults[bi] ?: return
        val local = Offset(root.x - bounds.left, root.y - bounds.top)
        val off = layout.getOffsetForPosition(local).coerceIn(0, article.blocks[bi].text.length)
        focus = bi to off
    }

    /**
     * Ascending normalized selections across touched blocks, word-snapped per
     * block (task 33 A3 — one implementation feeds preview styling AND the
     * commit path, so both surfaces agree); null while degenerate.
     */
    fun spans(article: LinearArticle): List<HighlightController.BlockSelection>? {
        val a = anchor ?: return null
        val f = focus ?: return null
        val from = minOf(a.first, f.first)
        val to = maxOf(a.first, f.first)
        if (from == to && a.second == f.second) return null
        return (from..to).mapNotNull { bi ->
            val text = article.blocks.getOrNull(bi)?.text ?: return@mapNotNull null
            val start = if (bi == a.first) a.second else 0
            val end = if (bi == f.first) f.second else text.length
            // minOf/maxOf here keeps upward drags (anchor below focus)
            // normalized identically to downward ones (task 33 A6).
            val lo = minOf(start, end)
            val hi = maxOf(start, end)
            val snapped = snapToWords(text, lo, hi)
            if (snapped.isEmpty()) null else HighlightController.BlockSelection(bi, snapped)
        }.ifEmpty { null }
    }

    /** Total snapped chars across [spans] — the task-33 minimum-length gate. */
    fun selectedCharCount(article: LinearArticle): Int =
        spans(article)?.sumOf { it.range.count() } ?: 0

    fun clear() {
        anchor = null
        focus = null
        committed = null
        commitPill = null
    }

    /** Set on drag end: normalized spans + pill rect for [SwatchPill]. */
    var committed by mutableStateOf<List<HighlightController.BlockSelection>?>(null)
    var commitPill by mutableStateOf<Rect?>(null)

    /** Hide the pill without dropping the selection (during scroll, task 33 D). */
    fun hidePill() {
        if (committed != null) commitPill = null
    }

    /** Consume after handling (create/comment); hides the pill. */
    fun consumeCommit() {
        committed = null
        commitPill = null
        clear()
    }

    /**
     * Ctrl+A select-all (task 33 C7): commit word-snapped spans over every
     * non-empty text block without an anchor/focus drag. The pill rect is set
     * by the host (it owns [pillRectFor]'s density context).
     */
    fun selectAll(article: LinearArticle): List<HighlightController.BlockSelection> {
        committed = null
        commitPill = null
        anchor = null
        focus = null
        val all = article.blocks.mapIndexedNotNull { bi, block ->
            val snapped = snapToWords(block.text, 0, block.text.length)
            if (snapped.isEmpty()) null else HighlightController.BlockSelection(bi, snapped)
        }
        if (all.isEmpty()) return all
        committed = all
        return all
    }
}

@Composable
fun rememberReaderSelection(): ReaderSelectionState = remember { ReaderSelectionState() }

/** Inclusive char range of a BlockSelection, for preview styling. */
internal fun HighlightController.BlockSelection.inclusive(): IntRange = range.first..range.last

/**
 * One rendered text block: highlight paint (Task 29 painter), link taps,
 * saved-highlight taps (→ sheet), live-selection preview styling and the
 * long-press-drag gesture that drives [ReaderSelectionState].
 */
/** Task 33 A5: a snapped selection shorter than this cancels instead of committing. */
private const val MIN_SELECTION_CHARS = 2

@Composable
fun ReaderBlockText(
    blockIndex: Int,
    block: LinearBlock,
    article: LinearArticle,
    tracker: SelectionTracker,
    selection: ReaderSelectionState,
    highlights: List<PageHighlight>,
    baseStyle: TextStyle,
    modifier: Modifier = Modifier,
    onLinkTap: (String) -> Unit,
    onTapHighlight: (HitSpan) -> Unit,
    onHintRewrite: (List<Rehint>) -> Unit,
) {
    val uriHandler = LocalUriHandler.current
    val density = LocalDensity.current
    val context = androidx.compose.ui.platform.LocalContext.current
    val layoutState = remember { mutableStateOf<TextLayoutResult?>(null) }
    // Task 33 A4: system touch slop (~8dp) gates drag-selection so a jittery
    // long press never becomes an accidental 1-char highlight.
    val touchSlopPx = remember(context) {
        android.view.ViewConfiguration.get(context).scaledTouchSlop.toFloat()
    }

    val painted = remember(block, highlights) {
        HighlightPainter.paint(blockIndex, block, highlights)
    }

    // LazyColumn disposes off-screen items; without this cleanup the tracker
    // keeps stale bounds at old scroll positions and drag focus snaps to
    // long-gone paragraphs (the "selects many far lines" bug).
    androidx.compose.runtime.DisposableEffect(blockIndex) {
        onDispose { tracker.removeBlock(blockIndex) }
    }

    // Live selection preview over this block while a drag is active.
    val previewRange: IntRange? = when {
        !selection.isDragging -> null
        else -> selection.spans(article)
            ?.firstOrNull { it.blockIndex == blockIndex }?.let { it.range.first..it.range.last }
    }

    val previewColor = MaterialTheme.colorScheme.primary
    val text: AnnotatedString = remember(painted, previewRange, previewColor) {
        val base = painted.text
        if (previewRange == null || previewRange.isEmpty() || base.isEmpty()) base
        else buildAnnotatedString {
            append(base)
            addStyle(
                SpanStyle(background = previewColor.copy(alpha = 0.25f)),
                previewRange.first.coerceIn(0, base.length - 1).coerceAtLeast(0),
                (previewRange.last + 1).coerceIn(1, base.length),
            )
        }
    }

    TextWithGestures(
        text = text,
        style = baseStyle,
        layoutSink = { layoutState.value = it; tracker.putLayout(blockIndex, it) },
        modifier = modifier.blockSelectionSource(tracker, blockIndex),
        slopPx = touchSlopPx,
        onTap = { position ->
            val layout = layoutState.value ?: return@TextWithGestures
            val offset = layout.getOffsetForPosition(position)
            painted.hits.firstOrNull { it.contains(offset) }?.let {
                onTapHighlight(it)
                return@TextWithGestures
            }
            // Link taps resolve against raw ranges (badge-shift imprecision
            // only when badges coexist in this block — logged deviation).
            block.annotations.firstOrNull {
                it.kind == "link" && it.target.isNotBlank() &&
                    offset >= it.start && offset < it.end
            }?.let { onLinkTap(it.target); return@TextWithGestures }
            // Tap on plain text clears any pending selection/pill — tapping
            // away is the standard dismiss (task 33 D: stuck-selection fix).
            if (selection.committed != null || selection.isDragging) selection.clear()
        },
        onDragStart = { position ->
            val layout = layoutState.value ?: return@TextWithGestures
            selection.start(
                // coerceIn(0, len) — not len-1, which threw on empty blocks.
                blockIndex,
                layout.getOffsetForPosition(position).coerceIn(0, block.text.length),
            )
        },
        onDrag = { localPos ->
            val bounds = tracker.rootBounds[blockIndex] ?: return@TextWithGestures
            selection.updateTo(Offset(bounds.left + localPos.x, bounds.top + localPos.y), article, tracker)
        },
        onDragEnd = {
            // Minimum selection (task 33 A5): fewer than 2 snapped chars →
            // cancel entirely; the pill must never appear for a stray tap-drag.
            if (selection.selectedCharCount(article) < MIN_SELECTION_CHARS) {
                selection.clear()
            } else {
                val spans = selection.spans(article) ?: run { selection.clear(); return@TextWithGestures }
                val first = spans.first()
                selection.commitPill = pillRectFor(article.blocks, first.blockIndex to first.range, density)
                selection.committed = spans
            }
        },
    )
    LaunchedEffectRewrite(painted.rehints, onHintRewrite)
}

/** Post-composition hint persistence hook (painter re-resolved stale hints). */
@Composable
private fun LaunchedEffectRewrite(rehints: List<Rehint>, onHintRewrite: (List<Rehint>) -> Unit) {
    androidx.compose.runtime.LaunchedEffect(rehints) {
        if (rehints.isNotEmpty()) onHintRewrite(rehints)
    }
}

/**
 * Minimal gesture host so both tap and long-press-drag detectors share one
 * Text without fighting over the pointer stream. Kept internal to the mount.
 *
 * [slopPx] (task 33 A4): drag updates are ignored until the pointer moves
 * more than the system touch slop from the long-press point; releasing inside
 * the slop band cancels (nothing was ever fed to [onDrag], so the state stays
 * degenerate and commit clears).
 */
@Composable
private fun TextWithGestures(
    text: AnnotatedString,
    style: TextStyle,
    layoutSink: (TextLayoutResult?) -> Unit,
    modifier: Modifier = Modifier,
    slopPx: Float = 24f,
    onTap: (Offset) -> Unit,
    onDragStart: (Offset) -> Unit,
    onDrag: (Offset) -> Unit,
    onDragEnd: () -> Unit,
) {
    var dragStartPos by androidx.compose.runtime.remember { mutableStateOf(Offset.Zero) }
    var slopExceeded by androidx.compose.runtime.remember { mutableStateOf(false) }
    androidx.compose.material3.Text(
        text = text,
        style = style,
        onTextLayout = { layoutSink(it) },
        modifier = modifier
            .pointerInput(text) {
                detectTapGestures { pos -> onTap(pos) }
            }
            .pointerInput(Unit, slopPx) {
                detectDragGesturesAfterLongPress(
                    onDragStart = { pos ->
                        dragStartPos = pos
                        slopExceeded = false
                        onDragStart(pos)
                    },
                    onDrag = { change, _ ->
                        change.consume()
                        if (!slopExceeded && (change.position - dragStartPos).getDistance() > slopPx) {
                            slopExceeded = true
                            // Feed the first past-slop position so focus jumps
                            // to the finger instead of trailing one event behind.
                            onDrag(change.position)
                        } else if (slopExceeded) {
                            onDrag(change.position)
                        }
                    },
                    onDragEnd = { onDragEnd() },
                    onDragCancel = { onDragEnd() },
                )
            },
    )
}

/**
 * Deep-link resolution (plan §5.9): locate [highlightId]'s span via the
 * painter (hint-first, quote-anchor fallback) and report its block index.
 */
fun resolveDeepLinkBlock(
    article: LinearArticle,
    highlights: List<PageHighlight>,
    highlightId: String,
): Pair<Int, PageHighlight>? {
    val hl = highlights.firstOrNull { it.id == highlightId } ?: return null
    for ((i, b) in article.blocks.withIndex()) {
        val (hits, _) = HighlightPainter.resolve(i, b, listOf(hl))
        if (hits.isNotEmpty()) return i to hl
    }
    return null
}
