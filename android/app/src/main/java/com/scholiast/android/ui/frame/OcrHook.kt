package com.scholiast.android.ui.frame

import java.io.File

/**
 * The OCR hook (task 14 agent note): called immediately after a frame item
 * saves (plan §5.7.3 — OCR runs at save, async, low priority; only frame paths
 * OCR, never notes/transcript). Task 15 (Gemma) implements this — persisting
 * the returned text is the implementer's job (the app's `ocrText` additive
 * field on the item, or an `OcrTextEntity` row); the frame flow only fires it.
 *
 * @param itemId the saved frame item's id (also the JPEG file name).
 * @param imageFile the JPEG at `filesDir/frames/<itemId>.jpg`.
 * @return the recognized text, or null when nothing was read.
 */
fun interface OcrHook {
    suspend fun run(itemId: String, imageFile: File): String?
}

/** The stub until Task 15 lands: recognizes nothing, throws nothing. */
object NoopOcrHook : OcrHook {
    override suspend fun run(itemId: String, imageFile: File): String? = null
}