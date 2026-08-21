package com.scholiast.android.ui.reader

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.scholiast.android.data.model.LinearBlock
import com.scholiast.android.data.model.PageHighlight

/**
 * Design-time fixture: two paragraphs carrying a **grouped** yellow highlight
 * (one selection spanning both blocks → two pieces sharing `groupId`) plus a
 * standalone red highlight holding two comments (💬2 badge inline at range
 * end). Shows exactly what NativeReader (Task 32) will mount per block.
 */
@Preview(name = "Highlight layer", showBackground = true, backgroundColor = 0xFF000000, widthDp = 420, heightDp = 380)
@Composable
private fun HighlightLayerPreview() {
    MaterialTheme(colorScheme = darkColorScheme()) {
        val blocks = listOf(
            LinearBlock(kind = "p", text = "The quick brown fox jumps over the lazy dog while readers skim."),
            LinearBlock(kind = "p", text = "A second paragraph carries more words worth keeping around."),
        )
        val highlights = remember { fixtureHighlights(blocks) }

        Column(Modifier.fillMaxWidth().padding(20.dp)) {
            blocks.forEachIndexed { index, block ->
                val painted = HighlightPainter.paint(index, block, highlights)
                HighlightedText(
                    painted = painted,
                    onHintRewrite = {},
                    onTapHighlight = { },
                    inlineContent = highlights
                        .filter { (it.notes?.size ?: 0) > 0 }
                        .associate { badgeId(it.id) to badgeInlineContent(it.notes!!.size) {} },
                    modifier = Modifier.padding(bottom = 14.dp),
                )
            }
        }
    }
}

/** Built through the real controller so the preview exercises production shapes. */
private fun fixtureHighlights(blocks: List<LinearBlock>): List<PageHighlight> {
    fun range(block: Int, word: String): HighlightController.BlockSelection {
        val s = blocks[block].text.indexOf(word)
        return HighlightController.BlockSelection(block, s..s + word.length - 1)
    }
    // One drag across both paragraphs → grouped yellow pieces.
    val grouped = HighlightController.create(
        blocks,
        listOf(range(0, "brown fox jumps"), range(1, "more words")),
        "yellow",
        { 1_787_346_000_000 },
    )
    // A later red selection on paragraph 2, carrying two comments → badge.
    return HighlightController.create(
        blocks,
        listOf(range(1, "carries")),
        "red",
        { 1_787_346_001_000 },
        existing = grouped,
    ).map { hl ->
        if (hl.color == "red") hl.copy(notes = listOf("first thought", "second thought")) else hl
    }
}
