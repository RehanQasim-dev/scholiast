package com.scholiast.android.domain.sync

import com.scholiast.android.data.model.PageHighlight
import com.scholiast.android.data.model.VideoItem
import com.scholiast.android.data.model.VideoPage

/**
 * The sync engine's view of one page's local state, folded into a single row:
 *
 * - [items] — the page's `VideoItem[]` (the desktop `va:<url>` shard).
 * - [highlights] — the page's REAL local `PageHighlight[]` (the desktop
 *   `hl:<url>` shard, Task 27): locally owned, not seeded from the snapshot.
 *   Kept in lockstep with the last reconcile by [PageStore.saveReconciled],
 *   which persists the merged highlight list back into the row.
 * - [snap] — the last-reconciled `PageRecord`, the 3-way merge base (desktop
 *   `snap:<url>`).
 * - [fileId] / [headRevisionId] — Drive file metadata for CAS + change
 *   detection (desktop `pagemeta:<url>`).
 */
data class PageSnapshot(
    val url: String,
    val videoId: String?,
    val title: String?,
    val items: List<VideoItem>,
    val snap: VideoPage?,
    val fileId: String?,
    val headRevisionId: String?,
    val highlights: List<PageHighlight> = emptyList(),
)

/**
 * The per-page local store the engine reads and writes. Implemented by
 * [RoomPageStore] over the Room `video_pages` table; tests use an in-memory
 * fake. The row survives even with zero items so snap/pagemeta bookkeeping
 * outlives the annotations (mirrors the desktop, where `snap:`/`pagemeta:`
 * keys outlive an emptied `va:` shard).
 */
interface PageStore {

    /** The page's snapshot, or an empty one when no row exists yet. */
    suspend fun load(url: String): PageSnapshot

    /** Every page url known locally (discovery for the full reconcile). */
    suspend fun listAllUrls(): List<String>

    /**
     * Write a reconciled record: items, title/videoId, and the bookkeeping
     * (`snap` = merged record, `fileId`/`headRevisionId` = out-going Drive
     * metadata). Creates the row when absent; preserves its `updatedAt`
     * (recency is driven by user edits, not sync pulls).
     */
    suspend fun saveReconciled(url: String, merged: VideoPage, outMeta: DriveFileMeta)
}