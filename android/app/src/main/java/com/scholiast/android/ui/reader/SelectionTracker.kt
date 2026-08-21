package com.scholiast.android.ui.reader

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import com.scholiast.android.data.model.LinearBlock

/**
 * DEVIATION vs plan §3.2 (logged in task LOG.md): compose-foundation 1.9
 * internalized its low-level selection API (`androidx.compose.foundation.text.selection.*`),
 * so there is no public way to map a raw `SelectionContainer` multi-text
 * selection back to per-block offsets. This module therefore provides the
 * *tracking* half only: per-block [TextLayoutResult] + root-bounds registry
 * ([SelectionTracker]) and pill geometry ([pillRectFor]). The drag-gesture side
 * (long-press-drag → `(blockIndex, start, end)`) mounts in NativeReader
 * (Task 32), whose LazyColumn already owns the gesture context — it calls
 * [layoutSink] from each Text's `onTextLayout`, attaches
 * [Modifier.blockSelectionSource] for root bounds, and hands resolved spans to
 * [HighlightController.create].
 */

/** A resolved user selection: touched spans + the pill anchor rectangle (root coords). */
data class TrackedSelection(
    /** One entry per touched block, ascending; ranges are inclusive char spans. */
    val blocks: List<HighlightController.BlockSelection>,
    /** Bounding box of the selection's first line, clamped inside the host. */
    val pillRect: Rect,
)

/** Registry of rendered block layouts + their root-relative glyph bounds. */
@Stable
class SelectionTracker {
    var layoutResults by mutableStateOf(mapOf<Int, TextLayoutResult>())
        private set

    var rootBounds by mutableStateOf(mapOf<Int, Rect>())
        private set

    /** Route each rendered block Text's `onTextLayout` here. */
    fun putLayout(blockIndex: Int, result: TextLayoutResult?) {
        if (result == null) return
        layoutResults = layoutResults + (blockIndex to result)
    }

    /** Fresh root-relative bounds for a block (attached via [Modifier.blockSelectionSource]). */
    fun putRootBounds(blockIndex: Int, bounds: Rect) {
        rootBounds = rootBounds + (blockIndex to bounds)
    }

    /**
     * Drop one block's registrations. Called from the block's DisposableEffect:
     * a LazyColumn DISPOSES off-screen items, and stale bounds/layouts at their
     * last on-screen positions poison nearest-block focus resolution (drag
     * focus jumped to long-gone paragraphs — the "selects random far lines" bug).
     */
    fun removeBlock(blockIndex: Int) {
        layoutResults = layoutResults - blockIndex
        rootBounds = rootBounds - blockIndex
    }

    /** Drop all registrations (article swapped / list disposed). */
    fun clearLayouts() {
        layoutResults = emptyMap()
        rootBounds = emptyMap()
    }

    /** Callback sink shaped for `Text(onTextLayout = …)`. */
    fun layoutSink(blockIndex: Int): (TextLayoutResult?) -> Unit = { putLayout(blockIndex, it) }
}

/**
 * Attach to every rendered block's Text so selection geometry stays fresh as
 * the list scrolls (bounds refresh on every layout pass).
 */
fun Modifier.blockSelectionSource(tracker: SelectionTracker, blockIndex: Int): Modifier =
    this.onGloballyPositioned { coords -> tracker.putRootBounds(blockIndex, coords.boundsInRoot()) }

/** Clamp margin applied to computed pill rectangles. */
private const val PILL_EDGE_PX = 8f

/** Smallest rect covering both inputs (compose 1.9 dropped Rect.unite). */
private infix fun Rect.span(other: Rect): Rect =
    Rect(
        minOf(left, other.left),
        minOf(top, other.top),
        maxOf(right, other.right),
        maxOf(bottom, other.bottom),
    )

/**
 * Pill anchor rectangle for one selection piece: the union of the first and
 * last character boxes of the covered span (per-line refinement happens at
 * paint time if ever needed), positioned via the block's recorded root bounds,
 * clamped ≥[PILL_EDGE_PX] from the origin. Null when the block's layout is not
 * registered (not yet composed / disposed).
 *
 * [density] is accepted for host-side scaling symmetry (px↔dp conversions by
 * callers); the returned Rect is always in raw pixels.
 */
fun pillRectFor(
    blocks: List<LinearBlock>,
    selection: Pair<Int, IntRange>,
    density: Density,
): Rect? {
    val layout = selectionTrackerGlobal?.layoutResults?.get(selection.first) ?: return null
    val textLen = blocks.getOrNull(selection.first)?.text?.length
        ?: layout.layoutInput.text.length
    if (textLen <= 0) return null
    val start = selection.second.first.coerceIn(0, textLen - 1)
    val end = selection.second.last.coerceIn(0, textLen - 1)
    var rect = layout.getBoundingBox(start)
    if (end != start) rect = rect span layout.getBoundingBox(end)
    val bounds = selectionTrackerGlobal?.rootBounds?.get(selection.first) ?: return null
    val positioned = Rect(
        rect.left + bounds.left,
        rect.top + bounds.top,
        rect.right + bounds.left,
        rect.bottom + bounds.top,
    )
    // Clamp ≥ PILL_EDGE_PX from the window origin; never inverted.
    val left = maxOf(PILL_EDGE_PX, positioned.left)
    val top = maxOf(PILL_EDGE_PX, positioned.top)
    return Rect(left, top, maxOf(left, positioned.right), maxOf(top, positioned.bottom))
}

/**
 * Process-wide registry hook so pure helpers like [pillRectFor] can reach the
 * mounted tracker without threading it through every signature. Set once by
 * the Reader host (Task 32); null outside the reader.
 */
var selectionTrackerGlobal: SelectionTracker? by mutableStateOf(null)
