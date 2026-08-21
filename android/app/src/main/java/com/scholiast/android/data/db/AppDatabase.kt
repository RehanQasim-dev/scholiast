package com.scholiast.android.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/**
 * The app's single Room database (`scholiast.db`), schema v2.
 *
 * Tables: `video_pages` (per-page annotation JSON blobs + sync bookkeeping),
 * `ocr_texts` (app-only Gemma OCR), `sync_meta` (tag index + sync status).
 * JSON columns are stored as TEXT and converted via [JsonTypeConverters].
 *
 * The schema is exported (build.gradle.kts: `room.schemaLocation`) to
 * `app/schemas/`; future schema changes must add a migration there rather than
 * bumping destructively.
 *
 * Migrations: [MIGRATION_1_2] — v1→v2 adds the webpage-annotation columns to
 * `video_pages`: `highlightsJson TEXT NOT NULL DEFAULT '[]'` and
 * `readerJson TEXT NULL`. Additive only; existing rows keep their data.
 */
@Database(
    entities = [VideoPageEntity::class, OcrTextEntity::class, SyncMetaEntity::class],
    version = 2,
    exportSchema = true,
)
@TypeConverters(JsonTypeConverters::class)
abstract class AppDatabase : RoomDatabase() {

    abstract fun videoPageDao(): VideoPageDao

    abstract fun ocrTextDao(): OcrTextDao

    abstract fun syncMetaDao(): SyncMetaDao

    companion object {
        private const val DB_NAME = "scholiast.db"

        /** v1→v2: webpage highlights + reader content on `video_pages` (Task 23). */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "ALTER TABLE video_pages ADD COLUMN highlightsJson TEXT NOT NULL DEFAULT '[]'"
                )
                db.execSQL("ALTER TABLE video_pages ADD COLUMN readerJson TEXT")
            }
        }

        @Volatile
        private var instance: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    DB_NAME,
                ).addMigrations(MIGRATION_1_2).build().also { instance = it }
            }
    }
}