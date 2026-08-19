package com.scholiast.android.ui.frame

import com.scholiast.android.data.model.Stroke
import com.scholiast.android.data.model.VideoMarkup
import kotlin.math.max
import kotlin.math.sqrt

/**
 * Pure, JVM-testable markup math for the frame feature (plan §5.7, task 14):
 * coordinate normalization to the 0..1 frame space the desktop uses, the eraser
 * hit-test, stroke width/pressure mapping, and the undo/redo snapshot session.
 *
 * Everything here is Android-free on purpose — the custom [MarkupView] feeds it
 * raw pixels and reads back normalized strokes, so every acceptance-criteria
 * calculation is covered by plain JUnit tests (no Robolectric in the catalog).
 *
 * ## The normalized-coordinate model (byte-compat with the desktop)
 * `src/utils/video/video-storage.ts` stores stroke points as flattened
 * normalized pairs `[x0,y0,x1,y1,...]`, each in 0..1 of the frame, so markup
 * repaints correctly over the saved JPEG at any size. This file's
 * [MarkupMath.normalize]/[MarkupMath.denormalize] are that bridge; the markup
 * JSON itself is the `VideoMarkup`/`Stroke` DTOs from Task 02, which serialize
 * byte-identically to the TS output.
 */
enum class FrameColor(val json: String, val argb: Int) {
    /**
     * The four markup colors, hex values taken verbatim from the desktop's
     * `VIDEO_COLOR_HEX` in `src/utils/video/video-markup.ts` — these are DATA
     * colors (they must render identically on the desktop, the app and the
     * synced note), NOT the theme's text-highlight hues.
     */
    YELLOW("yellow", 0xFFFACC15.toInt()),
    RED("red", 0xFFFB7185.toInt()),
    GREEN("green", 0xFF4AC582.toInt()),
    BLACK("black", 0xFF000000.toInt()),
    ;

    companion object {
        fun fromJson(name: String): FrameColor =
            entries.firstOrNull { it.json == name } ?: YELLOW
    }
}

object MarkupMath {

    /** Undo/redo snapshot stack cap (plan §5.7.2 "cap 50", matches the desktop). */
    const val MAX_UNDO = 50

    /** Pencil width bounds in dp, width = f(pressure) within these. */
    const val MIN_PENCIL_DP = 2f
    const val MAX_PENCIL_DP = 10f

    /** Highlighter: wide stroke at ~35% alpha (plan §5.7.2). */
    const val HIGHLIGHTER_DP = 22f
    const val HIGHLIGHTER_ALPHA = 0.35f

    /** Live-sampling distance: points closer than this (view px) are dropped. */
    const val MIN_SAMPLE_PX = 2f

    /** Eraser hit tolerance in dp. */
    const val ERASER_TOL_DP = 8f

    /** The three stroke widths, matching the TS `StrokeWidth` union. */
    const val WEIGHT_THIN = "thin"
    const val WEIGHT_MEDIUM = "medium"
    const val WEIGHT_THICK = "thick"

    // --- Normalization -------------------------------------------------------

    /** Pixel → normalized 0..1 of [size], clamped. */
    fun normalize(x: Float, size: Int): Double =
        (x / size.coerceAtLeast(1)).toDouble().coerceIn(0.0, 1.0)

    /** Normalized 0..1 → pixel. */
    fun denormalize(v: Double, size: Int): Float = (v * size.coerceAtLeast(1)).toFloat()

    /** Flatten [(x,y)] pairs into the desktop's `[x0,y0,x1,y1,...]` list. */
    fun flatten(points: List<Pair<Float, Float>>): List<Double> =
        points.flatMap { listOf(it.first.toDouble(), it.second.toDouble()) }

    /**
     * Normalize a flattened pixel-coordinate list ([x0,y0,x1,y1,...]) to 0..1
     * of the W×H box — the desktop's `points` array shape. X values divide by
     * [w], Y values by [h].
     */
    fun normalizeFlattened(values: List<Double>, w: Int, h: Int): List<Double> {
        val out = ArrayList<Double>(values.size)
        var i = 0
        while (i + 1 < values.size) {
            out.add(normalize(values[i].toFloat(), w))
            out.add(normalize(values[i + 1].toFloat(), h))
            i += 2
        }
        return out
    }

    /** The inverse of [flatten]. */
    fun unflatten(values: List<Double>): List<Pair<Float, Float>> {
        val out = ArrayList<Pair<Float, Float>>(values.size / 2)
        var i = 0
        while (i + 1 < values.size) {
            out.add(values[i].toFloat() to values[i + 1].toFloat())
            i += 2
        }
        return out
    }

    /**
     * Drop samples closer than [minPx] to the previous kept one (desktop:
     * `if (Math.hypot(p.x - lx, p.y - ly) < 2) return` in `video-annotator.ts`).
     */
    fun filterMinDistance(
        points: List<Pair<Float, Float>>,
        minPx: Float = MIN_SAMPLE_PX,
    ): List<Pair<Float, Float>> {
        if (points.isEmpty()) return points
        val out = ArrayList<Pair<Float, Float>>(points.size)
        var last = points[0]
        out.add(last)
        for (i in 1 until points.size) {
            val p = points[i]
            if (dist(p, last) >= minPx) {
                out.add(p)
                last = p
            }
        }
        return out
    }

    private fun dist(a: Pair<Float, Float>, b: Pair<Float, Float>): Double {
        val dx = a.first - b.first
        val dy = a.second - b.second
        return sqrt(dx * dx + dy * dy.toDouble()).toDouble()
    }

    // --- Eraser hit-testing --------------------------------------------------

    /** Distance from point (px,py) to segment (ax,ay)-(bx,by). Ported from the
     *  desktop's `distToSeg` in `video-annotator.ts`. */
    fun distToSegment(
        px: Double, py: Double,
        ax: Double, ay: Double,
        bx: Double, by: Double,
    ): Double {
        val dx = bx - ax
        val dy = by - ay
        val len2 = dx * dx + dy * dy
        var t = if (len2 != 0.0) ((px - ax) * dx + (py - ay) * dy) / len2 else 0.0
        t = t.coerceIn(0.0, 1.0)
        val cx = ax + t * dx
        val cy = ay + t * dy
        val ex = px - cx
        val ey = py - cy
        return sqrt(ex * ex + ey * ey)
    }

    /**
     * True when any segment of [stroke] comes within [tolPx] (view pixels) of
     * any point of the eraser path (flattened pixel coords, one pair per
     * sample). Whole-stroke removal: the eraser takes out a stroke when it
     * touches it — the committed erasure is vector (see LOG.md decision).
     */
    fun eraserHits(
        stroke: Stroke,
        eraserPathPx: List<Double>,
        tolPx: Double,
        w: Int,
        h: Int,
    ): Boolean {
        if (eraserPathPx.size < 2) return false
        val pts = stroke.points
        if (pts.size < 4) return false
        val segs = mutableListOf<Pair<Pair<Double, Double>, Pair<Double, Double>>>()
        var i = 0
        while (i + 3 < pts.size) {
            segs.add(
                (MarkupMath.denormalize(pts[i], w).toDouble() to MarkupMath.denormalize(pts[i + 1], h).toDouble())
                    to
                    (MarkupMath.denormalize(pts[i + 2], w).toDouble() to MarkupMath.denormalize(pts[i + 3], h).toDouble()),
            )
            i += 2
        }
        var j = 0
        while (j + 1 < eraserPathPx.size) {
            val ex = eraserPathPx[j].toDouble()
            val ey = eraserPathPx[j + 1].toDouble()
            for ((a, b) in segs) {
                if (distToSegment(ex, ey, a.first, a.second, b.first, b.second) <= tolPx) return true
            }
            j += 2
        }
        return false
    }

    // --- Width / weight mapping ----------------------------------------------

    /** Pencil stroke width = lerp([minPx], [maxPx], pressure). */
    fun strokeWidthPx(minPx: Float, maxPx: Float, pressure: Float): Float =
        minPx + (maxPx - minPx) * pressure.coerceIn(0f, 1f)

    /** Pencil width in px at [density]. */
    fun pencilWidthPx(density: Float, pressure: Float): Float =
        strokeWidthPx(MIN_PENCIL_DP * density, MAX_PENCIL_DP * density, pressure)

    /** Highlighter width in px at [density]. */
    fun highlighterWidthPx(density: Float): Float = HIGHLIGHTER_DP * density

    /** Eraser width in px at [density]. */
    fun eraserWidthPx(density: Float): Float = (HIGHLIGHTER_DP * 1.4f) * density

    /** Map a drawn pixel width to the TS `StrokeWidth` string. */
    fun weightFor(widthPx: Float, density: Float): String {
        val dp = widthPx / density.coerceAtLeast(0.1f)
        return when {
            dp < 4f -> WEIGHT_THIN
            dp < 8f -> WEIGHT_MEDIUM
            else -> WEIGHT_THICK
        }
    }

    /**
     * The render weight in px, ported from `getWeight` in the desktop's
     * `video-markup.ts`: `base = max(2, W * 0.004)` scaled by thin/medium/thick
     * (0.5× / 1× / 2×). Used by both the live overlay and the baked composite,
     * so a stroke reads the same at any display size and on every client.
     */
    fun renderWeightPx(weight: String?, canvasWidth: Int): Float {
        val base = max(2f, canvasWidth.coerceAtLeast(1) * 0.004f)
        return when (weight) {
            WEIGHT_THIN -> base * 0.5f
            WEIGHT_THICK -> base * 2f
            else -> base
        }
    }
}

/**
 * The undo/redo session over a [VideoMarkup]. Snapshots are immutable data
 * copies (cheap — markup is a small list of strokes), capped at
 * [MarkupMath.MAX_UNDO] like the desktop's `pushUndoSnapshot` (which also
 * `shift()`s past 50). The custom view owns the raster; this owns the model.
 */
class MarkupSession(initial: VideoMarkup = VideoMarkup.empty()) {

    var markup: VideoMarkup = initial
        private set

    private val undoStack = ArrayDeque<VideoMarkup>()
    private val redoStack = ArrayDeque<VideoMarkup>()

    val canUndo: Boolean get() = undoStack.isNotEmpty()
    val canRedo: Boolean get() = redoStack.isNotEmpty()

    val hasMarkup: Boolean
        get() = markup.strokes.isNotEmpty() || markup.lines.isNotEmpty() ||
            markup.texts.isNotEmpty() || !markup.rects.isNullOrEmpty() || !markup.arrows.isNullOrEmpty()

    /** Snapshot the current state before a mutation (no-op-safe to over-call). */
    fun pushSnapshot() {
        undoStack.addLast(markup)
        if (undoStack.size > MarkupMath.MAX_UNDO) undoStack.removeFirst()
        redoStack.clear()
    }

    /**
     * Commit a finished stroke (already-normalized flattened points) and
     * return it. Pushes the pre-stroke state for undo.
     */
    fun commitStroke(id: String, color: String, points: List<Double>, weight: String): Stroke {
        pushSnapshot()
        val stroke = Stroke(id = id, color = color, points = points, weight = weight)
        markup = markup.copy(strokes = markup.strokes + stroke)
        return stroke
    }

    /**
     * Erase every stroke the eraser path touches. Returns true when anything
     * was removed (the caller then repaints the raster). The snapshot is
     * pushed only on a real removal, so a no-op eraser swipe can't be undone.
     */
    fun eraseStrokes(eraserPathPx: List<Double>, tolPx: Double, w: Int, h: Int): Boolean {
        val kept = markup.strokes.filterNot {
            MarkupMath.eraserHits(it, eraserPathPx, tolPx, w, h)
        }
        if (kept.size == markup.strokes.size) return false
        pushSnapshot()
        markup = markup.copy(strokes = kept)
        return true
    }

    /** Pop the last snapshot back onto the canvas. False when the stack is empty. */
    fun undo(): Boolean {
        val prev = undoStack.removeLastOrNull() ?: return false
        redoStack.addLast(markup)
        markup = prev
        return true
    }

    /** Re-apply the undone state. False when nothing was undone. */
    fun redo(): Boolean {
        val next = redoStack.removeLastOrNull() ?: return false
        undoStack.addLast(markup)
        markup = next
        return true
    }

    /** Remove every stroke (snapshot first, so undo restores). */
    fun clear() {
        if (!hasMarkup) return
        pushSnapshot()
        markup = VideoMarkup.empty()
    }

    /** Reset for a fresh capture: no strokes, no history. */
    fun reset() {
        markup = VideoMarkup.empty()
        undoStack.clear()
        redoStack.clear()
    }

    /**
     * Replace the whole markup without a snapshot (re-opening a saved frame's
     * strokes; undo history starts empty). Same as [reset] + assign.
     */
    fun replace(markup: VideoMarkup) {
        reset()
        this.markup = markup
    }
}

/** A raw touch's stylus/finger classification, fed by the view's tool-type dispatch. */
enum class PointerKind { STYLUS, ERASER, FINGER }

/**
 * Palm rejection (plan §5.7.2): while the S-Pen hovers over the surface, finger
 * strokes are discarded. Pure decision logic — [MarkupView] maps MotionEvents
 * into these facts, so the hover-sequence rules are plain-JVM tested.
 */
object PalmRejection {

    /**
     * May a stroke start from this pointer? A stylus/eraser always may; a
     * finger may only when the pen is not hovering nearby.
     */
    fun acceptDown(kind: PointerKind, penNear: Boolean): Boolean =
        kind != PointerKind.FINGER || !penNear
}

/**
 * Tracks pen proximity from `ACTION_HOVER_*` events (device-id-keyed, so a
 * second stylus or a hover move from another device can't wedge the state).
 * The view feeds it enter/move/exit; [penNear] gates finger strokes.
 */
class PenProximityTracker {
    private val hoveringDevices = mutableSetOf<Int>()

    val penNear: Boolean get() = hoveringDevices.isNotEmpty()

    fun onHoverEnter(deviceId: Int) {
        hoveringDevices.add(deviceId)
    }

    fun onHoverMove(deviceId: Int) {
        hoveringDevices.add(deviceId)
    }

    fun onHoverExit(deviceId: Int) {
        hoveringDevices.remove(deviceId)
    }
}
