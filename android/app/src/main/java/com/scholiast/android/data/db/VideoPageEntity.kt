package com.scholiast.android.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey
import com.scholiast.android.data.model.LinearArticle
import com.scholiast.android.data.model.PageHighlight
import com.scholiast.android.data.model.ScholiastJson
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
 * - [highlightsJson] / [readerJson] — webpage-annotation data (Task 23): the
 *   page's `PageHighlight[]` and its extracted `LinearArticle` reader content,
 *   each as a JSON blob (schema v2, added by [AppDatabase.MIGRATION_1_2]).
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
    @ColumnInfo(name = "highlightsJson", defaultValue = "[]")
    val highlightsJson: String = "[]",
    val readerJson: String? = null,
) {
    /** The page's highlights, parsed from [highlightsJson]. */
    val highlights: List<PageHighlight>
        get() = ScholiastJson.decode(highlightsJson)

    /** The page's reader article, parsed from [readerJson] (null when never extracted). */
    val reader: LinearArticle?
        get() = readerJson?.let { ScholiastJson.decode(it) }
}

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
    @ColumnInfo(name = "highlightsJson") val highlights: List<PageHighlight> = emptyList(),
    @ColumnInfo(name = "readerJson") val reader: LinearArticle? = null,
)