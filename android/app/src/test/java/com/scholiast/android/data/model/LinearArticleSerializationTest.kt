package com.scholiast.android.data.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** [LinearArticle]/[LinearBlock]/[LinearAnn] survive a ScholiastJson round-trip losslessly. */
class LinearArticleSerializationTest {

    @Test
    fun `round-trips losslessly through ScholiastJson`() {
        val article = LinearArticle(
            url = "https://example.com/essay",
            title = "An essay",
            byline = "By Someone",
            blocks = listOf(
                LinearBlock(
                    kind = "p",
                    text = "A bold idea with a link and code.",
                    annotations = listOf(
                        LinearAnn(kind = "bold", start = 2, end = 6, target = ""),
                        LinearAnn(kind = "link", start = 18, end = 22, target = "https://example.com/x"),
                        LinearAnn(kind = "code", start = 27, end = 31, target = ""),
                    ),
                ),
                LinearBlock(kind = "h2", text = "Section"),
                LinearBlock(kind = "img", text = "", imgUrl = "https://example.com/i.png", imgAlt = "a picture"),
                LinearBlock(kind = "blockquote", text = "Quoted words."),
            ),
            wordCount = 1234,
            fetchedAt = 1712345678901L,
            truncated = true,
        )

        assertEquals(article, ScholiastJson.decode<LinearArticle>(ScholiastJson.encode(article)))

        // Byte-shape: defaults are written (desktop parity), nulls omitted, unknown keys tolerated.
        val minimal = ScholiastJson.encode(LinearArticle(url = "https://e.com", title = null, fetchedAt = 7L))
        assertTrue(minimal.contains("\"fetchedAt\":7"))
        assertFalse(minimal.contains("title") && minimal.contains(":null"))
        assertTrue(minimal.contains("\"blocks\":[]") && minimal.contains("\"truncated\":false"))

        val withUnknownKeys = """{"url":"u","title":"t","fetchedAt":9,"futureField":true}"""
        assertEquals(
            LinearArticle(url = "u", title = "t", fetchedAt = 9L),
            ScholiastJson.decode<LinearArticle>(withUnknownKeys),
        )
    }
}
