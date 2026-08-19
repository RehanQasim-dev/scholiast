package com.scholiast.android.data.normalize

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for the URL handling port (Task 03). Pure functions, no Android deps.
 *
 * Every expected normalized URL and every `urlHash`/`pageFileName` value in the
 * fixture tables below was computed by running the REAL desktop TypeScript code
 * (node, `shared/url.ts` + the `pageFileName` hash from `shared/merge.ts`) — see
 * task LOG.md for the verification script.
 */
class NormalizeTest {

    // --- normalizeUrl: tracking-param stripping -------------------------------

    private val EPHEMERAL_PARAMS = listOf(
        "t", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
        "ref", "ref_src", "source", "src",
        "fbclid", "gclid", "dclid", "msclkid", "twclid",
        "mc_cid", "mc_eid", "_ga", "_gl", "si",
    )

    @Test
    fun `strips utm_source utm_medium utm_campaign fbclid _ga and keeps other params`() {
        assertEquals(
            "https://example.com/article?x=1",
            Normalize.normalizeUrl(
                "https://example.com/article?utm_source=newsletter&utm_medium=email&utm_campaign=summer&fbclid=abc123&_ga=GA1.2.1234&x=1",
            ),
        )
    }

    @Test
    fun `strips t and si but keeps list`() {
        assertEquals(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123",
            Normalize.normalizeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=123&list=PL123&si=abc"),
        )
    }

    @Test
    fun `strips t but keeps start`() {
        // Byte-compat note: the task prose says strip "t/start", but the TS
        // EPHEMERAL_PARAMS set has only `t` — `start` survives. TS wins.
        assertEquals(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&start=45",
            Normalize.normalizeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=123&start=45"),
        )
    }

    @Test
    fun `strips ref ref_src source src but keeps an unnamed utm param`() {
        // Only the five NAMED utm_* params are stripped; `utm_foo` survives.
        assertEquals(
            "https://example.com/path?utm_foo=kept",
            Normalize.normalizeUrl("https://example.com/path?utm_foo=kept&src=stripped&ref_src=stripped&source=stripped&ref=stripped"),
        )
    }

    @Test
    fun `strips every one of the 20 EPHEMERAL_PARAMS`() {
        for (param in EPHEMERAL_PARAMS) {
            val url = "https://example.com/p?$param=value&keep=1"
            assertEquals("param $param must be stripped", "https://example.com/p?keep=1", Normalize.normalizeUrl(url))
        }
    }

    @Test
    fun `strips a bare param with no value`() {
        assertEquals("https://example.com/p?v=1", Normalize.normalizeUrl("https://example.com/p?t&v=1"))
    }

    @Test
    fun `strips params whose name is percent-encoded in the url`() {
        // URLSearchParams decodes names; the port's form-decode does too.
        assertEquals(
            "https://example.com/p?a=1",
            Normalize.normalizeUrl("https://example.com/p?utm%5Fsource=x&a=1"),
        )
    }

    @Test
    fun `preserves original param order`() {
        assertEquals(
            "https://example.com/p?b=2&a=1",
            Normalize.normalizeUrl("https://example.com/p?b=2&a=1"),
        )
    }

    // --- normalizeUrl: structure ----------------------------------------------

    @Test
    fun `drops the fragment`() {
        assertEquals("https://example.com/path/page", Normalize.normalizeUrl("https://example.com/path/page#frag"))
        assertEquals(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            Normalize.normalizeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ#fragment&foo=bar"),
        )
    }

    @Test
    fun `keeps a trailing slash on a non-empty path`() {
        assertEquals("https://example.com/path/page/", Normalize.normalizeUrl("https://example.com/path/page/"))
    }

    @Test
    fun `adds a slash for an empty path`() {
        assertEquals("https://example.com/", Normalize.normalizeUrl("https://example.com"))
    }

    @Test
    fun `lowercases scheme and host`() {
        assertEquals("https://example.com/", Normalize.normalizeUrl("HTTPS://EXAMPLE.COM/"))
    }

    @Test
    fun `drops default ports but keeps non-default ones`() {
        assertEquals("http://example.com/", Normalize.normalizeUrl("http://example.com:80/"))
        assertEquals("https://example.com/", Normalize.normalizeUrl("https://example.com:443/"))
        assertEquals("http://localhost:8080/x", Normalize.normalizeUrl("http://localhost:8080/x"))
    }

    @Test
    fun `resolves dot segments`() {
        assertEquals("https://example.com/a/c/d", Normalize.normalizeUrl("https://example.com/a/b/../c/./d"))
    }

    @Test
    fun `re-encodes the query exactly like URLSearchParams`() {
        // %20 in the query decodes to a space and re-encodes as `+`; %25 stays.
        assertEquals(
            "https://example.com/a%20b?q=hello+world",
            Normalize.normalizeUrl("https://example.com/a%20b?q=hello%20world"),
        )
        assertEquals(
            "https://example.com/x?r=100%25",
            Normalize.normalizeUrl("https://example.com/x?r=100%25"),
        )
    }

    @Test
    fun `returns input unchanged when it cannot be parsed`() {
        assertEquals("not a url", Normalize.normalizeUrl("not a url"))
        // Documented divergence: WHATWG percent-encodes the raw space, java.net.URI
        // rejects it, so we return the input unchanged (see Normalize.kt kdoc).
        assertEquals("https://example.com/a b", Normalize.normalizeUrl("https://example.com/a b"))
    }

    // --- extractVideoId ---------------------------------------------------------

    @Test
    fun `extracts from watch with v anywhere in the query`() {
        assertEquals("dQw4w9WgXcQ", Normalize.extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))
        assertEquals("dQw4w9WgXcQ", Normalize.extractVideoId("https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ&index=5"))
        assertEquals("dQw4w9WgXcQ", Normalize.extractVideoId("https://www.youtube.com/watch?t=60&v=dQw4w9WgXcQ&start=30"))
        assertEquals("dQw4w9WgXcQ", Normalize.extractVideoId("https://m.youtube.com/watch?v=dQw4w9WgXcQ"))
    }

    @Test
    fun `extracts from youtu be short links`() {
        assertEquals("dQw4w9WgXcQ", Normalize.extractVideoId("https://youtu.be/dQw4w9WgXcQ"))
        assertEquals("dQw4w9WgXcQ", Normalize.extractVideoId("https://youtu.be/dQw4w9WgXcQ?t=30"))
        assertEquals("dQw4w9WgXcQ", Normalize.extractVideoId("https://youtu.be/dQw4w9WgXcQ/extra/path"))
    }

    @Test
    fun `extracts from shorts embed and live`() {
        assertEquals("dQw4w9WgXcQ", Normalize.extractVideoId("https://youtube.com/shorts/dQw4w9WgXcQ?feature=share"))
        assertEquals("dQw4w9WgXcQ", Normalize.extractVideoId("https://youtube.com/shorts/dQw4w9WgXcQ/extra"))
        assertEquals("dQw4w9WgXcQ", Normalize.extractVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ"))
        assertEquals("dQw4w9WgXcQ", Normalize.extractVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ?start=45"))
        assertEquals("dQw4w9WgXcQ", Normalize.extractVideoId("https://www.youtube.com/live/dQw4w9WgXcQ"))
        assertEquals("dQw4w9WgXcQ", Normalize.extractVideoId("https://www.youtube.com/live/dQw4w9WgXcQ?feature=share"))
    }

    @Test
    fun `returns null for invalid or non-YouTube urls`() {
        assertNull(Normalize.extractVideoId("https://example.com/watch?v=dQw4w9WgXcQ"))
        assertNull(Normalize.extractVideoId("https://www.youtube.com/watch?v="))
        assertNull(Normalize.extractVideoId("https://www.youtube.com/watch"))
        assertNull(Normalize.extractVideoId("https://www.youtube.com/"))
        assertNull(Normalize.extractVideoId("https://youtu.be/"))
        assertNull(Normalize.extractVideoId("https://www.youtube.com/shorts/"))
        assertNull(Normalize.extractVideoId("not a url"))
        assertNull(Normalize.extractVideoId(""))
    }

    // --- urlHash / pageFileName ------------------------------------------------
    //
    // Fixtures computed by running the real TS code (node): shared/url.ts
    // normalizeUrl + the shared/merge.ts pageFileName hash (SHA-256 of the
    // normalized url, first 16 bytes, lowercase hex). See task LOG.md.

    private val HASH_FIXTURES = mapOf(
        "https://example.com/article?x=1" to "bbeb724611106d499bfaeeae2808c1e8",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123" to "459380db164cf39befe833994c12f996",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&start=45" to "30e4864ca20bce8c335eefe292cd3d2d",
        "https://example.com/path?utm_foo=kept" to "9d9cf7778600782ef29ec22967de3cc9",
        "https://example.com/" to "0f115db062b7c0dd030b16878c99dea5",
        "http://example.com/" to "2a1b402420ef46577471cdc7409b0fa2",
        "https://example.com/x?q=a+b&r=100%25" to "868b1a279795d4516421bfd5bd50780c",
        "https://example.com/a%20b?q=hello+world" to "65c1417c3fc9fb7b5ace07afb4c752f9",
        "https://example.com/a/c/d" to "ed550e401b1cd8092fdfebd37be49217",
        "https://example.com/path/page/" to "253bd110def6ba931e5e03bf2b61ad85",
        "https://example.com/path/page" to "f4487e8e7088d8af42048fbb4a928934",
        "https://youtu.be/dQw4w9WgXcQ" to "61e610a9d7fd37bc9df752aa7dd374f0",
        "https://youtube.com/shorts/dQw4w9WgXcQ?feature=share" to "8bfffba315e07741070a5ecf37ed21bf",
        "https://www.youtube.com/embed/dQw4w9WgXcQ" to "9a48466f10433f4ba5c859c48b958368",
        "https://www.youtube.com/live/dQw4w9WgXcQ" to "0c888b3aa897e315ca44982381956578",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=2" to "934ff66f65f4da1f3c34c3789b116ce0",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&start=30" to "c47071a1399995ef4d73002507481fb2",
        "https://m.youtube.com/watch?v=dQw4w9WgXcQ" to "71c5a3c2ade54326f3805c0e322f8c69",
    )

    @Test
    fun `urlHash matches the TS fixtures`() {
        for ((url, expected) in HASH_FIXTURES) {
            assertEquals("hash of $url", expected, Normalize.urlHash(url))
        }
    }

    @Test
    fun `urlHash is the sha-256 prefix scheme - 32 lowercase hex chars`() {
        for ((url, expected) in HASH_FIXTURES) {
            assertEquals(32, Normalize.urlHash(url).length)
            assertTrue("lowercase hex for $url", Normalize.urlHash(url) == Normalize.urlHash(url).lowercase())
            assertTrue("hex chars for $url", Normalize.urlHash(url).all { it in "0123456789abcdef" })
        }
    }

    @Test
    fun `pageFileName matches the TS output for the same urls`() {
        for ((url, hash) in HASH_FIXTURES) {
            assertEquals("page-$hash.json", Normalize.pageFileName(url))
        }
    }

    @Test
    fun `pageFilePath is the drive appdata path`() {
        assertEquals(
            "pages/page-459380db164cf39befe833994c12f996.json",
            Normalize.pageFilePath("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123"),
        )
    }

    @Test
    fun `stripped and unstripped urls hash identically`() {
        // `?t=30` on a youtu.be link normalizes away, so both forms map to the
        // same Drive file — the desktop repo's sync behaves the same way.
        val base = "https://youtu.be/dQw4w9WgXcQ"
        assertEquals(Normalize.urlHash(base), Normalize.urlHash(Normalize.normalizeUrl("$base?t=30")))
        assertEquals("page-61e610a9d7fd37bc9df752aa7dd374f0.json", Normalize.pageFileName(base))
    }

    @Test
    fun `normalize then hash matches the fixture table end to end`() {
        // The acceptance-criteria URLs, normalized and hashed in one pass —
        // proves the pipeline (not just the hash) matches the TS fixtures.
        assertEquals(
            "bbeb724611106d499bfaeeae2808c1e8",
            Normalize.urlHash(Normalize.normalizeUrl("https://example.com/article?utm_source=newsletter&utm_medium=email&utm_campaign=summer&fbclid=abc123&_ga=GA1.2.1234&x=1")),
        )
        assertEquals(
            "459380db164cf39befe833994c12f996",
            Normalize.urlHash(Normalize.normalizeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=123&list=PL123&si=abc")),
        )
        assertEquals(
            "30e4864ca20bce8c335eefe292cd3d2d",
            Normalize.urlHash(Normalize.normalizeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=123&start=45")),
        )
    }
}