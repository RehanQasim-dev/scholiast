package com.scholiast.android.data.db

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * OCR text extracted from a frame item (Gemma, app-only feature — the desktop
 * has no OCR). One row per video item id; the text lands asynchronously at
 * frame-comment save, so the row may lag the item. `source` names the OCR
 * provider/model ("gemma" in v1). See plan §5.7.3.
 */
@Entity(tableName = "ocr_texts")
data class OcrTextEntity(
    @PrimaryKey val itemId: String,
    val text: String,
    val source: String,
    val createdAt: Long,
)