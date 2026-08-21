package com.scholiast.android.data.db

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import com.scholiast.android.data.model.PageHighlight
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File

/**
 * Schema v1→v2 ([AppDatabase.MIGRATION_1_2]): builds a real v1 `scholiast.db`
 * from the exported schema JSON (`schemas/…/1.json`), seeds a row, then opens it
 * through Room with the migration registered — Room validates the migrated
 * schema against its generated v2 expectation on open, so a wrong migration
 * fails here. Asserts the seeded row survives intact with backfilled columns,
 * that the parsed accessors work through the DAO, and that post-migration rows
 * pick up the `highlightsJson` default.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class VideoPagesMigrationTest {

    private fun createV1Database(dbFile: File) {
        val schema = Json.parseToJsonElement(
            File("schemas/com.scholiast.android.data.db.AppDatabase/1.json").readText()
        ).jsonObject
        val database = schema["database"]!!.jsonObject

        val db = SQLiteDatabase.openOrCreateDatabase(dbFile, null)
        db.use {
            // The exported JSON predates the app's tables: recreate them exactly,
            // stamp the old user_version so Room takes the migration path…
            db.execSQL("PRAGMA user_version = 1")
            for (entity in database["entities"]!!.jsonArray) {
                val obj = entity.jsonObject
                val tableName = obj["tableName"]!!.jsonPrimitive.content
                db.execSQL(obj["createSql"]!!.jsonPrimitive.content.replace("\${TABLE_NAME}", tableName))
                for (index in obj["indices"]?.jsonArray ?: emptyList()) {
                    db.execSQL(
                        index.jsonObject["createSql"]!!.jsonPrimitive.content
                            .replace("\${TABLE_NAME}", tableName)
                    )
                }
            }
            // …and seed one v1 row (9 columns; no highlights/reader yet).
            db.execSQL(
                "INSERT INTO video_pages " +
                    "(urlHash,url,videoId,title,itemsJson,updatedAt,snapJson,fileId,headRevisionId) " +
                    "VALUES ('hash1','https://example.com/watch?v=1','vid1','A lecture'," +
                    "'[{\"id\":\"vi1\",\"kind\":\"note\",\"videoTime\":10,\"notes\":[],\"updatedAt\":5}]'," +
                    "1712345678901,'{\"version\":2,\"url\":\"https://example.com/watch?v=1\"," +
                    "\"highlights\":[],\"drawings\":[],\"videoItems\":[],\"diagrams\":[]," +
                    "\"tombstones\":{\"highlights\":{},\"drawings\":{},\"comments\":{},\"videoItems\":{},\"diagrams\":{}}}'," +
                    "'f1','r1')"
            )
        }
    }

    @Test
    fun `v1 rows survive migration to v2 with columns backfilled`() {
        val context: Context = RuntimeEnvironment.getApplication()
        val dbName = "scholiast-migration-test.db"
        createV1Database(context.getDatabasePath(dbName))

        val room = Room.databaseBuilder(context, AppDatabase::class.java, dbName)
            .addMigrations(AppDatabase.MIGRATION_1_2)
            .allowMainThreadQueries()
            .build()
        try {
            // Opening + this query run MIGRATION_1_2 and Room's schema validation;
            // a broken migration throws before any assertion below.
            val page = runBlocking { room.videoPageDao().loadPage("hash1") }

            assertTrue(page != null)
            assertEquals(listOf("vi1"), page!!.items.map { it.id })
            assertEquals("A lecture", page.title)
            // New columns are backfilled and parse cleanly through the accessors.
            assertEquals(emptyList<PageHighlight>(), page.highlights)
            assertNull(page.reader)

            // Post-migration insert without the new columns picks up the default.
            runBlocking {
                room.videoPageDao().upsert(
                    VideoPageEntity(
                        urlHash = "hash2",
                        url = "https://example.com/two",
                        videoId = null,
                        title = null,
                        itemsJson = "[]",
                        updatedAt = 42L,
                        snapJson = null,
                        fileId = null,
                        headRevisionId = null,
                    )
                )
                val second = room.videoPageDao().loadPage("hash2")!!
                assertEquals(emptyList<PageHighlight>(), second.highlights)
                assertNull(second.reader)
            }
        } finally {
            room.close()
        }
    }
}
