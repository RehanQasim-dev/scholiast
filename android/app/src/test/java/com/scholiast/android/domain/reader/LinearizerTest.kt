package com.scholiast.android.domain.reader

import com.scholiast.android.data.model.LinearArticle
import org.jsoup.Jsoup
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** [Linearizer]: DOM → [LinearArticle] blocks + char-offset annotations. */
class LinearizerTest {

    private fun linearize(html: String, maxChars: Int = Linearizer.DEFAULT_MAX_CHARS): LinearArticle =
        Linearizer(maxChars).linearize(
            article = Jsoup.parse(html, "https://example.com/post").body(),
            baseUrl = "https://example.com/post",
            title = "A post",
            byline = "By Someone",
            fetchedAt = 42L,
        )

    @Test
    fun `mixed formatting annotates char offsets into cleaned text`() {
        val article = linearize(
            """
            <nav>Site navigation</nav>
            <script>var tracking = 1;</script>
            <article>
              <p>Plain words, some <b>bold text</b>, an <em>italic phrase</em>,
                 inline <code>val x = 1</code> code and a <a href="/linked/page">partial link here</a>.</p>
            </article>
            """.trimIndent(),
        )
        assertEquals(listOf("p"), article.blocks.map { it.kind })
        val p = article.blocks.single()
        assertFalse(p.text.contains("Site navigation"))
        assertFalse(p.text.contains("var tracking"))
        assertTrue(p.text.contains("Plain words, some bold text"))
        assertFalse(p.text.contains('\n'))
        assertFalse(p.text.contains("  "))
        val byKind = p.annotations.associateBy { it.kind }
        assertEquals("https://example.com/linked/page", byKind.getValue("link").target)
        for ((kind, expected) in mapOf(
            "bold" to "bold text",
            "italic" to "italic phrase",
            "code" to "val x = 1",
            "link" to "partial link here",
        )) {
            val ann = byKind.getValue(kind)
            assertEquals(expected, p.text.substring(ann.start, ann.end))
        }
    }

    @Test
    fun `nested lists flatten to one li block each in document order`() {
        val article = linearize(
            """
            <ul><li>First outer item</li>
            <li>Second outer item<ul><li>Inner alpha</li><li>Inner beta</li></ul></li>
            <li>Third outer item</li></ul>
            """.trimIndent(),
        )
        assertEquals(listOf("li", "li", "li", "li", "li"), article.blocks.map { it.kind })
        assertEquals(
            listOf("First outer item", "Second outer item", "Inner alpha", "Inner beta", "Third outer item"),
            article.blocks.map { it.text },
        )
    }

    @Test
    fun `images resolve to absolute urls with figcaption blocks`() {
        val article = linearize(
            """
            <figure>
              <img src="/img/pic.png" alt="A picture">
              <figcaption>The caption line.</figcaption>
            </figure>
            <img srcset="/img/hi.png 2x, /img/lo.png 1x" alt="Hi res">
            """.trimIndent(),
        )
        assertEquals(listOf("img", "figcaption", "img"), article.blocks.map { it.kind })
        assertEquals("", article.blocks[0].text)
        assertEquals("https://example.com/img/pic.png", article.blocks[0].imgUrl)
        assertEquals("A picture", article.blocks[0].imgAlt)
        assertEquals("The caption line.", article.blocks[1].text)
        assertEquals("https://example.com/img/hi.png", article.blocks[2].imgUrl)
    }

    @Test
    fun `link spanning partial text maps exact offsets`() {
        val article = linearize(
            """<p>Before the <a href="https://example.com/target">middle linked words</a> after it.</p>""",
        )
        val p = article.blocks.single()
        assertEquals("Before the middle linked words after it.", p.text)
        val link = p.annotations.single()
        assertEquals("link", link.kind)
        assertEquals(11, link.start)
        assertEquals(30, link.end)
        assertEquals("middle linked words", p.text.substring(link.start, link.end))
    }

    @Test
    fun `truncation valve stops emitting and flags the article`() {
        val para = "<p>${"word ".repeat(8)}end</p>" // 43 chars of text per block
        val article = linearize(para.repeat(3), maxChars = 50)
        assertTrue(article.truncated)
        assertEquals(2, article.blocks.size) // 43 + 43 crosses 50; third never emitted
        assertTrue(article.blocks.sumOf { it.text.length } > 50)
        assertEquals(
            article.blocks.sumOf { it.text.split(Regex("[\\s\\u00A0]+")).count { t -> t.isNotEmpty() } },
            article.wordCount,
        )
    }

    @Test
    fun `round trip concatenation contains every visible sentence exactly once`() {
        val sentences = listOf(
            "The opening heading stands alone.",
            "The first paragraph makes its point in full.",
            "A quoted voice says something worth keeping.",
            "One list item states a fact.",
            "Another list item adds detail.",
            "The closing paragraph lands the ending.",
        )
        val html = """
            <h1>${sentences[0]}</h1>
            <p>${sentences[1]}</p>
            <blockquote>${sentences[2]}</blockquote>
            <ul><li>${sentences[3]}</li><li>${sentences[4]}</li></ul>
            <p>${sentences[5]}</p>
            <nav>Hidden chrome must not appear anywhere.</nav>
        """.trimIndent()
        val article = linearize(html)
        val joined = article.blocks.joinToString("\n\n") { it.text }
        for (sentence in sentences) {
            assertEquals("exactly once: $sentence", 1, joined.split(sentence).size - 1)
        }
        assertFalse(joined.contains("Hidden chrome"))
        assertFalse(article.truncated)
    }
}
