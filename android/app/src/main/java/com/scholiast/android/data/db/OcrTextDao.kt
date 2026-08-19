package com.scholiast.android.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

/** CRUD for [OcrTextEntity] (owned by Task 15's OCR pipeline). */
@Dao
interface OcrTextDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(ocr: OcrTextEntity)

    @Query("SELECT * FROM ocr_texts WHERE itemId = :itemId")
    suspend fun get(itemId: String): OcrTextEntity?

    @Query("SELECT * FROM ocr_texts WHERE itemId IN (:itemIds)")
    suspend fun getMany(itemIds: List<String>): List<OcrTextEntity>

    @Query("DELETE FROM ocr_texts WHERE itemId = :itemId")
    suspend fun delete(itemId: String)

    @Query("DELETE FROM ocr_texts")
    suspend fun deleteAll()

    @Query("SELECT * FROM ocr_texts ORDER BY createdAt DESC")
    suspend fun listAll(): List<OcrTextEntity>
}