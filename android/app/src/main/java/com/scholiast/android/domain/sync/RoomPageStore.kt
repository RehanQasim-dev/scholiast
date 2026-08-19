package com.scholiast.android.domain.sync

import com.scholiast.android.data.db.VideoPageDao
import com.scholiast.android.data.db.VideoPageEntity
import com.scholiast.android.data.model.ScholiastJson
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
        val row = dao.loadPage(hash)
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
            PageSnapshot(
                url = row.url,
                videoId = row.videoId,
                title = row.title,
                items = row.items,
                snap = row.snap,
                fileId = row.fileId,
                headRevisionId = row.headRevisionId,
            )
        }
    }

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
            snapJson = ScholiastJson.encode(merged),
            fileId = outMeta.id,
            headRevisionId = outMeta.headRevisionId,
        )
        dao.upsert(entity)
    }
}