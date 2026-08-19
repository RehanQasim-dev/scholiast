package com.scholiast.android.domain.sync.merge

import com.scholiast.android.data.normalize.Normalize

/**
 * Drive filename for a page's record. A normalized URL isn't a safe filename, so
 * we hash it (SHA-256 prefix) — the real url lives inside the record. The name
 * must be identical to the one the desktop extension and the Obsidian plugin
 * compute (`shared/merge.ts:pageFileName`), or the app would read/write a
 * different file. Task 03's `Normalize.pageFileName` is the canonical
 * implementation; this is the sync-layer name for the port.
 */
object PageFileName {
    fun of(url: String): String = Normalize.pageFileName(url)

    /** Full Drive appdata path: `pages/page-<urlhash>.json`. */
    fun path(url: String): String = Normalize.pageFilePath(url)
}