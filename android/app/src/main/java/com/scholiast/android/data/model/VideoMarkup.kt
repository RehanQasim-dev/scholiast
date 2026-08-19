package com.scholiast.android.data.model

import kotlinx.serialization.Serializable

/**
 * Frame markup drawn over a captured frame. All coordinates are NORMALIZED 0..1
 * of the frame, so markup repaints correctly over the saved image at any size.
 * Mirrors `VideoMarkup` in `src/utils/video/video-storage.ts` byte-for-byte
 * (TS names `VideoStroke`/`VideoLine`/`VideoText`/`VideoRect`/`VideoArrow` →
 * Kotlin `Stroke`/`Line`/`TextLabel`/`Rect`/`Arrow` per plan §4.2).
 */
@Serializable
data class VideoMarkup(
    val strokes: List<Stroke>,
    val lines: List<Line>,
    val texts: List<TextLabel>,
    val rects: List<Rect>? = null,
    val arrows: List<Arrow>? = null,
) {
    companion object {
        /** Mirrors the TS `emptyMarkup()` (all four shape lists present and empty). */
        fun empty(): VideoMarkup = VideoMarkup(
            strokes = emptyList(),
            lines = emptyList(),
            texts = emptyList(),
            rects = emptyList(),
            arrows = emptyList(),
        )
    }
}

/** A freehand stroke: flattened normalized points [x0,y0,x1,y1,...]. TS `VideoStroke`. */
@Serializable
data class Stroke(
    val id: String,
    val color: String,
    val points: List<@Serializable(with = JsDoubleSerializer::class) Double>,
    val weight: String? = null,
)

/** A straight line. TS `VideoLine`. */
@Serializable
data class Line(
    val id: String,
    val color: String,
    @Serializable(with = JsDoubleSerializer::class) val x1: Double,
    @Serializable(with = JsDoubleSerializer::class) val y1: Double,
    @Serializable(with = JsDoubleSerializer::class) val x2: Double,
    @Serializable(with = JsDoubleSerializer::class) val y2: Double,
    val weight: String? = null,
)

/** A text label: top-left at (x, y), wrapping within width w. TS `VideoText`. */
@Serializable
data class TextLabel(
    val id: String,
    val color: String,
    @Serializable(with = JsDoubleSerializer::class) val x: Double,
    @Serializable(with = JsDoubleSerializer::class) val y: Double,
    @Serializable(with = JsDoubleSerializer::class) val w: Double,
    @Serializable(with = JsDoubleSerializer::class) val size: Double? = null,
    val text: String,
)

/** An outline rectangle. TS `VideoRect`. */
@Serializable
data class Rect(
    val id: String,
    val color: String,
    @Serializable(with = JsDoubleSerializer::class) val x: Double,
    @Serializable(with = JsDoubleSerializer::class) val y: Double,
    @Serializable(with = JsDoubleSerializer::class) val w: Double,
    @Serializable(with = JsDoubleSerializer::class) val h: Double,
    val weight: String? = null,
)

/** An arrow (line + arrowhead). TS `VideoArrow`. */
@Serializable
data class Arrow(
    val id: String,
    val color: String,
    @Serializable(with = JsDoubleSerializer::class) val x1: Double,
    @Serializable(with = JsDoubleSerializer::class) val y1: Double,
    @Serializable(with = JsDoubleSerializer::class) val x2: Double,
    @Serializable(with = JsDoubleSerializer::class) val y2: Double,
    val weight: String? = null,
)