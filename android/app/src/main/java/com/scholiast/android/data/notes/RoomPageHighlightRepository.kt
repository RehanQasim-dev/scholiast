package com.scholiast.android.data.notes

import com.scholiast.android.data.db.VideoPageDao
import com.scholiast.android.data.db.VideoPageEntity
import com.scholiast.android.data.model.LinearArticle
import com.scholiast.android.data.model.PageHighlight
import com.scholiast.android.data.model.ScholiastJson
import com.scholiast.android.data.normalize.Normalize
import java.net.URI
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Room-backed [PageHighlightRepository] over the `video_pages` table's
 * webpage-annotation columns (`highlightsJson`, `readerJson`; schema v2).
 * Constructor-injected DAO — no AppDatabase dependency — same pattern as
 * [com.scholiast.android.domain.sync.RoomPageStore] and
 * `RoomVideoItemRepository`.
 *
 * Every mutation is a read-modify-write of the row that touches ONLY
 * `highlightsJson` / `readerJson` (+ `updatedAt` when the user mutated
 * something) — `itemsJson`, `snapJson` and the Drive meta columns are never
 * clobbered. `updatedAt` on a highlight follows the sync merge's newest-wins
 * rule: an incoming edit older than the stored one is dropped, and a caller
 * that didn't stamp one gets `now`.
 *
 * The empty-list sentinel ([EMPTY_HIGHLIGHTS_JSON], `"[]"` with a space) is
 * deliberate: it parses to an empty list but is byte-distinct from the schema
 * default `'[]'`, which lets `RoomPageStore.load` seed pre-Task-27 rows from
 * their snapshot exactly once without ever resurrecting a deliberate local
 * delete-to-empty written by this repository.
 */
class RoomPageHighlightRepository(private val dao: VideoPageDao) : PageHighlightRepository {

    private fun keyAndHash(url: String): Pair<String, String> {
        val key = Normalize.normalizeUrl(url)
        return key to Normalize.urlHash(key)
    }

    override suspend fun highlights(url: String): List<PageHighlight> {
        val (_, hash) = keyAndHash(url)
        val entity = dao.getEntity(hash) ?: return emptyList()
        return runCatching { entity.highlights }.getOrDefault(emptyList())
    }

    override suspend fun upsert(url: String, hl: PageHighlight) {
        val (key, hash) = keyAndHash(url)
        val now = System.currentTimeMillis()
        val incoming = if (hl.updatedAt == null) hl.copy(updatedAt = now) else hl
        val entity = dao.getEntity(hash)
        val current = entity?.let { parsedHighlights(it) } ?: emptyList()
        val idx = current.indexOfFirst { it.id == incoming.id }
        if (idx >= 0 && (current[idx].updatedAt ?: 0L) > (incoming.updatedAt ?: 0L)) {
            return // stored edit is newer — newest-wins, mirror the sync merge
        }
        val next = if (idx >= 0) {
            current.toMutableList().also { it[idx] = incoming }
        } else {
            current + incoming
        }
        writeHighlights(key, hash, entity, next)
    }

    override suspend fun delete(url: String, id: String) {
        val (key, hash) = keyAndHash(url)
        val entity = dao.getEntity(hash) ?: return
        val current = parsedHighlights(entity)
        val next = current.filterNot { it.id == id }
        if (next.size == current.size) return
        writeHighlights(key, hash, entity, next)
    }

    override suspend fun replaceAll(url: String, list: List<PageHighlight>) {
        val (key, hash) = keyAndHash(url)
        writeHighlights(key, hash, dao.getEntity(hash), list)
    }

    override suspend fun saveReaderArticle(article: LinearArticle) {
        val (key, hash) = keyAndHash(article.url)
        val json = ScholiastJson.encode(article)
        val entity = dao.getEntity(hash)
        if (entity == null) {
            dao.upsert(
                VideoPageEntity(
                    urlHash = hash,
                    url = key,
                    videoId = null,
                    title = null,
                    itemsJson = "[]",
                    updatedAt = System.currentTimeMillis(),
                    snapJson = null,
                    fileId = null,
                    headRevisionId = null,
                    readerJson = json,
                )
            )
        } else if (entity.readerJson != json) {
            dao.upsert(entity.copy(readerJson = json))
        }
    }

    override suspend fun readerArticle(url: String): LinearArticle? {
        val (_, hash) = keyAndHash(url)
        val entity = dao.getEntity(hash) ?: return null
        return entity.readerJson?.let { json ->
            runCatching { ScholiastJson.decode<LinearArticle>(json) }.getOrNull()
        }
    }

    override fun pagesWithHighlights(): Flow<List<PageListItem>> =
        dao.observePagesWithHighlights().map { rows -> rows.mapNotNull { it.toListItem() } }

    // --- helpers -----------------------------------------------------------------

    private fun parsedHighlights(entity: VideoPageEntity): List<PageHighlight> =
        runCatching { entity.highlights }.getOrDefault(emptyList())

    /** Write the highlight list back, touching ONLY `highlightsJson` (+ row recency). */
    private suspend fun writeHighlights(
        key: String,
        hash: String,
        entity: VideoPageEntity?,
        highlights: List<PageHighlight>,
    ) {
        val json = if (highlights.isEmpty()) EMPTY_HIGHLIGHTS_JSON else ScholiastJson.encode(highlights)
        if (entity != null) {
            dao.upsert(entity.copy(highlightsJson = json, updatedAt = System.currentTimeMillis()))
        } else {
            dao.upsert(
                VideoPageEntity(
                    urlHash = hash,
                    url = key,
                    videoId = null,
                    title = null,
                    itemsJson = "[]",
                    updatedAt = System.currentTimeMillis(),
                    snapJson = null,
                    fileId = null,
                    headRevisionId = null,
                    highlightsJson = json,
                )
            )
        }
    }

    private fun VideoPageEntity.toListItem(): PageListItem? {
        val hls = parsedHighlights(this)
        val reader = readerJson?.let { json ->
            runCatching { ScholiastJson.decode<LinearArticle>(json) }.getOrNull()
        }
        if (hls.isEmpty() && reader == null) return null
        return PageListItem(
            url = url,
            title = title ?: reader?.title,
            domain = domainOf(url),
            highlightCount = hls.size,
            lastOpenedAt = updatedAt,
        )
    }

    companion object {
        /** Empty-list JSON that is byte-distinct from the schema default `'[]'`. */
        internal const val EMPTY_HIGHLIGHTS_JSON = "[ ]"

        private fun domainOf(url: String): String = try {
            URI(url).host?.lowercase() ?: ""
        } catch (_: Exception) {
            ""
        }
    }
}
