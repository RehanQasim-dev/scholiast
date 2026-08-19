package com.scholiast.android.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters

/**
 * The app's single Room database (`scholiast.db`), schema v1.
 *
 * Tables: `video_pages` (per-page annotation JSON blobs + sync bookkeeping),
 * `ocr_texts` (app-only Gemma OCR), `sync_meta` (tag index + sync status).
 * JSON columns are stored as TEXT and converted via [JsonTypeConverters].
 *
 * The schema is exported (build.gradle.kts: `room.schemaLocation`) to
 * `app/schemas/` — schema v1 is the only version; future schema changes must
 * add a migration there rather than bumping destructively.
 */
@Database(
    entities = [VideoPageEntity::class, OcrTextEntity::class, SyncMetaEntity::class],
    version = 1,
    exportSchema = true,
)
@TypeConverters(JsonTypeConverters::class)
abstract class AppDatabase : RoomDatabase() {

    abstract fun videoPageDao(): VideoPageDao

    abstract fun ocrTextDao(): OcrTextDao

    abstract fun syncMetaDao(): SyncMetaDao

    companion object {
        private const val DB_NAME = "scholiast.db"

        @Volatile
        private var instance: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    DB_NAME,
                ).build().also { instance = it }
            }
    }
}