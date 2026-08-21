package com.scholiast.android.domain.reader

import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ExtractorTest {

    private lateinit var server: MockWebServer
    private lateinit var extractor: Extractor

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        extractor = Extractor(OkHttpClient())
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun enqueueFixture(name: String) {
        val html = requireNotNull(javaClass.classLoader).getResourceAsStream("fixtures/$name")!!
            .readBytes().toString(Charsets.UTF_8)
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(html)
                .setHeader("Content-Type", "text/html; charset=utf-8")
        )
    }

    @Test
    fun `clean article yields Success with title byline and paragraphs`() = runBlocking {
        enqueueFixture("clean.html")
        val result = extractor.extract(server.url("/article").toString())
        assertTrue("expected Success, got $result", result is ExtractResult.Success)
        result as ExtractResult.Success
        assertTrue("title was ${result.title}", result.title.orEmpty().contains("Coral Reefs"))
        assertTrue("byline was ${result.byline}", result.byline.orEmpty().contains("Okafor"))
        assertTrue("paragraphs=${result.article.select("p").size}", result.article.select("p").size >= 3)
    }

    @Test
    fun `div wrapped paragraphs are converted into p blocks`() = runBlocking {
        enqueueFixture("div-wrapped.html")
        val result = extractor.extract(server.url("/divs").toString())
        assertTrue("expected Success, got $result", result is ExtractResult.Success)
        val paragraphs = (result as ExtractResult.Success).article.select("p")
        assertTrue("paragraphs=${paragraphs.size}", paragraphs.size >= 4)
    }

    @Test
    fun `paywalled stub reports Shell`() = runBlocking {
        enqueueFixture("paywall.html")
        val result = extractor.extract(server.url("/paywall").toString())
        assertTrue("expected Shell, got $result", result is ExtractResult.Shell)
    }

    @Test
    fun `csr shell reports Shell`() = runBlocking {
        enqueueFixture("csr-shell.html")
        val result = extractor.extract(server.url("/spa").toString())
        assertTrue("expected Shell, got $result", result is ExtractResult.Shell)
    }
}
