package com.scholiast.android.ui.reader

import com.scholiast.android.data.model.LinearArticle
import com.scholiast.android.data.model.LinearBlock
import com.scholiast.android.data.model.PageHighlight
import com.scholiast.android.data.notes.PageHighlightRepository
import com.scholiast.android.data.notes.PageListItem
import com.scholiast.android.domain.reader.ExtractResult
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.jsoup.Jsoup

/**
 * The reader load chain (Task 28): cached / fetch-ok / shell / failed, driven
 * through the public suspend [ReaderViewModel.loadOnce] with fakes — no
 * network, no Main dispatcher (same pattern as HomeViewModelTest).
 */
class ReaderViewModelTest {

    private class FakePageRepo(var cached: LinearArticle? = null) : PageHighlightRepository {
        var savedArticle: LinearArticle? = null
        var saveCalls: Int = 0
        override suspend fun highlights(url: String): List<PageHighlight> = emptyList()
        override suspend fun upsert(url: String, hl: PageHighlight) = Unit
        override suspend fun delete(url: String, id: String) = Unit
        override suspend fun replaceAll(url: String, list: List<PageHighlight>) = Unit
        override suspend fun saveReaderArticle(article: LinearArticle) {
            saveCalls++
            savedArticle = article
        }
        override suspend fun readerArticle(url: String): LinearArticle? = cached
        override fun pagesWithHighlights(): Flow<List<PageListItem>> = flowOf(emptyList())
    }

    private fun article(
        url: String = "https://example.com/a",
        title: String? = "Cached title",
    ) = LinearArticle(
        url = url,
        title = title,
        byline = null,
        blocks = listOf(LinearBlock(kind = "p", text = "Already extracted text.")),
        wordCount = 3,
        fetchedAt = 1_000L,
    )

    @Test
    fun `cached readerJson renders instantly and never hits the network`() = runBlocking {
        val cached = article()
        val repo = FakePageRepo(cached)
        var extractCalls = 0
        val viewModel = ReaderViewModel(
            url = "https://example.com/a",
            repository = repo,
            fetcher = ReaderFetcher {
                extractCalls++
                error("network must not be touched when a cache hit exists")
            },
        )
        val state = viewModel.loadOnce()
        assertEquals(ReaderUiState.Ready(cached), state)
        assertEquals(0, extractCalls)
        assertNull(repo.savedArticle) // nothing re-persisted on a cache hit
    }

    @Test
    fun `fetch ok linearizes persists and renders`() = runBlocking {
        val repo = FakePageRepo(cached = null)
        val html = "<html><body><article><p>Hello brave world.</p></article></body></html>"
        val element = Jsoup.parse(html).selectFirst("article")!!
        val viewModel = ReaderViewModel(
            url = "https://example.com/fresh",
            repository = repo,
            fetcher = ReaderFetcher {
                ExtractResult.Success(element, title = "Fresh title", byline = "An Author")
            },
        )
        val state = viewModel.loadOnce()
        assertTrue(state is ReaderUiState.Ready)
        val ready = state as ReaderUiState.Ready
        assertEquals("https://example.com/fresh", ready.article.url)
        assertEquals("Fresh title", ready.article.title)
        assertEquals(listOf("p"), ready.article.blocks.map { it.kind })
        assertEquals("Hello brave world.", ready.article.blocks.single().text)
        // Persisted for the next cold start.
        assertEquals(1, repo.saveCalls)
        assertEquals(ready.article, repo.savedArticle)
        assertEquals(ReaderUiState.Ready(repo.savedArticle!!), viewModel.state.value)
    }

    @Test
    fun `shell result falls back without persisting anything`() = runBlocking {
        val repo = FakePageRepo(cached = null)
        val viewModel = ReaderViewModel(
            url = "https://example.com/csr",
            repository = repo,
            fetcher = ReaderFetcher { ExtractResult.Shell("Thin content on https://example.com/csr") },
        )
        val state = viewModel.loadOnce()
        assertEquals(ReaderUiState.Shell("Thin content on https://example.com/csr"), state)
        assertEquals(ReaderUiState.Shell("Thin content on https://example.com/csr"), viewModel.state.value)
        assertNull(repo.savedArticle)
        assertEquals(0, repo.saveCalls)
    }

    @Test
    fun `failed result surfaces the error message`() = runBlocking {
        val repo = FakePageRepo(cached = null)
        val viewModel = ReaderViewModel(
            url = "https://example.com/paywalled",
            repository = repo,
            fetcher = ReaderFetcher { ExtractResult.Failed("HTTP 403 for https://example.com/paywalled") },
        )
        val state = viewModel.loadOnce()
        assertEquals(ReaderUiState.Failed("HTTP 403 for https://example.com/paywalled"), state)
        assertNull(repo.savedArticle)
        assertEquals(0, repo.saveCalls)
    }

    @Test
    fun `state starts at Loading before any load runs`() {
        val viewModel = ReaderViewModel(
            url = "https://example.com/a",
            repository = FakePageRepo(),
            fetcher = ReaderFetcher { error("not called") },
        )
        assertEquals(ReaderUiState.Loading, viewModel.state.value)
    }
}
