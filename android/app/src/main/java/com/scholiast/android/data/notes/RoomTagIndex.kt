package com.scholiast.android.data.notes

import com.scholiast.android.data.db.SyncMetaDao
import com.scholiast.android.data.db.SyncMetaEntity
import com.scholiast.android.data.model.ScholiastJson

/**
 * Room-backed [TagIndex] stored in the `sync_meta` table under key `tag_index`
 * (value = JSON string array). Mirrors the desktop's `tag_index` key: tags
 * without the `#` prefix, sorted, union-only on write so a concurrent save can't
 * drop a tag.
 */
class RoomTagIndex(
    private val syncMetaDao: SyncMetaDao,
) : TagIndex {

    override suspend fun addTags(tags: Collection<String>) {
        val clean = tags
            .mapNotNull { it.trim().removePrefix("#").takeIf { t -> t.isNotEmpty() } }
            .toSet()
        if (clean.isEmpty()) return
        val existing = read()
        val merged = (existing + clean).sorted()
        if (merged == existing) return
        syncMetaDao.put(
            SyncMetaEntity(
                key = TAG_INDEX_KEY,
                value = ScholiastJson.encode(merged),
                updatedAt = System.currentTimeMillis(),
            )
        )
    }

    override suspend fun suggest(prefix: String, limit: Int): List<String> {
        val p = prefix.trim().removePrefix("#")
        return read().filter { it.startsWith(p, ignoreCase = true) }.take(limit)
    }

    override suspend fun allTags(): List<String> = read()

    private suspend fun read(): List<String> {
        val meta = syncMetaDao.get(TAG_INDEX_KEY) ?: return emptyList()
        return runCatching { ScholiastJson.decode<List<String>>(meta.value) }
            .getOrDefault(emptyList())
    }

    private companion object {
        const val TAG_INDEX_KEY = "tag_index"
    }
}