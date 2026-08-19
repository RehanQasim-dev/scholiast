package com.scholiast.android.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey
import com.scholiast.android.data.model.VideoItem
import com.scholiast.android.data.model.VideoPage

/**
 * One row per video page — the app's mirror of the desktop's per-page sharded
 * storage keys (`va:<url>`, `snap:<url>`, `pagemeta:<url>`) folded into one row:
 *
 * - [itemsJson] — the page's `VideoItem[]` as a JSON blob (the desktop `va:` record,
 *   minus the url/videoId/title columns, which are real columns here).
 * - [snapJson] — the last-reconciled `PageRecord` (the 3-way merge base; desktop
 *   `snap:<url>`).
 * - [fileId] / [headRevisionId] — Drive file metadata for CAS + change detection
 *   (desktop `pagemeta:<url>`).
 * - [updatedAt] — last item mutation (creation counts); drives Home's recent list.
 *
 * `urlHash` is the SHA-256-prefix of the NORMALIZED url (`Normalize.urlHash`),
 * identical to the hash in the Drive file name `pages/page-<urlhash>.json`.
 */
@Entity(tableName = "video_pages")
data class VideoPageEntity(
    @PrimaryKey val urlHash: String,
    val url: String,
    val videoId: String?,
    val title: String?,
    val itemsJson: String,
    val updatedAt: Long,
    val snapJson: String?,
    val fileId: String?,
    val headRevisionId: String?,
)

/**
 * A page row with its JSON columns already parsed into DTOs — the result of the
 * DAO's `@Transaction` page-load, so callers never touch raw JSON.
 */
data class LoadedVideoPage(
    val urlHash: String,
    val url: String,
    val videoId: String?,
    val title: String?,
    @ColumnInfo(name = "itemsJson") val items: List<VideoItem>,
    val updatedAt: Long,
    @ColumnInfo(name = "snapJson") val snap: VideoPage?,
    val fileId: String?,
    val headRevisionId: String?,
)