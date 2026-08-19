package com.scholiast.android.data.notes

import com.scholiast.android.data.db.LoadedVideoPage
import com.scholiast.android.data.db.VideoPageDao
import com.scholiast.android.data.db.VideoPageEntity
import com.scholiast.android.data.model.ScholiastJson
import com.scholiast.android.data.model.VideoItem
import com.scholiast.android.data.normalize.Normalize

/**
 * Room-backed [VideoItemRepository]. Constructor-injected DAOs (no AppDatabase
 * dependency) so it is trivially testable against an in-memory Room database.
 *
 * Read-modify-write page mutations are intentionally NOT wrapped in
 * `db.withTransaction`: the DAO layer serializes writes at the SQL level and the
 * interleave window between read and write is microseconds. If the sync worker
 * ever shows lost updates, wrap these in a Room transaction (see LOG.md).
 */
class RoomVideoItemRepository(
    private val videoPageDao: VideoPageDao,
) : VideoItemRepository {

    private fun keyAndHash(url: String): Pair<String, String> {
        val key = Normalize.normalizeUrl(url)
        return key to Normalize.urlHash(key)
    }

    override suspend fun upsertPage(url: String, videoId: String?, title: String?): VideoPageEntity {
        val (key, hash) = keyAndHash(url)
        val existing = videoPageDao.getEntity(hash)
        if (existing != null) {
            val newVideoId = videoId ?: existing.videoId
            val newTitle = if (title != null && existing.title == null) title else existing.title
            if (newVideoId != existing.videoId || newTitle != existing.title) {
                val updated = existing.copy(videoId = newVideoId, title = newTitle)
                videoPageDao.upsert(updated)
                return updated
            }
            return existing
        }
        val entity = VideoPageEntity(
            urlHash = hash,
            url = key,
            videoId = videoId,
            title = title,
            itemsJson = "[]",
            updatedAt = System.currentTimeMillis(),
            snapJson = null,
            fileId = null,
            headRevisionId = null,
        )
        videoPageDao.upsert(entity)
        return entity
    }

    override suspend fun loadPage(url: String): LoadedVideoPage? {
        val (_, hash) = keyAndHash(url)
        return videoPageDao.loadPage(hash)
    }

    override suspend fun listRecentPages(limit: Int): List<VideoPageEntity> =
        videoPageDao.listRecent(limit)

    override suspend fun listAllPages(): List<VideoPageEntity> =
        videoPageDao.listAll()

    override suspend fun addItem(url: String, item: VideoItem): VideoItem {
        val (key, hash) = keyAndHash(url)
        val now = System.currentTimeMillis()
        val stamped = item.copy(updatedAt = now)
        val existing = videoPageDao.getEntity(hash)
        if (existing == null) {
            videoPageDao.upsert(
                VideoPageEntity(
                    urlHash = hash,
                    url = key,
                    videoId = null,
                    title = null,
                    itemsJson = "[]",
                    updatedAt = now,
                    snapJson = null,
                    fileId = null,
                    headRevisionId = null,
                )
            )
        }
        val items = ScholiastJson.decode<List<VideoItem>>(videoPageDao.getEntity(hash)!!.itemsJson)
            .toMutableList()
        val idx = items.indexOfFirst { it.id == stamped.id }
        if (idx >= 0) items[idx] = stamped else items.add(stamped)
        items.sortBy { it.videoTime }
        videoPageDao.upsert(
            videoPageDao.getEntity(hash)!!.copy(
                itemsJson = ScholiastJson.encode(items),
                updatedAt = now,
            )
        )
        return stamped
    }

    override suspend fun updateItem(url: String, item: VideoItem): VideoItem? {
        val (_, hash) = keyAndHash(url)
        val entity = videoPageDao.getEntity(hash) ?: return null
        val now = System.currentTimeMillis()
        val stamped = item.copy(updatedAt = now)
        val items = ScholiastJson.decode<List<VideoItem>>(entity.itemsJson)
            .map { if (it.id == stamped.id) stamped else it }
        videoPageDao.upsert(
            entity.copy(
                itemsJson = ScholiastJson.encode(items),
                updatedAt = now,
            )
        )
        return stamped
    }

    override suspend fun deleteItem(url: String, itemId: String): Boolean {
        val (_, hash) = keyAndHash(url)
        val entity = videoPageDao.getEntity(hash) ?: return false
        val items = ScholiastJson.decode<List<VideoItem>>(entity.itemsJson)
            .filterNot { it.id == itemId }
        if (items.isEmpty()) {
            videoPageDao.delete(hash)
        } else {
            videoPageDao.upsert(
                entity.copy(
                    itemsJson = ScholiastJson.encode(items),
                    updatedAt = System.currentTimeMillis(),
                )
            )
        }
        return true
    }

    override suspend fun deletePage(url: String) {
        val (_, hash) = keyAndHash(url)
        videoPageDao.delete(hash)
    }
}