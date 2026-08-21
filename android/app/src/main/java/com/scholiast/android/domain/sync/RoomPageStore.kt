package com.scholiast.android.domain.sync

import com.scholiast.android.data.db.VideoPageDao
import com.scholiast.android.data.db.VideoPageEntity
import com.scholiast.android.data.model.PageHighlight
import com.scholiast.android.data.model.ScholiastJson
import com.scholiast.android.data.model.VideoItem
import com.scholiast.android.data.model.VideoPage
import com.scholiast.android.data.normalize.Normalize

/**
 * Room-backed [PageStore] over the `video_pages` table (Task 02's
 * [VideoPageDao]). Constructor-injected DAO — no AppDatabase dependency, so it
 * is trivially testable against an in-memory Room database, same pattern as
 * `RoomVideoItemRepository`.
 *
 * The row carries the desktop's per-page shards folded together: `itemsJson`
 * (`va:`), `snapJson` (`snap:`), `fileId` + `headRevisionId` (`pagemeta:`).
 * [saveReconciled] always keeps the row (even for zero items) so the sync
 * bookkeeping survives — only the user deleting the page removes it.
 */
class RoomPageStore(private val dao: VideoPageDao) : PageStore {

    override suspend fun load(url: String): PageSnapshot {
        val hash = Normalize.urlHash(Normalize.normalizeUrl(url))
        val row = dao.getEntity(hash)
        return if (row == null) {
            PageSnapshot(
                url = Normalize.normalizeUrl(url),
                videoId = null,
                title = null,
                items = emptyList(),
                snap = null,
                fileId = null,
                headRevisionId = null,
            )
        } else {
            val snap = snapOf(row)
            PageSnapshot(
                url = row.url,
                videoId = row.videoId,
                title = row.title,
                items = itemsOf(row),
                snap = snap,
                fileId = row.fileId,
                headRevisionId = row.headRevisionId,
                highlights = localHighlights(row, snap),
            )
        }
    }

    /**
     * The page's real local highlight list. Rows written before Task 27 made
     * highlights locally owned carry the pristine schema default `'[]'` while
     * their snapshot already holds desktop-synced highlights — for exactly
     * those rows (default marker + non-empty snap) the snapshot seeds the list
     * once, so the first post-update reconcile passes desktop data through
     * instead of tombstoning it. `RoomPageHighlightRepository` writes a
     * distinct empty sentinel (`"[ ]"`), so a deliberate local delete-to-empty
     * is never re-seeded.
     */
    private fun localHighlights(row: VideoPageEntity, snap: VideoPage?): List<PageHighlight> =
        if (row.highlightsJson == "[]" && snap?.highlights?.isNotEmpty() == true) {
            snap.highlights
        } else {
            row.highlights
        }

    /** The row's parsed items (the same conversion [com.scholiast.android.data.db.JsonTypeConverters] applies). */
    private fun itemsOf(row: VideoPageEntity): List<VideoItem> =
        runCatching { ScholiastJson.decode<List<VideoItem>>(row.itemsJson) }.getOrDefault(emptyList())

    /** The row's parsed snapshot, or null when absent/corrupt. */
    private fun snapOf(row: VideoPageEntity): VideoPage? =
        row.snapJson?.let { json -> runCatching { ScholiastJson.decode<VideoPage>(json) }.getOrNull() }

    override suspend fun listAllUrls(): List<String> =
        dao.listAll().map { it.url }

    override suspend fun saveReconciled(url: String, merged: VideoPage, outMeta: DriveFileMeta) {
        val normalized = Normalize.normalizeUrl(url)
        val hash = Normalize.urlHash(normalized)
        val existing = dao.getEntity(hash)
        val entity = (existing ?: VideoPageEntity(
            urlHash = hash,
            url = normalized,
            videoId = null,
            title = null,
            itemsJson = "[]",
            updatedAt = System.currentTimeMillis(),
            snapJson = null,
            fileId = null,
            headRevisionId = null,
        )).copy(
            url = merged.url,
            videoId = merged.videoId,
            title = merged.title,
            itemsJson = ScholiastJson.encode(merged.videoItems),
            // Persist the merged highlight list so the row's local state stays
            // in lockstep with the snapshot (exactly like itemsJson): without
            // this, highlights pulled from the desktop would look "missing
            // locally" on the NEXT reconcile and get tombstoned.
            highlightsJson = ScholiastJson.encode(merged.highlights),
            snapJson = ScholiastJson.encode(merged),
            fileId = outMeta.id,
            headRevisionId = outMeta.headRevisionId,
        )
        dao.upsert(entity)
    }
}