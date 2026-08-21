package com.scholiast.android.data.notes

import android.content.Context
import androidx.room.Room
import com.scholiast.android.data.db.AppDatabase
import com.scholiast.android.data.model.LinearArticle
import com.scholiast.android.data.model.PageHighlight
import com.scholiast.android.data.normalize.Normalize
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * [RoomPageHighlightRepository] against an in-memory Room database: upsert
 * newest-wins (+ timestamp stamping), delete, replaceAll, and the
 * `pagesWithHighlights` mapping (title fallback, domain, count, recency,
 * emptied rows excluded).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RoomPageHighlightRepositoryTest {

    private lateinit var db: AppDatabase
    private lateinit var repo: RoomPageHighlightRepository

    @Before
    fun setUp() {
        val context: Context = RuntimeEnvironment.getApplication()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        repo = RoomPageHighlightRepository(db.videoPageDao())
    }

    @After
    fun tearDown() {
        db.close()
    }

    private fun hl(id: String, updatedAt: Long?, color: String? = "yellow") =
        PageHighlight(id = id, updatedAt = updatedAt, notes = emptyList(), color = color)

    private fun hash(url: String) = Normalize.urlHash(Normalize.normalizeUrl(url))

    @Test
    fun `upsert is newest-wins and stamps a missing updatedAt`() = runBlocking {
        val url = "https://example.com/article"
        repo.upsert(url, hl("hl1", 500L))

        // Older incoming edit loses to the stored newer one.
        repo.upsert(url, PageHighlight(id = "hl1", updatedAt = 400L, color = "red"))
        assertEquals(500L, repo.highlights(url).single().updatedAt)

        // Equal-or-newer incoming wins; a missing timestamp gets stamped now.
        val before = System.currentTimeMillis()
        repo.upsert(url, PageHighlight(id = "hl1", color = "green"))
        val stored = repo.highlights(url).single()
        assertEquals("green", stored.color)
        assertTrue("stamped with now: ${stored.updatedAt}", stored.updatedAt!! >= before)

        // A second highlight appends instead of replacing.
        repo.upsert(url, hl("hl2", 10L))
        assertEquals(listOf("hl1", "hl2"), repo.highlights(url).map { it.id })
    }

    @Test
    fun `delete removes only the target id`() = runBlocking {
        val url = "https://example.com/article"
        repo.upsert(url, hl("hl1", 5L))
        repo.upsert(url, hl("hl2", 6L))
        repo.upsert(url, hl("hl3", 7L))

        repo.delete(url, "hl2")

        assertEquals(listOf("hl1", "hl3"), repo.highlights(url).map { it.id })
    }

    @Test
    fun `replaceAll overwrites the stored list`() = runBlocking {
        val url = "https://example.com/article"
        repo.upsert(url, hl("old", 5L))

        repo.replaceAll(url, listOf(hl("a", 1L), hl("b", 2L)))

        assertEquals(listOf("a", "b"), repo.highlights(url).map { it.id })
    }

    @Test
    fun `pagesWithHighlights maps title domain count and recency`() = runBlocking {
        // Page A: two highlights; its ROW title wins over any reader fallback.
        val urlA = "https://Example.com/docs/a"
        val keyA = hash(urlA)
        repo.upsert(urlA, hl("a1", 100L))
        repo.upsert(urlA, hl("a2", 101L))
        db.videoPageDao().upsert(db.videoPageDao().getEntity(keyA)!!.copy(title = "Row Title"))
        val rowA = db.videoPageDao().getEntity(keyA)!!

        // Page B: reader-only — title falls back to the reader article's.
        repo.saveReaderArticle(
            LinearArticle(url = "https://b.com/x", title = "Reader Title", fetchedAt = 1L),
        )

        val items = repo.pagesWithHighlights().first().associateBy { it.url }

        val a = items["https://example.com/docs/a"]!!
        assertEquals("Row Title", a.title)
        assertEquals(2, a.highlightCount)
        assertEquals("example.com", a.domain)
        assertEquals(rowA.updatedAt, a.lastOpenedAt)

        val b = items["https://b.com/x"]!!
        assertEquals("Reader Title", b.title)
        assertEquals(0, b.highlightCount)
        assertEquals("b.com", b.domain)

        // Deleting a page's last highlight drops it from the list entirely.
        repo.delete(urlA, "a1")
        repo.delete(urlA, "a2")
        val after = repo.pagesWithHighlights().first().map { it.url }
        assertTrue("emptied page excluded: $after", "https://example.com/docs/a" !in after)
    }
}
