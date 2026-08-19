package com.scholiast.android.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction

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