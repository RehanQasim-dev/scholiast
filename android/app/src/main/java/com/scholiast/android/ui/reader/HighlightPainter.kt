package com.scholiast.android.ui.reader

import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.sp
import com.scholiast.android.data.model.LinearAnn
import com.scholiast.android.data.model.LinearBlock
import com.scholiast.android.data.model.PageHighlight
import com.scholiast.android.domain.reader.findTextQuoteRange
import com.scholiast.android.ui.theme.AccentPurple
import com.scholiast.android.ui.theme.HighlightGreen
import com.scholiast.android.ui.theme.HighlightRed
import com.scholiast.android.ui.theme.HighlightYellow

/** Fill alpha shared by every highlight hue (plan §6.1: 32% alpha fill). */
const val HIGHLIGHT_FILL_ALPHA = 0.32f

/** Token stream for [HighlightPainter.paint]'s badge interleaving (top level: local interfaces are illegal in Kotlin). */
private sealed interface Tok
private data class Txt(val from: Int, val to: Int) : Tok
private data class Bdg(val id: String) : Tok

/** The three data hues, keyed by the stored `color` string (desktop parity). */
fun highlightColor(color: String): Color = when (color) {
    "red" -> HighlightRed
    "green" -> HighlightGreen
    else -> HighlightYellow
}

/**
 * One tappable painted span: a highlight resolved against this block.
 * [groupId] links a multi-block selection — tapping any piece reports the group.
 */
data class HitSpan(
    val highlightId: String,
    val groupId: String?,
    val start: Int,
    val endExclusive: Int,
) {
    fun contains(offset: Int): Boolean = offset in start until endExclusive
}

/** A hint that missed and was re-resolved from the anchor; persisting it restores O(1) repaint. */
data class Rehint(val highlightId: String, val hint: HighlightController.Hint)

/**
 * The result of painting one block: the styled [text], its tap targets, and any
 * hints re-derived from quote anchors (the caller persists them into
 * `extras.hint` so the next repaint takes the fast path).
 */
data class PaintedBlock(
    val text: AnnotatedString,
    val hits: List<HitSpan>,
    val rehints: List<Rehint>,
)

/**
 * Paints [PageHighlight]s over one [LinearBlock] as `AnnotatedString` SpanStyles
 * (hue at [HIGHLIGHT_FILL_ALPHA]; plan §6.1 hues #F9E64D/#FF5A5A/#5FE3A0).
 *
 * Resolution per highlight (plan §4.2):
 *  1. **Hint-first (O(1))** — `extras.hint {block,start,end}` names the span
 *     directly; trusted only when it points at THIS block, is in bounds, and
 *     the quoted text still sits there verbatim (re-extraction shifts offsets).
 *  2. **Anchor fallback** — [findTextQuoteRange] over the block text
 *     (exact → whitespace-insensitive → fuzzy); the recovered span comes back
 *     in [PaintedBlock.rehints] so the caller can rewrite the hint.
 *  3. Unplaced highlights paint nothing — never a wrong guess.
 *
 * Grouped pieces (shared `extras.groupId`) already carry the group color —
 * [HighlightController.recolor] writes every member — so painting is uniform.
 */
object HighlightPainter {

    /**
     * Resolve [highlights] against [block] (its index in the article is
     * [blockIndex]). Pure: no composition, no side effects.
     */
    fun resolve(blockIndex: Int, block: LinearBlock, highlights: List<PageHighlight>): Pair<List<HitSpan>, List<Rehint>> {
        val hits = mutableListOf<HitSpan>()
        val rehints = mutableListOf<Rehint>()
        val text = block.text
        for (hl in highlights) {
            val group = HighlightController.groupIdOf(hl)
            val hint = HighlightController.hintOf(hl)
            val content = HighlightController.contentOf(hl)
            if (hint != null && hint.block == blockIndex &&
                hint.start >= 0 && hint.end <= text.length && hint.start < hint.end &&
                (content == null || text.regionMatches(hint.start, content, 0, hint.length))
            ) {
                hits += HitSpan(hl.id, group, hint.start, hint.end)
                continue
            }
            // Hint missed (wrong block / stale offsets) → three-tier quote search.
            val anchor = HighlightController.anchorOf(hl) ?: continue
            val range = findTextQuoteRange(anchor, text) ?: continue
            hits += HitSpan(hl.id, group, range.first, range.last + 1)
            rehints += Rehint(hl.id, HighlightController.Hint(blockIndex, range.first, range.last + 1))
        }
        return hits to rehints
    }

    /**
     * Full block text: base annotation styles ([LinearAnn]) + highlight fills +
     * 💬n badge placeholders ([BadgeChip]) inline at each highlighted range's
     * end. Badge placeholders occupy one char each, shifting later offsets —
     * handled here by remapping every style onto the built string. When spans
     * overlap (rare; same-color overlaps merge upstream) badges defer to the
     * end of the block instead of landing inside another span.
     * Pass [badgeCount] returning 0 to disable badges.
     */
    fun paint(
        blockIndex: Int,
        block: LinearBlock,
        highlights: List<PageHighlight>,
        includeBaseStyles: Boolean = true,
        badgeCount: (PageHighlight) -> Int = { it.notes?.size ?: 0 },
    ): PaintedBlock {
        val (hits, rehints) = resolve(blockIndex, block, highlights)
        val byId = highlights.associateBy { it.id }

        val ordered = hits.sortedBy { it.start }
        val disjoint = ordered.zipWithNext().all { (a, b) -> b.start >= a.endExclusive }

        // Badge insertion points: exclusive end of each badged span (disjoint only).
        data class Insert(val pos: Int, val id: String)
        val inserts = if (disjoint) {
            ordered.mapNotNull { h ->
                val hl = byId[h.highlightId]
                if (hl != null && badgeCount(hl) > 0) Insert(h.endExclusive, badgeId(h.highlightId)) else null
            }
        } else {
            emptyList()
        }

        // Token stream: text segments interleaved with badge placeholders.
        val tokens = mutableListOf<Tok>()
        var src = 0
        for (ins in inserts.sortedBy { it.pos }) {
            if (ins.pos > src) tokens += Txt(src, ins.pos)
            tokens += Bdg(ins.id)
            src = ins.pos
        }
        if (src < block.text.length) tokens += Txt(src, block.text.length)
        if (!disjoint) {
            // Overlapping spans: badges pile up after the block's text.
            ordered.forEach { h ->
                val hl = byId[h.highlightId]
                if (hl != null && badgeCount(hl) > 0) tokens += Bdg(badgeId(h.highlightId))
            }
        }

        /** Built-string offset of an original offset; badges at `pos` sit BEFORE `pos`. */
        fun mapOffset(original: Int, endStyle: Boolean): Int =
            original + inserts.count { if (endStyle) it.pos < original else it.pos <= original }

        val styled = buildAnnotatedString {
            for (t in tokens) {
                when (t) {
                    is Txt -> append(block.text.substring(t.from, t.to))
                    is Bdg -> appendInlineContent(t.id, BADGE_PLACEHOLDER_CHAR)
                }
            }
            if (includeBaseStyles) {
                for (ann in block.annotations) {
                    addStyle(baseStyle(ann), mapOffset(ann.start, false), mapOffset(ann.end, true))
                }
            }
            for (hit in hits) {
                val color = highlightColor(byId[hit.highlightId]?.color ?: "yellow")
                addStyle(
                    SpanStyle(background = color.copy(alpha = HIGHLIGHT_FILL_ALPHA)),
                    mapOffset(hit.start, false),
                    mapOffset(hit.endExclusive, true),
                )
            }
        }
        return PaintedBlock(styled, hits, rehints)
    }
}

// ---------------------------------------------------------------------------
// Badge inline content (rendered by BadgeChip)
// ---------------------------------------------------------------------------

/** Object-replacement char occupying exactly one slot in the AnnotatedString. */
const val BADGE_PLACEHOLDER_CHAR = "\uFFFC"

/** Inline-content id for a highlight's badge. */
fun badgeId(highlightId: String) = "badge:$highlightId"

/**
 * The inline-content entry rendering a highlight's 💬n chip inside the Text.
 * Pair with [badgeId]; plan §5.3 (badges at highlight end).
 */
fun badgeInlineContent(count: Int, onClick: () -> Unit): InlineTextContent =
    InlineTextContent(
        placeholder = Placeholder(width = 34.sp, height = 22.sp, placeholderVerticalAlign = PlaceholderVerticalAlign.TextCenter),
    ) {
        BadgeChip(count = count, onClick = onClick)
    }

// ---------------------------------------------------------------------------
// Composable surface
// ---------------------------------------------------------------------------

/**
 * Renders a painted block with tap detection: tapping inside a painted span
 * reports its [HitSpan] (group-aware) to [onTapHighlight]; re-derived hints are
 * handed to [onHintRewrite] post-composition for persistence. Pure state +
 * callbacks — mounting is Task 32's job.
 */
@Composable
fun HighlightedText(
    painted: PaintedBlock,
    onHintRewrite: (List<Rehint>) -> Unit,
    onTapHighlight: (HitSpan) -> Unit,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyLarge,
    inlineContent: Map<String, InlineTextContent> = emptyMap(),
) {
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }

    LaunchedEffect(painted) {
        if (painted.rehints.isNotEmpty()) onHintRewrite(painted.rehints)
    }

    Text(
        text = painted.text,
        style = style,
        inlineContent = inlineContent,
        onTextLayout = { layout = it },
        modifier = modifier.pointerInput(painted) {
            detectTapGestures { pos ->
                val l = layout ?: return@detectTapGestures
                val offset = l.getOffsetForPosition(pos)
                painted.hits.firstOrNull { it.contains(offset) }?.let(onTapHighlight)
            }
        },
    )
}

/** Base formatting for the block's own annotations (links/bold/italic/code). */
private fun baseStyle(ann: LinearAnn): SpanStyle = when (ann.kind) {
    "bold" -> SpanStyle(fontWeight = FontWeight.Bold)
    "italic" -> SpanStyle(fontStyle = FontStyle.Italic)
    "code" -> SpanStyle(fontFamily = FontFamily.Monospace)
    "link" -> SpanStyle(color = AccentPurple, textDecoration = TextDecoration.Underline)
    else -> SpanStyle()
}
