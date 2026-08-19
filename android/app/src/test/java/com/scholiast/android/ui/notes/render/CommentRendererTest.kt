package com.scholiast.android.ui.notes.render

import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import com.scholiast.android.ui.notes.render.CommentInline.Bold
import com.scholiast.android.ui.notes.render.CommentInline.InlineImage
import com.scholiast.android.ui.notes.render.CommentInline.Italic
import com.scholiast.android.ui.notes.render.CommentInline.Link
import com.scholiast.android.ui.notes.render.CommentInline.Tag
import com.scholiast.android.ui.notes.render.CommentInline.Text
import com.scholiast.android.ui.notes.render.CommentLine.BulletItem
import com.scholiast.android.ui.notes.render.CommentLine.Paragraph
import com.scholiast.android.ui.notes.render.CommentLine.TaskItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pins the comment-markdown subset renderer against the desktop
 * `src/utils/comment-markdown.test.ts` cases (round-trip, escaping, tasks,
 * tags) plus the video-note additions (hidden markers, image chips).
 */
class CommentRendererTest {

    private fun paragraph(markdown: String): Paragraph =
        renderComment(markdown).lines.single() as Paragraph

    private fun paragraphContent(markdown: String): List<CommentInline> =
        paragraph(markdown).content

    // --- Inline rendering ---------------------------------------------------

    @Test
    fun `renders bold italic and markdown links for display`() {
        val content = paragraphContent("a **bold** and *soft* [link](https://x.dev)")
        assertEquals(
            listOf(
                Text("a "),
                Bold(listOf(Text("bold"))),
                Text(" and "),
                Italic(listOf(Text("soft"))),
                Text(" "),
                Link("link", "https://x.dev"),
            ),
            content,
        )
    }

    @Test
    fun `bare urls auto link with trailing punctuation outside`() {
        val content = paragraphContent("see https://x.dev/path, ok")
        assertEquals(
            listOf(
                Text("see "),
                Link("https://x.dev/path", "https://x.dev/path"),
                Text(", ok"),
            ),
            content,
        )
    }

    @Test
    fun `multi-character trailing punctuation is stripped from bare urls`() {
        val content = paragraphContent("https://a.com/path!!")
        assertEquals(
            listOf(Link("https://a.com/path", "https://a.com/path"), Text("!!")),
            content,
        )
    }

    @Test
    fun `url inside a markdown link is not linked twice`() {
        assertEquals(
            listOf(Link("x", "https://a.com")),
            paragraphContent("[x](https://a.com)"),
        )
    }

    // --- Escaping (literal * _ \ stay literal, like the TS) -----------------

    @Test
    fun `literal asterisks underscores and backslashes stay literal`() {
        for (md in listOf("2 * 3", "a * b", "*", "**", "a_b", "a\\b", "\\*", "5 * 6 * 7")) {
            assertEquals(
                "expected `$md` to stay literal",
                listOf(Text(md)),
                paragraphContent(md),
            )
        }
    }

    @Test
    fun `html in comment text is not interpreted`() {
        val content = paragraphContent("<img src=x onerror=1>")
        assertEquals(listOf(Text("<img src=x onerror=1>")), content)
    }

    @Test
    fun `dollar content renders as plain text`() {
        val content = paragraphContent("cost is \$5 and \$x\$ stays")
        assertEquals(listOf(Text("cost is \$5 and \$x\$ stays")), content)
    }

    // --- Lines: bullets and tasks -------------------------------------------

    @Test
    fun `groups consecutive bullet lines`() {
        val lines = renderComment("- one\n- two").lines
        assertEquals(
            listOf(BulletItem(listOf(Text("one"))), BulletItem(listOf(Text("two")))),
            lines,
        )
    }

    @Test
    fun `renders task items with their checked state`() {
        val lines = renderComment("- [ ] open\n- [x] done").lines
        assertEquals(TaskItem(listOf(Text("open")), checked = false), lines[0])
        assertEquals(TaskItem(listOf(Text("done")), checked = true), lines[1])
    }

    @Test
    fun `capital X means done`() {
        val lines = renderComment("- [X] done").lines
        assertEquals(TaskItem(listOf(Text("done")), checked = true), lines.single())
    }

    @Test
    fun `keeps bullet and task lists separate`() {
        val lines = renderComment("- plain\n- [ ] task").lines
        assertEquals(BulletItem(listOf(Text("plain"))), lines[0])
        assertEquals(TaskItem(listOf(Text("task")), checked = false), lines[1])
    }

    @Test
    fun `task content may itself carry inline markup`() {
        val lines = renderComment("- [ ] **bold** task").lines
        assertEquals(TaskItem(listOf(Bold(listOf(Text("bold"))), Text(" task")), checked = false), lines.single())
    }

    // --- Tags ---------------------------------------------------------------

    @Test
    fun `tags become pills when they start the text or follow whitespace`() {
        val content = paragraphContent("#a stays #b here")
        assertEquals(
            listOf(Tag("#a"), Text(" stays "), Tag("#b"), Text(" here")),
            content,
        )
    }

    @Test
    fun `midword hash is not a tag`() {
        assertEquals(listOf(Text("a#b c#d")), paragraphContent("a#b c#d"))
    }

    @Test
    fun `tags may carry a path segment`() {
        val content = paragraphContent("x #a/b/c y")
        assertEquals(
            listOf(Text("x "), Tag("#a/b/c"), Text(" y")),
            content,
        )
    }

    @Test
    fun `tags inside bold are pilled and round-trip`() {
        val md = "**a #tag b**"
        val spans = renderComment(md)
        assertEquals(md, spans.toMarkdown())
        val bold = paragraphContent(md).single() as Bold
        assertEquals(
            listOf(Text("a "), Tag("#tag"), Text(" b")),
            bold.content,
        )
    }

    // --- Timestamp / edited markers -----------------------------------------

    @Test
    fun `timestamp and edited markers never render - edited is reported`() {
        val spans = renderComment("hello<!--timestamp:1712345678901--><!--edited:1712345679999-->")
        assertEquals(1712345679999L, spans.edited)
        assertEquals(listOf(Paragraph(listOf(Text("hello")))), spans.lines)
    }

    @Test
    fun `note without markers has no edited stamp`() {
        assertNull(renderComment("plain").edited)
    }

    @Test
    fun `marker-only or blank text renders nothing`() {
        assertTrue(renderComment("").lines.isEmpty())
        assertTrue(renderComment("   ").lines.isEmpty())
        assertTrue(renderComment("<!--timestamp:1-->").lines.isEmpty())
    }

    // --- Image / diagram chips ----------------------------------------------

    @Test
    fun `image markers become inline image chips`() {
        val content = paragraphContent("see <!--image:img_1--> after")
        assertEquals(
            listOf(Text("see "), InlineImage("img_1", ImageKind.IMAGE), Text(" after")),
            content,
        )
    }

    @Test
    fun `diagram markers become inline diagram chips`() {
        assertEquals(
            listOf(InlineImage("diagram_9", ImageKind.DIAGRAM)),
            paragraphContent("<!--diagram:diagram_9-->"),
        )
    }

    // --- Round-trips (markdown → spans → markdown) --------------------------

    @Test
    fun `markdown to spans to markdown is the identity for the TS subset`() {
        for (md in listOf(
            "plain text",
            "**bold** then *italic*",
            "- one\n- two",
            "- [ ] open\n- [x] done",
            "intro\n- a\n- b",
            "[label](https://example.com/x)",
            "#tag stays text",
            "see <!--image:img_1--> after",
            "a\n\nb",
        )) {
            assertEquals(md, renderComment(md).toMarkdown())
        }
    }

    @Test
    fun `nested links inside bold round-trip`() {
        val md = "**see [x](https://x.dev) now**"
        val spans = renderComment(md)
        assertEquals(md, spans.toMarkdown())
        val bold = paragraphContent(md).single() as Bold
        assertTrue(bold.content.contains(Link("x", "https://x.dev")))
    }

    // --- Task toggle rewriting ----------------------------------------------

    @Test
    fun `toggleTaskInMarkdown flips only the nth task marker`() {
        val md = "- [ ] a\n- [ ] b\n- [x] c"
        assertEquals("- [ ] a\n- [x] b\n- [x] c", toggleTaskInMarkdown(md, 1))
        assertEquals("- [ ] a\n- [ ] b\n- [ ] c", toggleTaskInMarkdown(md, 2))
        assertEquals(md, toggleTaskInMarkdown(md, 9))
    }

    @Test
    fun `toggleTaskInMarkdown ignores bullet lines and mid-line markers`() {
        val md = "- plain\n- [ ] a - [ ] b"
        assertEquals(md, toggleTaskInMarkdown(md, 1))
        assertEquals("- plain\n- [x] a - [ ] b", toggleTaskInMarkdown(md, 0))
    }

    // --- AnnotatedString layer ----------------------------------------------

    @OptIn(ExperimentalTextApi::class)
    @Test
    fun `toAnnotatedString carries bold italic and link styles`() {
        val annotated = paragraphContent("**b** *i* [l](https://x.dev)").toAnnotatedString()
        assertEquals("b i l", annotated.text)
        assertTrue(annotated.spanStyles.any { it.item.fontWeight == FontWeight.Bold })
        assertTrue(annotated.spanStyles.any { it.item.fontStyle == FontStyle.Italic })
        val links = annotated.getLinkAnnotations(0, annotated.text.length)
        assertEquals(1, links.size)
        val clickable = links.single().item as LinkAnnotation.Clickable
        assertEquals("https://x.dev", clickable.tag)
    }

    @Test
    fun `tag spans carry the pill background`() {
        val annotated = paragraphContent("#tag").toAnnotatedString()
        val span = annotated.spanStyles.single().item
        assertEquals(CommentTextStyles().tagBackground, span.background)
    }

    @Test
    fun `inline image content ids are stable`() {
        assertEquals(
            "scholiast:image:img_1",
            inlineContentId(InlineImage("img_1", ImageKind.IMAGE)),
        )
        assertEquals(
            "scholiast:diagram:d_9",
            inlineContentId(InlineImage("d_9", ImageKind.DIAGRAM)),
        )
    }
}
