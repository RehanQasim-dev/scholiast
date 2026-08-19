package com.scholiast.android.data.model

import kotlinx.serialization.Serializable

/**
 * Per-entity tombstones of a page record: entityId -> deletedAt (ms). Mirrors
 * `PageTombstones` in `shared/merge.ts` byte-for-byte. The merge's correctness
 * rests on these, never on the record's presence.
 */
@Serializable
data class PageTombstones(
    val highlights: Map<String, Long> = emptyMap(),
    val drawings: Map<String, Long> = emptyMap(),
    val comments: Map<String, Long> = emptyMap(),
    val videoItems: Map<String, Long> = emptyMap(),
    val diagrams: Map<String, Long> = emptyMap(),
)

/**
 * One page's full annotation record — the exact JSON stored per normalized URL in
 * the Drive appdata layout as `pages/page-<urlhash>.json`. Mirrors `PageRecord`
 * in `shared/merge.ts` byte-for-byte (`version: 2`), and is what the app's sync
 * engine assembles from the Room stores, reconciles with a 3-way merge, and
 * uploads. `typealias [PageRecord]` is provided for the sync task.
 *
 * Image/scene BYTES never live here: video frames carry only `frame.driveId`,
 * diagrams only `driveId`/`sceneDriveId` pointers.
 */
@Serializable
data class VideoPage(
    val version: Int,
    val url: String,
    val title: String? = null,
    val videoId: String? = null,
    val highlights: List<PageHighlight> = emptyList(),
    val drawings: List<PageStroke> = emptyList(),
    val videoItems: List<VideoItem> = emptyList(),
    val diagrams: List<PageDiagram> = emptyList(),
    val tombstones: PageTombstones = PageTombstones(),
    // Set by the sync layer when the page has no live entities, so a peer can
    // drop it; merge correctness rests on the per-entity tombstones, not this flag.
    val deletedAt: Long? = null,
) {
    companion object {
        /** Mirrors the TS `emptyPageRecord(url)`. */
        fun empty(url: String): VideoPage = VideoPage(
            version = 2,
            url = url,
            highlights = emptyList(),
            drawings = emptyList(),
            videoItems = emptyList(),
            diagrams = emptyList(),
            tombstones = PageTombstones(),
        )
    }
}

/** The TS name for [VideoPage], for code that ports `shared/merge.ts` verbatim. */
typealias PageRecord = VideoPage