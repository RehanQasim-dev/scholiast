package com.scholiast.android.domain.reader

import com.scholiast.android.data.model.LinearAnn
import com.scholiast.android.data.model.LinearArticle
import com.scholiast.android.data.model.LinearBlock
import org.jsoup.nodes.Element
import org.jsoup.nodes.Node
import org.jsoup.nodes.TextNode
import java.net.MalformedURLException
import java.net.URL

/**
 * Task 26 — flattens a cleaned article DOM (Task 25's readability `Success.article`)
 * into the [LinearArticle] block model. Pure JVM (Jsoup only).
 *
 * Contract for Tasks 24/28/29: [LinearBlock.text] is the FINAL cleaned surface —
 * runs of whitespace collapsed to single spaces and ends trimmed (except `code`
 * blocks, kept verbatim so indentation survives) — and every [LinearAnn]
 * start/end indexes into exactly that text. Blocks are emitted in document
 * order; identical input always yields identical output.
 */
class Linearizer(private val maxChars: Int = DEFAULT_MAX_CHARS) {

    private var baseUrl: URL? = null
    private val blocks = mutableListOf<LinearBlock>()
    private var cumulativeChars = 0
    private var truncated = false

    fun linearize(
        article: Element,
        baseUrl: String,
        title: String?,
        byline: String?,
        fetchedAt: Long,
    ): LinearArticle {
        this.baseUrl = runCatching { URL(baseUrl) }.getOrNull()
        blocks.clear()
        cumulativeChars = 0
        truncated = false
        walkChildren(article)
        return LinearArticle(
            url = baseUrl,
            title = title,
            byline = byline,
            blocks = blocks.toList(),
            wordCount = blocks.sumOf { it.text.countWords() },
            fetchedAt = fetchedAt,
            truncated = truncated,
        )
    }

    // ------------------------------------------------------------------ walk

    /** Walks a container's children; stray inline content between block children becomes an implicit "p". */
    private fun walkChildren(container: Element) {
        val sb = StringBuilder()
        val anns = mutableListOf<RawAnn>()
        val imgs = mutableListOf<Element>()
        for (child in container.childNodes()) {
            when {
                child is TextNode -> sb.append(child.text())
                child !is Element -> Unit // comments etc.
                else -> {
                    val tag = child.tagName()
                    when {
                        tag in SKIP_TAGS -> flushInline("p", sb, anns, imgs)
                        tag == "ul" || tag == "ol" -> { flushInline("p", sb, anns, imgs); walkList(child) }
                        tag == "li" -> { flushInline("p", sb, anns, imgs); walkListItem(child) }
                        tag == "img" -> { flushInline("p", sb, anns, imgs); emitImg(child) }
                        tag == "pre" -> { flushInline("p", sb, anns, imgs); emitCodeBlock(child) }
                        tag in TEXT_BLOCK_KINDS -> {
                            flushInline("p", sb, anns, imgs)
                            emitWrappedBlock(TEXT_BLOCK_KINDS.getValue(tag), child)
                        }
                        tag in INLINE_TAGS -> collectInline(child, sb, anns, imgs)
                        else -> { flushInline("p", sb, anns, imgs); walkChildren(child) }
                    }
                }
            }
        }
        flushInline("p", sb, anns, imgs)
    }

    private fun walkList(list: Element) {
        val ordered = list.tagName() == "ol"
        var ordinal = 0
        for (child in list.children()) {
            if (child.tagName() == "li") {
                ordinal++
                walkListItem(child, if (ordered) ordinal else null)
            }
        }
    }

    /**
     * One "li" block per list item; a nested ul/ol splits the item so each nested
     * li gets its own block. [ordinal] (1-based, <ol> only) rides on the block so
     * the renderer can print numbers instead of dots (task 33).
     */
    private fun walkListItem(li: Element, ordinal: Int? = null) {
        val sb = StringBuilder()
        val anns = mutableListOf<RawAnn>()
        val imgs = mutableListOf<Element>()
        for (child in li.childNodes()) {
            when {
                child is TextNode -> sb.append(child.text())
                child !is Element -> Unit
                child.tagName() == "ul" || child.tagName() == "ol" -> {
                    flushInline("li", sb, anns, imgs, ordinal, closestId(li))
                    walkList(child)
                }
                else -> collectInline(child, sb, anns, imgs)
            }
        }
        flushInline("li", sb, anns, imgs, ordinal, closestId(li))
    }

    /** The element's id, or the nearest ancestor's — same-page #fragment targets. */
    private fun closestId(el: Element): String? {
        var cur: Element? = el
        while (cur != null) {
            val id = cur.id()
            if (id.isNotBlank()) return id
            cur = cur.parent()
        }
        return null
    }

    /** p/h1..h6/blockquote/figcaption: one block whose text is the element's inline content. */
    private fun emitWrappedBlock(kind: String, el: Element) {
        val sb = StringBuilder()
        val anns = mutableListOf<RawAnn>()
        val imgs = mutableListOf<Element>()
        collectInline(el, sb, anns, imgs)
        flushInline(kind, sb, anns, imgs, ordinal = null, anchorId = closestId(el))
    }

    /**
     * Collects text + annotation spans from inline content. Nested formatting nests
     * naturally (a bold link yields both annotations over the same range). Images met
     * inside inline content are deferred and emitted as their own img blocks after the
     * surrounding text block.
     */
    private fun collectInline(node: Node, sb: StringBuilder, anns: MutableList<RawAnn>, imgs: MutableList<Element>) {
        when (node) {
            is TextNode -> sb.append(node.text())
            is Element -> {
                val tag = node.tagName()
                when {
                    tag in SKIP_TAGS -> Unit
                    tag == "br" -> sb.append('\n')
                    tag == "img" -> imgs += node
                    tag == "ul" || tag == "ol" -> Unit // block content inside inline context: dropped
                    else -> {
                        val kind = ANN_KIND[tag]
                        val target = if (tag == "a") absolute(node, "href") else ""
                        val start = sb.length
                        for (child in node.childNodes()) collectInline(child, sb, anns, imgs)
                        if (kind != null && sb.length > start) anns += RawAnn(kind, start, sb.length, target)
                    }
                }
            }
            else -> Unit
        }
    }

    // ----------------------------------------------------------------- emit

    private fun flushInline(
        kind: String,
        sb: StringBuilder,
        anns: MutableList<RawAnn>,
        imgs: MutableList<Element>,
        ordinal: Int? = null,
        anchorId: String? = null,
    ) {
        val complete = if (sb.isNotBlank()) emitTextBlock(kind, sb.toString(), anns, ordinal, anchorId) else true
        if (complete) imgs.forEach { emitImg(it) } // deferred inline images follow their text block
        sb.setLength(0)
        anns.clear()
        imgs.clear()
    }

    private fun emitTextBlock(
        kind: String,
        raw: String,
        anns: List<RawAnn>,
        ordinal: Int? = null,
        anchorId: String? = null,
    ): Boolean {
        val (text, map) = cleanWithMap(raw)
        val mapped = anns.mapNotNull { a ->
            val s = map[a.start.coerceIn(0, raw.length)]
            val e = map[a.end.coerceIn(0, raw.length)]
            if (e > s) LinearAnn(kind = a.kind, start = s, end = e, target = a.target) else null
        }.sortedWith(compareBy({ it.start }, { it.end }))
        return emit(LinearBlock(kind = kind, text = text, annotations = mapped, listOrdinal = ordinal, anchorId = anchorId))
    }

    private fun emitImg(img: Element) {
        val src = absolute(img, "src").ifEmpty { firstSrcsetCandidate(img) }
        emit(
            LinearBlock(
                kind = "img",
                text = "",
                imgUrl = src.ifEmpty { null },
                imgAlt = img.attr("alt").ifBlank { null },
                anchorId = closestId(img),
            ),
        )
    }

    /** `pre` → "code" with text kept verbatim ([Element.wholeText], no whitespace collapsing). */
    private fun emitCodeBlock(pre: Element) {
        emit(LinearBlock(kind = "code", text = pre.wholeText()))
    }

    /**
     * Truncation valve: blocks are emitted until cumulative chars exceed [maxChars];
     * the crossing block is included, then emission stops and [truncated] is set.
     */
    private fun emit(block: LinearBlock): Boolean {
        if (truncated) return false
        blocks += block
        cumulativeChars += block.text.length
        if (cumulativeChars > maxChars) truncated = true
        return true
    }

    // ------------------------------------------------------------- helpers

    private fun absolute(el: Element, attr: String): String {
        el.absUrl(attr).takeIf { it.isNotEmpty() }?.let { return it }
        val raw = el.attr(attr)
        if (raw.isEmpty()) return ""
        val base = baseUrl ?: return raw
        return try {
            URL(base, raw).toString()
        } catch (e: MalformedURLException) {
            raw
        }
    }

    /** First candidate of a `srcset` attribute ("a.png 2x, b.png 1x" → a.png), resolved absolute. */
    private fun firstSrcsetCandidate(img: Element): String {
        val first = img.attr("srcset").split(',').firstOrNull()?.trim()?.substringBefore(' ') ?: ""
        if (first.isEmpty()) return ""
        val base = baseUrl ?: return first
        return try {
            URL(base, first).toString()
        } catch (e: MalformedURLException) {
            first
        }
    }

    /**
     * Collapses whitespace runs to single spaces and trims ends. Returns the final
     * text plus a map from raw index to final index (clamped), so annotation offsets
     * recorded against the raw concatenation can be remapped onto the cleaned text.
     */
    private fun cleanWithMap(raw: String): Pair<String, IntArray> {
        val out = StringBuilder(raw.length)
        val map = IntArray(raw.length + 1)
        var pendingSpace = false
        for (i in raw.indices) {
            val c = raw[i]
            if (c.isCollapsibleWhitespace()) {
                if (out.isNotEmpty()) pendingSpace = true
                map[i] = out.length
            } else {
                if (pendingSpace) {
                    out.append(' ')
                    pendingSpace = false
                }
                map[i] = out.length
                out.append(c)
            }
        }
        map[raw.length] = out.length
        var start = 0
        var end = out.length
        while (start < end && out[start] == ' ') start++
        while (end > start && out[end - 1] == ' ') end--
        val len = end - start
        for (i in map.indices) map[i] = (map[i] - start).coerceIn(0, len)
        return out.substring(start, end) to map
    }

    private fun Char.isCollapsibleWhitespace(): Boolean = isWhitespace() || this == '\u00A0'

    private fun String.countWords(): Int =
        split(Regex("[\\s\\u00A0]+")).count { it.isNotEmpty() }

    private data class RawAnn(val kind: String, val start: Int, val end: Int, val target: String)

    companion object {
        const val DEFAULT_MAX_CHARS = 400_000

        private val SKIP_TAGS = setOf("nav", "header", "footer", "aside", "script", "style", "iframe", "form")

        private val TEXT_BLOCK_KINDS = mapOf(
            "p" to "p",
            "h1" to "h1", "h2" to "h2", "h3" to "h3",
            "h4" to "h4", "h5" to "h5", "h6" to "h6",
            "blockquote" to "blockquote",
            "figcaption" to "figcaption",
        )

        private val ANN_KIND = mapOf(
            "a" to "link",
            "strong" to "bold", "b" to "bold",
            "em" to "italic", "i" to "italic",
            "code" to "code",
        )

        private val INLINE_TAGS = setOf(
            "a", "strong", "b", "em", "i", "code", "span", "small", "u", "s", "strike",
            "mark", "sub", "sup", "q", "cite", "time", "abbr", "kbd", "samp", "var",
            "bdi", "bdo", "font", "big", "tt", "nobr",
        )
    }
}
