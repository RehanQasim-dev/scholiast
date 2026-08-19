package com.scholiast.android.domain.ocr

import com.scholiast.android.data.db.OcrTextDao
import com.scholiast.android.data.db.OcrTextEntity
import com.scholiast.android.data.model.VideoItem
import com.scholiast.android.data.notes.VideoItemRepository

/**
 * Persists recognized OCR text in both places Task 02's model expects:
 * 1. `VideoItem.ocrText` — via [VideoItemRepository.updateItem] (stamps
 *    `updatedAt`, so the text rides the page JSON into Drive sync and renders
 *    on the frame card; the desktop ignores the additive field).
 * 2. `OcrTextEntity` (Room `ocr_texts`, `source = "gemma"`) — the fast
 *    itemId→text lookup Task 20's flashcards and the frame card use.
 *
 * ## Resolving the page for an item
 * Task 14's [OcrHook] signature carries only `itemId` + the JPEG — no page
 * url — so [findItem] scans `listAllPages` → `loadPage` for the item. That is
 * O(pages) reads, but OCR runs once, asynchronously, at low priority, right
 * after a save; the page is almost always the most-recently-touched one.
 *
 * A store that lands on a deleted item (or page) is a silent no-op returning
 * false — the OCR text for a removed frame is garbage anyway.
 */
class OcrStorage(
    private val repository: VideoItemRepository,
    private val ocrTextDao: OcrTextDao,
    private val clock: () -> Long = System::currentTimeMillis,
) {

    /**
     * Store [text] on the item with id [itemId]: update the item's `ocrText`
     * and upsert the [OcrTextEntity]. False when the item no longer exists.
     */
    suspend fun store(itemId: String, text: String): Boolean {
        val (url, item) = findItem(itemId) ?: return false
        if (repository.updateItem(url, item.copy(ocrText = text)) == null) return false
        ocrTextDao.upsert(OcrTextEntity(itemId = itemId, text = text, source = SOURCE_GEMMA, createdAt = clock()))
        return true
    }

    /** The page url + item for [itemId], or null when the item is gone. */
    suspend fun findItem(itemId: String): Pair<String, VideoItem>? {
        for (page in repository.listAllPages()) {
            val loaded = repository.loadPage(page.url) ?: continue
            val item = loaded.items.firstOrNull { it.id == itemId } ?: continue
            return page.url to item
        }
        return null
    }

    companion object {
        /** The `source` stamped on every row (plan §5.7.3: "gemma" in v1). */
        const val SOURCE_GEMMA: String = "gemma"
    }
}