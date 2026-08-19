package com.scholiast.android.data.notes

import com.scholiast.android.data.db.LoadedVideoPage
import com.scholiast.android.data.db.VideoPageEntity
import com.scholiast.android.data.model.VideoItem

/**
 * The single data access contract for video pages and their items. Every consumer
 * (Home, Notes timeline, transcript, frame, sync) talks to this interface, never
 * to Room directly. Semantics mirror `src/utils/video/video-storage.ts`:
 *
 * - Keys are NORMALIZED urls; `urlHash` is the SHA-256-prefix of the normalized
 *   url (same hash the Drive file name `pages/page-<urlhash>.json` uses).
 * - [addItem] stamps `updatedAt` (= now, ms), replaces an existing item with the
 *   same id, keeps items sorted by `videoTime`, and creates the page row if
 *   absent (desktop `upsertVideoItem`).
 * - [updateItem] is the same replace-by-id but no-ops when the page doesn't
 *   exist (desktop `updateVideoItemNotes`).
 * - [deleteItem] removes the page row when the last item goes (desktop
 *   `removePage`). Frame JPEG file deletion is Task 14's `data/frames/` concern.
 * - Page-row `updatedAt` tracks the last item mutation (creation counts), which
 *   drives Home's recent list; opening a page alone does not move it.
 */
interface VideoItemRepository {

    /** Create the page row if absent; backfill videoId/title only when missing
     * (desktop: `if (title && !entry.title)` / `videoId || entry.videoId`). */
    suspend fun upsertPage(url: String, videoId: String?, title: String?): VideoPageEntity

    /** The page with its items and snap record parsed, or null. */
    suspend fun loadPage(url: String): LoadedVideoPage?

    /** Pages ordered by last item mutation, newest first. */
    suspend fun listRecentPages(limit: Int = 50): List<VideoPageEntity>

    /** Every page row, newest first (sync discovery). */
    suspend fun listAllPages(): List<VideoPageEntity>

    /** Insert-or-replace [item] by id; stamps `updatedAt`; returns the stored item. */
    suspend fun addItem(url: String, item: VideoItem): VideoItem

    /** Replace [item] by id (stamps `updatedAt`); null if the page doesn't exist. */
    suspend fun updateItem(url: String, item: VideoItem): VideoItem?

    /** Remove [item] by id; deletes the page row when it was the last item. */
    suspend fun deleteItem(url: String, itemId: String): Boolean

    /** Remove the whole page row (and thereby all of its items). */
    suspend fun deletePage(url: String)
}