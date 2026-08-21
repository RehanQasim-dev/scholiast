package com.scholiast.android.ui.reader

import com.scholiast.android.data.model.LinearBlock
import com.scholiast.android.data.model.PageHighlight
import com.scholiast.android.domain.reader.TextQuoteAnchor
import com.scholiast.android.domain.reader.buildTextQuoteAnchor
import com.scholiast.android.domain.reader.mergeOverlappingRanges
import com.scholiast.android.domain.reader.trimRange
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * The logic core of Reader highlighting (Task 29) — pure JVM, no Android or
 * Compose dependencies, so every rule here is unit-testable
 * (`HighlightControllerTest`). All produced data rides in [PageHighlight]:
 * known keys (`id`, `color`, `notes`, `updatedAt`) plus everything app-specific
 * inside the extras-preserving `extras` JsonObject, byte-compatible with the
 * desktop extension's highlight shape (plan §4.2):
 *
 * ```
 * { "id": "<epoch-ms>", "type": "text", "color": "yellow", "updatedAt": …,
 *   "content": "quoted text",
 *   "anchor": { quote, prefix, suffix, occurrence, surface: "web" },
 *   "hint":   { block, start, end },          // O(1) local repaint
 *   "groupId": "g<epoch-ms>" }                // only when a selection spans blocks
 * ```
 *
 * `hint.end` is EXCLUSIVE (half-open `[start, end)`); anchors are built over the
 * touched block's own text via Task 24's [buildTextQuoteAnchor].
 */
object HighlightController {

    /** A raw user selection inside one block: inclusive char [range] of that block's text. */
    data class BlockSelection(val blockIndex: Int, val range: IntRange)

    /**
     * App-local fast repaint pointer into a [LinearArticle]: block index +
     * half-open span `[start, end)` of that block's text. Stored in
     * `extras.hint`; re-derived from the anchor whenever it misses.
     */
    data class Hint(val block: Int, val start: Int, val end: Int) {
        val length: Int get() = end - start
    }

    // ------------------------------------------------------------------
    // Create
    // ------------------------------------------------------------------

    /**
     * Turn a (possibly multi-block) selection into highlights.
     *
     * - Per touched block the selection is passed through [trimRange] (a
     *   triple-click's trailing whitespace never reaches an anchor) and dropped
     *   when nothing but whitespace was selected.
     * - New spans merge with **same-color** existing highlights in the same
     *   block when they overlap or touch ([mergeOverlappingRanges]); other
     *   colors and untouched blocks pass through verbatim.
     * - A selection spanning >1 surviving block produces one highlight per
     *   block sharing `extras.groupId`, so recolor/delete act on the group.
     *
     * [now] supplies timestamps/ids (injected for tests); consecutive pieces
     * offset the epoch by 1ms so ids stay unique within one call.
     */
    fun create(
        blocks: List<LinearBlock>,
        sel: List<BlockSelection>,
        color: String,
        now: () -> Long = System::currentTimeMillis,
        existing: List<PageHighlight> = emptyList(),
    ): List<PageHighlight> {
        val t = now()
        val groupId = "g$t"
        val absorbed = mutableSetOf<String>()
        val pieces = mutableListOf<PageHighlight>()
        var idOffset = 0
        fun nextId(): String = (t + idOffset++).toString()

        val touched = sel.filter { it.range.first <= it.range.last }.sortedBy { it.blockIndex }
        for (touchedSel in touched) {
            val bi = touchedSel.blockIndex
            if (bi !in blocks.indices) continue
            val text = blocks[bi].text
            val fresh = mergeOverlappingRanges(listOf(trimRange(text, touchedSel.range.first, touchedSel.range.last + 1)))
                .filter { !it.isEmpty() }
            if (fresh.isEmpty()) continue

            // Same-color neighbors in this block participate in the merge.
            val neighbors = existing
                .map { hl -> Triple(hl, hintOf(hl), hintRangeOf(hl)) }
                .filter { (hl, hint, _) -> hl.color == color && hint?.block == bi }
            val merged = mergeOverlappingRanges(fresh + neighbors.mapNotNull { it.third })
            val grouped = touched.size > 1

            for (range in merged) {
                val contributors = neighbors.filter { (_, _, r) -> r != null && r.first >= range.first && r.last <= range.last }
                val exactSurvivor = contributors.singleOrNull()?.takeIf { (_, _, r) -> r == range }
                if (exactSurvivor != null && !grouped) {
                    absorbed += exactSurvivor.first.id // identical re-selection: no-op
                    continue
                }
                val id = contributors
                    .minByOrNull { (hl, _, _) -> hl.updatedAt ?: Long.MAX_VALUE }
                    ?.first?.id ?: nextId()
                absorbed += contributors.map { it.first.id }
                pieces += build(
                    id = id,
                    blockIndex = bi,
                    text = text,
                    range = range,
                    color = color,
                    updatedAt = t,
                    groupId = groupId.takeIf { grouped },
                )
            }
        }

        return existing.filter { it.id !in absorbed } + pieces
    }

    /** Rebuild one highlight's payload over an (already merged) inclusive [range] of `text`. */
    private fun build(
        id: String,
        blockIndex: Int,
        text: String,
        range: IntRange,
        color: String,
        updatedAt: Long,
        groupId: String?,
    ): PageHighlight {
        val anchor = buildTextQuoteAnchor(text, range.first, range.last + 1)
        return PageHighlight(
            id = id,
            updatedAt = updatedAt,
            color = color,
            extras = buildJsonObject {
                put("type", "text")
                put("content", anchor.quote)
                put("anchor", anchorJson(anchor))
                put("hint", hintJson(Hint(blockIndex, range.first, range.last + 1)))
                groupId?.let { put("groupId", it) }
            },
        )
    }

    // ------------------------------------------------------------------
    // Group actions
    // ------------------------------------------------------------------

    /** Recolor every piece of [groupId]; `updatedAt` restamped so sync merges newest-wins. */
    fun recolor(highlights: List<PageHighlight>, groupId: String, color: String, now: () -> Long = System::currentTimeMillis): List<PageHighlight> =
        highlights.map { hl -> if (groupIdOf(hl) == groupId) hl.copy(color = color, updatedAt = now()) else hl }

    /** Remove every piece of [groupId]. Persistence layers turn this into tombstones. */
    fun delete(highlights: List<PageHighlight>, groupId: String): List<PageHighlight> =
        highlights.filter { groupIdOf(it) != groupId }

    // ------------------------------------------------------------------
    // Extras readers (shared with HighlightPainter / ThreadSheet wiring)
    // ------------------------------------------------------------------

    fun hintOf(hl: PageHighlight): Hint? {
        val o = hl.extras["hint"] as? JsonObject ?: return null
        val block = o["block"]?.jsonPrimitive?.int ?: return null
        val start = o["start"]?.jsonPrimitive?.int ?: return null
        val end = o["end"]?.jsonPrimitive?.int ?: return null
        return Hint(block, start, end)
    }

    fun groupIdOf(hl: PageHighlight): String? = hl.extras["groupId"]?.jsonPrimitive?.takeIf { it.isString }?.content

    fun contentOf(hl: PageHighlight): String? = hl.extras["content"]?.jsonPrimitive?.takeIf { it.isString }?.content

    fun anchorOf(hl: PageHighlight): TextQuoteAnchor? {
        val o = hl.extras["anchor"] as? JsonObject ?: return null
        val quote = o["quote"]?.jsonPrimitive?.takeIf { it.isString }?.content ?: return null
        return TextQuoteAnchor(
            quote = quote,
            prefix = o["prefix"]?.jsonPrimitive?.content ?: "",
            suffix = o["suffix"]?.jsonPrimitive?.content ?: "",
            occurrence = o["occurrence"]?.jsonPrimitive?.int ?: 0,
        )
    }

    /** Inclusive block-local range implied by a hint, or null when absent/malformed. */
    fun hintRangeOf(hl: PageHighlight): IntRange? = hintOf(hl)?.let { it.start until it.end }?.let { it.first..it.last }

    // ------------------------------------------------------------------
    // JSON shapes
    // ------------------------------------------------------------------

    internal fun anchorJson(a: TextQuoteAnchor): JsonObject = buildJsonObject {
        put("quote", a.quote)
        put("prefix", a.prefix)
        put("suffix", a.suffix)
        put("occurrence", a.occurrence)
        put("surface", "web")
    }

    internal fun hintJson(h: Hint): JsonObject = buildJsonObject {
        put("block", h.block)
        put("start", h.start)
        put("end", h.end)
    }
}
