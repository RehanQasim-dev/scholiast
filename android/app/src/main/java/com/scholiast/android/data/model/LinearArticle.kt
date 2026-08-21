package com.scholiast.android.data.model

import kotlinx.serialization.Serializable

/**
 * A web page reduced to its readable linear content — the model the Reader tab
 * renders and anchors webpage highlights against (Task 23 contract). Produced by
 * readability4j extraction; stored per page in `video_pages.readerJson`.
 *
 * Plain `@Serializable` DTOs serialized through [ScholiastJson], so the JSON is
 * byte-compatible with anything the desktop side writes for the same shape:
 * defaults are encoded, nulls omitted, unknown keys tolerated.
 *
 * Note: `fetchedAt` deliberately follows the defaulted fields (spec order);
 * construct with named arguments.
 */
@Serializable
data class LinearArticle(
    val url: String,
    val title: String?,
    val byline: String? = null,
    val blocks: List<LinearBlock> = emptyList(),
    val wordCount: Int = 0,
    val fetchedAt: Long,
    val truncated: Boolean = false,
)

/**
 * One block of linear content. [kind] is one of `"p"`, `"h1"`..`"h6"`,
 * `"blockquote"`, `"code"`, `"li"`, `"img"`, `"figcaption"`; [text] is the
 * block's plain text (`""` for images).
 */
@Serializable
data class LinearBlock(
    val kind: String,
    val text: String,
    /** Char-offset annotation spans WITHIN [text]. */
    val annotations: List<LinearAnn> = emptyList(),
    val imgUrl: String? = null,
    val imgAlt: String? = null,
    /** 1-based position within an <ol> (task 33: ordered lists render numbers). */
    val listOrdinal: Int? = null,
    /** DOM element id (or nearest ancestor id) for same-page #fragment scrolling. */
    val anchorId: String? = null,
)

/**
 * An inline annotation inside a [LinearBlock]: [start]/[end] are char offsets
 * into the block's text; [kind] is `"link" | "bold" | "italic" | "code"` and
 * [target] is the href for links.
 */
@Serializable
data class LinearAnn(
    val kind: String,
    val start: Int,
    val end: Int,
    val target: String,
)
