package com.scholiast.android.data.notes

import com.scholiast.android.data.model.LinearArticle
import com.scholiast.android.data.model.PageHighlight
import kotlinx.coroutines.flow.Flow

/**
 * The webpage-annotation store (Task 23 contract) — CRUD for a page's
 * [PageHighlight]s plus its extracted [LinearArticle] reader content. Backed by
 * the `video_pages` columns added in schema v2 (`highlightsJson`, `readerJson`);
 * keyed by the same normalized page url used everywhere else.
 *
 * Implementations must stamp `updatedAt` on write when the incoming highlight is
 * newer, so sync conflict resolution keeps working.
 */
interface PageHighlightRepository {
    suspend fun highlights(url: String): List<PageHighlight>
    suspend fun upsert(url: String, hl: PageHighlight)
    suspend fun delete(url: String, id: String)
    suspend fun replaceAll(url: String, list: List<PageHighlight>)
    suspend fun saveReaderArticle(article: LinearArticle)
    suspend fun readerArticle(url: String): LinearArticle?
    fun pagesWithHighlights(): Flow<List<PageListItem>>
}

/** One Home "Pages" tab row: a page with its highlight count and last open time. */
data class PageListItem(
    val url: String,
    val title: String?,
    val domain: String,
    val highlightCount: Int,
    val lastOpenedAt: Long?,
)
