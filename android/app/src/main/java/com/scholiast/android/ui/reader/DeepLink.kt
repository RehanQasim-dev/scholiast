package com.scholiast.android.ui.reader

import android.net.Uri
import com.scholiast.android.data.model.LinearArticle
import com.scholiast.android.data.model.LinearBlock
import com.scholiast.android.data.model.PageHighlight
import com.scholiast.android.domain.reader.findTextQuoteRange

/**
 * Desktop-dashboard deep links (plan §5.9): `…#sc-hl=<highlightId>` opens the
 * Reader at that annotation — resolve → scroll the block to ⅓ viewport → a
 * single soft emphasis pulse (~2.6s, desktop reveal parity). Pure resolution
 * here; the scroll/pulse effect lives in [RevealHighlightEffect] (AnnotationLayer).
 */
object DeepLink {

    /** The fragment parameter name shared with the desktop dashboard. */
    const val PARAM = "sc-hl"

    /**
     * Extract `#sc-hl=<id>` from a raw incoming url (share/open-link). Null
     * when the url carries no such fragment. Tolerates double-encoded input
     * (`%23sc-hl=`) because nav args round-trip through percent-encoding.
     */
    fun highlightId(url: String): String? {
        val candidate = if (url.contains('%')) runCatching { Uri.decode(url) }.getOrDefault(url) else url
        val fragment = candidate.substringAfterLast('#', "")
            .substringBefore('?')
            .takeIf { it.isNotEmpty() } ?: return null
        // Fragment may be `sc-hl=<id>` or a bare `<id>` after the marker.
        val entry = fragment
            .split('&')
            .firstOrNull { it == PARAM || it.startsWith("$PARAM=") } ?: return null
        val value = if (entry == PARAM) "" else entry.substringAfter('=')
        return value.takeIf { it.isNotBlank() }
    }

    /** Strip any `#…` fragment — the clean page url for storage/sync keys. */
    fun stripFragment(url: String): String = url.substringBefore('#')

    /**
     * Where a highlight lives in [article]: its stored hint first (O(1)), else
     * the three-tier quote search over every block. Null when the annotation
     * can't be placed (never guesses).
     */
    fun resolve(
        article: LinearArticle,
        highlights: List<PageHighlight>,
        highlightId: String,
    ): PlacedHighlight? {
        val hl = highlights.firstOrNull { it.id == highlightId } ?: return null
        HighlightController.hintOf(hl)?.let { hint ->
            val block = article.blocks.getOrNull(hint.block)
            val content = HighlightController.contentOf(hl)
            if (block != null &&
                hint.start >= 0 && hint.end <= block.text.length && hint.start < hint.end &&
                (content == null || block.text.regionMatches(hint.start, content, 0, hint.length))
            ) {
                return PlacedHighlight(hint.block, hint.start..(hint.end - 1), hl)
            }
        }
        val anchor = HighlightController.anchorOf(hl) ?: return null
        article.blocks.forEachIndexed { index, block ->
            val range = findTextQuoteRange(anchor, block.text) ?: return@forEachIndexed
            return PlacedHighlight(index, range.first..range.last, hl)
        }
        return null
    }
}

/** A deep-linked highlight resolved to a block-local inclusive char range. */
data class PlacedHighlight(
    val blockIndex: Int,
    /** Inclusive range into [LinearBlock.text]. */
    val range: IntRange,
    val highlight: PageHighlight,
)

/** Per-line glyph rectangles of an inclusive range inside one laid-out block. */
internal fun rangeRectsInBlock(layout: androidx.compose.ui.text.TextLayoutResult, range: IntRange): List<androidx.compose.ui.geometry.Rect> {
    if (range.isEmpty()) return emptyList()
    val rects = mutableListOf<androidx.compose.ui.geometry.Rect>()
    val firstLine = layout.getLineForOffset(range.first)
    val lastLine = layout.getLineForOffset(range.last)
    for (line in firstLine..lastLine) {
        val a = maxOf(range.first, layout.getLineStart(line))
        val b = minOf(range.last, layout.getLineEnd(line))
        if (b < a) continue
        val startBox = layout.getBoundingBox(a)
        val endBox = layout.getBoundingBox(b)
        rects += androidx.compose.ui.geometry.Rect(
            minOf(startBox.left, endBox.left),
            layout.getLineTop(line),
            maxOf(startBox.right, endBox.right),
            layout.getLineBottom(line),
        )
    }
    return rects
}

/** Blocks of [article] between two block indexes (inclusive), for drag math. */
internal fun blocksBetween(blocks: List<LinearBlock>, from: Int, to: Int): List<Int> =
    (minOf(from, to)..maxOf(from, to)).filter { it in blocks.indices }
