package com.scholiast.android.ui.frame

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RectF
import android.view.MotionEvent
import android.view.View
import com.scholiast.android.data.model.Arrow
import com.scholiast.android.data.model.Line
import com.scholiast.android.data.model.Rect
import com.scholiast.android.data.model.Stroke
import com.scholiast.android.data.model.TextLabel
import com.scholiast.android.data.model.VideoMarkup
import com.scholiast.android.ui.notes.genVideoId
import java.io.ByteArrayOutputStream
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * The frame draw surface (plan §5.7.2, task 14): bottom = the captured frame
 * bitmap, top = a transparent markup layer. Tools: **pencil** (round cap,
 * width = f(pressure)), **highlighter** (wide, ~35% alpha), **eraser** (clears
 * the markup layer only, never the frame); colors yellow/red/green/black;
 * undo/redo over a 50-snapshot stack (see [MarkupSession]).
 *
 * ## Rendering model
 * Committed strokes live as normalized `VideoMarkup` (the source of truth) and
 * are rasterized into a view-size ARGB overlay bitmap. The live in-progress
 * stroke paints incrementally onto the same overlay — the pencil/highlighter
 * as normal segments, the eraser with `PorterDuff.CLEAR` so it visibly rubs
 * through the markup while dragging. On lift, the eraser path is hit-tested
 * against the stroke list ([MarkupSession.eraseStrokes]) and the overlay is
 * rebuilt from the list, so an erasure that touched nothing reverts and one
 * that did is gone for good (see LOG.md for the vector-eraser decision).
 *
 * ## Palm rejection (§5.7.2)
 * `ACTION_HOVER_*` tracks the S-Pen's proximity ([PenProximityTracker]); a
 * finger `ACTION_DOWN` while the pen is near is discarded. Tool-type dispatch:
 * stylus/eraser/finger ([PointerKind]), and the physical eraser tip acts as
 * the eraser tool regardless of the selected tool. Pencil width comes from
 * `AXIS_PRESSURE` within the [MarkupMath] min/max.
 *
 * The composite ([renderComposite]) bakes frame + markup at the frame's NATURAL
 * pixel size (not the view size), so the saved JPEG's `w`/`h` always match the
 * item's `frame{w,h}`.
 */
class MarkupView(
    context: Context,
    private val frame: Bitmap,
) : View(context) {

    /** The draw tools (plan §5.7.2; text/lines/rects/arrows are desktop-only). */
    enum class Tool { PENCIL, HIGHLIGHTER, ERASER }

    /** The frame's natural pixel size — the JPEG/`frame{w,h}` dimensions. */
    val frameWidth: Int = frame.width
    val frameHeight: Int = frame.height

    /** The selected tool. Affects new strokes only; existing markup is untouched. */
    var tool: Tool = Tool.PENCIL

    /** The selected color (JSON name, e.g. `"yellow"`). */
    var color: FrameColor = FrameColor.YELLOW

    /**
     * Invoked after any committed change to the markup (stroke committed,
     * erasure, undo/redo, clear) so the hosting Compose screen can refresh its
     * undo/redo button states.
     */
    var onMarkupChanged: (() -> Unit)? = null

    private val session = MarkupSession()
    private val proximity = PenProximityTracker()

    /** The view-size raster of the committed markup (rebuilt from the list on change). */
    private var overlay: Bitmap? = null

    /** Live stroke state (view pixels). */
    private var activePointerId = -1
    private var activePoints: MutableList<Pair<Float, Float>>? = null
    private var activePressures: MutableList<Float>? = null
    private var activeColor = FrameColor.YELLOW
    private var activeIsEraser = false
    private var suppressFingerStroke = false

    private val strokePaint = Paint().apply {
        isAntiAlias = true
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val erasePaint = Paint().apply {
        isAntiAlias = true
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR)
    }

    init {
        // Hover events are delivered reliably to clickable views.
        isClickable = true
        isFocusable = true
    }

    // --- Public API -----------------------------------------------------------

    /** The committed markup with normalized 0..1 coordinates (for persistence). */
    fun currentMarkup(): VideoMarkup = session.markup

    /** Restore an existing markup (e.g. re-opening a saved frame for edits). */
    fun setMarkup(markup: VideoMarkup) {
        session.replace(markup)
        repaintOverlay()
        onMarkupChanged?.invoke()
    }

    fun canUndo(): Boolean = session.canUndo

    fun canRedo(): Boolean = session.canRedo

    fun hasMarkup(): Boolean = session.hasMarkup

    fun undo(): Boolean {
        if (session.undo()) {
            repaintOverlay()
            onMarkupChanged?.invoke()
            return true
        }
        return false
    }

    fun redo(): Boolean {
        if (session.redo()) {
            repaintOverlay()
            onMarkupChanged?.invoke()
            return true
        }
        return false
    }

    /** Remove every stroke (undo restores). */
    fun clearMarkup() {
        if (!session.hasMarkup) return
        session.clear()
        repaintOverlay()
        onMarkupChanged?.invoke()
    }

    /** True while the pen hovers over the surface (finger strokes are gated). */
    val isPenNear: Boolean get() = proximity.penNear

    /**
     * Bake the frame + committed markup into a JPEG at the frame's natural
     * pixel size (weights via the desktop's `max(2, W*0.004)` math). Returns
     * null if compression fails. This is the "edited JPEG" that replaces the
     * original on the page and in sync (plan §5.7.3, path 2).
     */
    fun renderComposite(quality: Int = 80): ByteArray? {
        val out = Bitmap.createBitmap(frameWidth, frameHeight, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        canvas.drawBitmap(frame, 0f, 0f, null)
        drawMarkupTo(canvas, session.markup, frameWidth, frameHeight, resources.displayMetrics.density)
        return try {
            val stream = ByteArrayOutputStream()
            out.compress(Bitmap.CompressFormat.JPEG, quality, stream)
            stream.toByteArray()
        } catch (e: OutOfMemoryError) {
            null
        }
    }

    // --- Rendering ------------------------------------------------------------

    /**
     * The letterboxed frame rect within the view (aspect-fit). All drawing and
     * hit-testing goes through this mapping so the normalized markup is stored
     * in FRAME pixels, not view pixels: `renderComposite` then reproduces
     * exactly what was drawn on screen at the frame's natural size.
     */
    private fun frameScale(): Float {
        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= 0f || h <= 0f || frameWidth <= 0 || frameHeight <= 0) return 1f
        return minOf(w / frameWidth, h / frameHeight).coerceAtLeast(0.001f)
    }

    private fun frameOffsetX(): Float = (width - frameWidth * frameScale()) / 2f

    private fun frameOffsetY(): Float = (height - frameHeight * frameScale()) / 2f

    /** View px → frame px (the inverse of the onDraw transform). */
    private fun viewToFrame(x: Float, y: Float): Pair<Float, Float> {
        val s = frameScale()
        return ((x - frameOffsetX()) / s) to ((y - frameOffsetY()) / s)
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        overlay = Bitmap.createBitmap(w.coerceAtLeast(1), h.coerceAtLeast(1), Bitmap.Config.ARGB_8888)
        repaintOverlay()
    }

    /**
     * Rebuild the overlay raster from the committed markup list, drawn through
     * the same letterbox transform as [onDraw] so committed strokes land where
     * they were live-painted.
     */
    private fun repaintOverlay() {
        val ov = overlay ?: return
        ov.eraseColor(android.graphics.Color.TRANSPARENT)
        val canvas = Canvas(ov)
        canvas.save()
        canvas.translate(frameOffsetX(), frameOffsetY())
        canvas.scale(frameScale(), frameScale())
        drawMarkupTo(canvas, session.markup, frameWidth, frameHeight, resources.displayMetrics.density)
        canvas.restore()
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= 0f || h <= 0f) return

        // Fit the frame inside the view, letterboxed, preserving aspect.
        val scale = minOf(w / frameWidth, h / frameHeight)
        val dx = (w - frameWidth * scale) / 2f
        val dy = (h - frameHeight * scale) / 2f
        canvas.save()
        canvas.translate(dx, dy)
        canvas.scale(scale, scale)
        canvas.drawBitmap(frame, 0f, 0f, null)
        val ov = overlay
        if (ov != null) canvas.drawBitmap(ov, 0f, 0f, null)
        canvas.restore()
    }

    // --- Touch handling -------------------------------------------------------

    override fun onHoverEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_HOVER_ENTER -> proximity.onHoverEnter(event.deviceId)
            MotionEvent.ACTION_HOVER_MOVE -> proximity.onHoverMove(event.deviceId)
            MotionEvent.ACTION_HOVER_EXIT -> proximity.onHoverExit(event.deviceId)
        }
        return true
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> onStrokeDown(event)
            MotionEvent.ACTION_MOVE -> onStrokeMove(event)
            MotionEvent.ACTION_POINTER_DOWN -> Unit // one stroke at a time; extra fingers ignored
            MotionEvent.ACTION_POINTER_UP -> Unit
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> onStrokeUp()
        }
        return true
    }

    private fun pointerKind(event: MotionEvent): PointerKind = when (event.getToolType(0)) {
        MotionEvent.TOOL_TYPE_STYLUS -> PointerKind.STYLUS
        MotionEvent.TOOL_TYPE_ERASER -> PointerKind.ERASER
        else -> PointerKind.FINGER
    }

    private fun onStrokeDown(event: MotionEvent) {
        val kind = pointerKind(event)
        // Palm rejection: the pen is hovering → this finger stroke is discarded.
        if (!PalmRejection.acceptDown(kind, proximity.penNear)) {
            suppressFingerStroke = true
            return
        }
        suppressFingerStroke = false
        activePointerId = event.getPointerId(0)
        // The physical eraser tip acts as the eraser whatever the selected tool.
        activeIsEraser = kind == PointerKind.ERASER || tool == Tool.ERASER
        activeColor = color
        val x = event.x
        val y = event.y
        activePoints = mutableListOf(x to y)
        activePressures = mutableListOf(event.getPressure(0))
        if (!activeIsEraser) {
            // Immediate visual feedback for the first dot.
            paintLiveSegment(x, y, x, y, liveWidth(event.getPressure(0)), activeColor, activeIsEraser)
        }
        parent?.requestDisallowInterceptTouchEvent(true)
    }

    private fun onStrokeMove(event: MotionEvent) {
        if (suppressFingerStroke || activePoints == null) return
        val index = event.findPointerIndex(activePointerId)
        if (index < 0) return
        val x = event.getX(index)
        val y = event.getY(index)
        val pressure = event.getPressure(index)
        val points = activePoints!!
        val last = points.last()
        val dx = x - last.first
        val dy = y - last.second
        if (sqrt(dx * dx + dy * dy) < MarkupMath.MIN_SAMPLE_PX) return
        paintLiveSegment(last.first, last.second, x, y, liveWidth(pressure), activeColor, activeIsEraser)
        points.add(x to y)
        activePressures!!.add(pressure)
    }

    private fun onStrokeUp() {
        if (suppressFingerStroke) {
            suppressFingerStroke = false
            return
        }
        val points = activePoints ?: return
        val pressures = activePressures ?: return
        activePoints = null
        activePressures = null
        activePointerId = -1

        if (activeIsEraser) {
            // Vector erasure: remove every stroke the eraser path touched, then
            // rebuild the overlay from the list (restores any CLEAR'd-but-kept
            // pixels — an eraser swipe that hit nothing leaves the markup intact).
            // Hit-testing happens in FRAME pixels (strokes are frame-normalized),
            // so the view-coord path is mapped through the letterbox transform.
            val framePts = points.map { viewToFrame(it.first, it.second) }
            val pathPx = MarkupMath.flatten(framePts)
            val tolFramePx = MarkupMath.ERASER_TOL_DP * resources.displayMetrics.density / frameScale()
            session.eraseStrokes(pathPx, tolFramePx.toDouble(), frameWidth, frameHeight)
            repaintOverlay()
            onMarkupChanged?.invoke()
            return
        }

        val filtered = MarkupMath.filterMinDistance(points)
        if (filtered.size >= 2) {
            val avgPressure = pressures.average().toFloat()
            val widthPx = liveWidth(avgPressure)
            val weight = MarkupMath.weightFor(widthPx, resources.displayMetrics.density)
            val framePts = filtered.map { viewToFrame(it.first, it.second) }
            val normalized = MarkupMath.normalizeFlattened(
                MarkupMath.flatten(framePts), frameWidth, frameHeight,
            )
            session.commitStroke(
                id = genVideoId(),
                color = activeColor.json,
                points = normalized,
                weight = weight,
            )
            onMarkupChanged?.invoke()
        }
    }

    private fun liveWidth(pressure: Float): Float =
        when {
            activeIsEraser -> MarkupMath.eraserWidthPx(resources.displayMetrics.density)
            tool == Tool.HIGHLIGHTER -> MarkupMath.highlighterWidthPx(resources.displayMetrics.density)
            else -> MarkupMath.pencilWidthPx(resources.displayMetrics.density, pressure)
        }

    private fun paintLiveSegment(
        x1: Float, y1: Float, x2: Float, y2: Float,
        widthPx: Float, color: FrameColor, isEraser: Boolean,
    ) {
        val ov = overlay ?: return
        val canvas = Canvas(ov)
        val paint = if (isEraser) erasePaint else strokePaint
        paint.strokeWidth = widthPx
        if (!isEraser) {
            paint.color = color.argb
            if (tool == Tool.HIGHLIGHTER) {
                paint.alpha = (MarkupMath.HIGHLIGHTER_ALPHA * 255f).toInt()
            } else {
                paint.alpha = 255
            }
        }
        canvas.drawLine(x1, y1, x2, y2, paint)
        invalidate()
    }
}

/**
 * Renders a [VideoMarkup] onto a canvas at W×H pixels — the shared renderer
 * used by [MarkupView.renderComposite]/[repaintOverlay] and the dashboard
 * [FrameThumb]. Ported from the desktop's `renderMarkupSvg`
 * (`src/utils/video/video-markup.ts`): stroke weights via `max(2, W*0.004)`,
 * smoothed Q-curve paths, letterbox-free normalized coordinates, and the same
 * arrowhead geometry. Colors come from [FrameColor] (the desktop hex values).
 */
internal fun drawMarkupTo(
    canvas: Canvas,
    markup: VideoMarkup,
    w: Int,
    h: Int,
    density: Float,
) {
    if (w <= 0 || h <= 0) return
    val paint = Paint().apply {
        isAntiAlias = true
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }

    for (stroke in markup.strokes) {
        val path = strokePath(stroke.points, w, h) ?: continue
        paint.color = FrameColor.fromJson(stroke.color).argb
        paint.alpha = 255
        paint.strokeWidth = MarkupMath.renderWeightPx(stroke.weight, w)
        canvas.drawPath(path, paint)
    }

    for (line in markup.lines) {
        paint.color = FrameColor.fromJson(line.color).argb
        paint.strokeWidth = MarkupMath.renderWeightPx(line.weight, w)
        canvas.drawLine(
            MarkupMath.denormalize(line.x1, w), MarkupMath.denormalize(line.y1, h),
            MarkupMath.denormalize(line.x2, w), MarkupMath.denormalize(line.y2, h),
            paint,
        )
    }

    for (text in markup.texts) {
        drawTextLabel(canvas, text, w, h, density, paint)
    }

    for (rect in markup.rects.orEmpty()) {
        paint.color = FrameColor.fromJson(rect.color).argb
        paint.strokeWidth = MarkupMath.renderWeightPx(rect.weight, w)
        canvas.drawRect(
            RectF(
                MarkupMath.denormalize(rect.x, w), MarkupMath.denormalize(rect.y, h),
                MarkupMath.denormalize(rect.x + rect.w, w), MarkupMath.denormalize(rect.y + rect.h, h),
            ),
            paint,
        )
    }

    for (arrow in markup.arrows.orEmpty()) {
        drawArrow(canvas, arrow, w, h, paint)
    }
}

/** The smoothed path through normalized stroke points (desktop `strokePath`). */
internal fun strokePath(points: List<Double>, w: Int, h: Int): Path? {
    if (points.size < 2) return null
    val px = { i: Int -> MarkupMath.denormalize(points[i], w) }
    val py = { i: Int -> MarkupMath.denormalize(points[i + 1], h) }
    val path = Path()
    path.moveTo(px(0), py(0))
    if (points.size < 6) {
        var i = 2
        while (i < points.size) {
            path.lineTo(px(i), py(i))
            i += 2
        }
        return path
    }
    var i = 2
    while (i < points.size - 2) {
        val xc = (px(i) + px(i + 2)) / 2f
        val yc = (py(i) + py(i + 2)) / 2f
        path.quadTo(px(i), py(i), xc, yc)
        i += 2
    }
    path.lineTo(px(points.size - 2), py(points.size - 2))
    return path
}

private fun drawTextLabel(
    canvas: Canvas,
    text: TextLabel,
    w: Int,
    h: Int,
    density: Float,
    paint: Paint,
) {
    val boxW = (if (text.w != null && text.w > 0) text.w else 0.28) * w
    val fontSize = max(11f, h * 0.034f) * (text.size ?: 1.0).toFloat()
    paint.style = Paint.Style.FILL
    paint.textSize = fontSize
    paint.color = FrameColor.fromJson(text.color).argb
    if (text.color == FrameColor.BLACK.json) {
        paint.setShadowLayer(2f * density, 0f, 1f, 0xB3FFFFFF)
    } else {
        paint.setShadowLayer(2f * density, 0f, 1f, 0xB3000000)
    }
    val x = MarkupMath.denormalize(text.x, w)
    val y = MarkupMath.denormalize(text.y, h)
    val fontMetrics = paint.fontMetrics
    val lineHeight = fontMetrics.descent - fontMetrics.ascent
    // No soft wrap in the raster path — one line per source line, clamped to the box.
    var lineY = y - fontMetrics.ascent + 2f * density
    for (line in text.text.split('\n')) {
        if (line.isBlank() && line == text.text) break
        canvas.drawText(line, x, lineY, paint)
        lineY += lineHeight
    }
    paint.setShadowLayer(0f, 0f, 0f, 0)
    paint.style = Paint.Style.STROKE
}

private fun drawArrow(canvas: Canvas, arrow: Arrow, w: Int, h: Int, paint: Paint) {
    val x1 = MarkupMath.denormalize(arrow.x1, w)
    val y1 = MarkupMath.denormalize(arrow.y1, h)
    val x2 = MarkupMath.denormalize(arrow.x2, w)
    val y2 = MarkupMath.denormalize(arrow.y2, h)
    paint.color = FrameColor.fromJson(arrow.color).argb
    val strokeWidth = MarkupMath.renderWeightPx(arrow.weight, w)
    paint.strokeWidth = strokeWidth
    canvas.drawLine(x1, y1, x2, y2, paint)

    // Arrowhead (desktop `video-markup.ts` geometry).
    val angle = Math.atan2((y2 - y1).toDouble(), (x2 - x1).toDouble())
    val headLen = max(10f, strokeWidth * 4f)
    val a1 = angle - Math.PI / 6
    val a2 = angle + Math.PI / 6
    val hx1 = x2 - headLen * cos(a1).toFloat()
    val hy1 = y2 - headLen * sin(a1).toFloat()
    val hx2 = x2 - headLen * cos(a2).toFloat()
    val hy2 = y2 - headLen * sin(a2).toFloat()
    val head = Path()
    head.moveTo(hx1, hy1)
    head.lineTo(x2, y2)
    head.lineTo(hx2, hy2)
    canvas.drawPath(head, paint)
}