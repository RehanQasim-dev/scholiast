package com.scholiast.android.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

/**
 * CRUD for [VideoPageEntity]. All writes replace whole rows (the page record is
 * the unit of consistency, like the desktop's per-page sharded storage).
 */
@Dao
interface VideoPageDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: VideoPageEntity)

    @Query("SELECT * FROM video_pages WHERE urlHash = :urlHash")
    suspend fun getEntity(urlHash: String): VideoPageEntity?

    /** Page-load that returns the row with JSON columns parsed into DTOs. */
    @Transaction
    @Query("SELECT * FROM video_pages WHERE urlHash = :urlHash")
    suspend fun loadPage(urlHash: String): LoadedVideoPage?

    @Query("SELECT * FROM video_pages ORDER BY updatedAt DESC LIMIT :limit")
    suspend fun listRecent(limit: Int): List<VideoPageEntity>

    @Query("SELECT * FROM video_pages")
    suspend fun listAll(): List<VideoPageEntity>

    /**
     * Observable feed of rows carrying webpage annotations (Task 23/27): a
     * highlight list or reader content. Room re-emits on any `video_pages`
     * write; the repository maps/drops rows (e.g. the empty-list sentinel
     * `"[]"` with a space matches this predicate but has zero highlights).
     */
    @Query("SELECT * FROM video_pages WHERE highlightsJson != '[]' OR readerJson IS NOT NULL ORDER BY updatedAt DESC")
    fun observePagesWithHighlights(): Flow<List<VideoPageEntity>>

    @Query("DELETE FROM video_pages WHERE urlHash = :urlHash")
    suspend fun delete(urlHash: String)

    @Query("DELETE FROM video_pages")
    suspend fun deleteAll()

    @Query("UPDATE video_pages SET updatedAt = :updatedAt WHERE urlHash = :urlHash")
    suspend fun touch(urlHash: String, updatedAt: Long)

    @Query(
        "UPDATE video_pages SET snapJson = :snapJson, fileId = :fileId, " +
            "headRevisionId = :headRevisionId WHERE urlHash = :urlHash"
    )
    suspend fun updateSyncMeta(urlHash: String, snapJson: String?, fileId: String?, headRevisionId: String?)
}