package com.scholiast.android.data.model

import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * PageRecord (`VideoPage`) compatibility with `shared/merge.ts`: the exact empty
 * record shape, parse of a merge-shaped fixture with unknown highlight/stroke
 * fields, tombstone round-trips, and — critically — preservation of unknown
 * fields through a Kotlin round-trip (the desktop's `[k: string]: unknown`).
 */
class VideoPageSerializationTest {

    @Test
    fun `empty page record serializes to the exact TS shape`() {
        val expected = """
            {"version":2,"url":"https://example.com","highlights":[],"drawings":[],"videoItems":[],"diagrams":[],"tombstones":{"highlights":{},"drawings":{},"comments":{},"videoItems":{},"diagrams":{}}}
        """.trimIndent()
        assertEquals(expected, ScholiastJson.encode(VideoPage.empty("https://example.com")))
        assertEquals(expected, ScholiastJson.encode(PageRecord.empty("https://example.com")))
    }

    @Test
    fun `parses a merge-shaped record with desktop highlight and stroke fields`() {
        val tsJson = """
            {"version":2,"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","title":"A lecture","videoId":"dQw4w9WgXcQ","highlights":[{"id":"hl1","updatedAt":1712345678901,"notes":["n1<!--timestamp:1712345600000-->"],"color":"yellow","xpath":"/div[1]","groupId":"g1"}],"drawings":[{"id":"dr1","updatedAt":1712345678901,"color":"yellow","width":3,"points":[0.1,0.2]}],"videoItems":[{"id":"vi1","kind":"transcript","videoTime":268,"notes":[],"updatedAt":1712345679999,"timeEnd":271.5,"quote":"The gradient flows backward.","color":"green","anchor":{"startCue":3,"startOffset":0,"endCue":3,"endOffset":54}}],"diagrams":[{"id":"dg1","updatedAt":1712345678000,"driveId":"1Dg","sceneDriveId":"1Sc"}],"tombstones":{"highlights":{"hl1":1712345600000},"drawings":{},"comments":{"hl1:1712345600000":1712345670000},"videoItems":{},"diagrams":{}}}
        """.trimIndent()

        val page = ScholiastJson.decode<VideoPage>(tsJson)

        assertEquals(2, page.version)
        assertEquals("https://www.youtube.com/watch?v=dQw4w9WgXcQ", page.url)
        assertEquals("A lecture", page.title)
        assertEquals("dQw4w9WgXcQ", page.videoId)

        val hl = page.highlights.single()
        assertEquals("hl1", hl.id)
        assertEquals(1712345678901L, hl.updatedAt)
        assertEquals(listOf("n1<!--timestamp:1712345600000-->"), hl.notes)
        assertEquals("yellow", hl.color)
        // The desktop's extra highlight fields must survive:
        assertEquals("""{"xpath":"/div[1]","groupId":"g1"}""", hl.extras.toString())

        val stroke = page.drawings.single()
        assertEquals("dr1", stroke.id)
        assertEquals(1712345678901L, stroke.updatedAt)
        assertEquals("""{"color":"yellow","width":3,"points":[0.1,0.2]}""", stroke.extras.toString())

        val item = page.videoItems.single()
        assertEquals("vi1", item.id)
        assertEquals("transcript", item.kind)
        assertEquals(268.0, item.videoTime, 0.0)
        assertEquals(271.5, item.timeEnd!!, 0.0)
        assertEquals(TranscriptAnchor(3, 0, 3, 54), item.anchor)

        val diagram = page.diagrams.single()
        assertEquals("dg1", diagram.id)
        assertEquals("1Dg", diagram.driveId)
        assertEquals("1Sc", diagram.sceneDriveId)

        assertEquals(mapOf("hl1" to 1712345600000L), page.tombstones.highlights)
        assertEquals(mapOf("hl1:1712345600000" to 1712345670000L), page.tombstones.comments)
        assertNull(page.deletedAt)
    }

    @Test
    fun `unknown fields survive a Kotlin round-trip (parse-equality)`() {
        val tsJson = """
            {"version":2,"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","highlights":[{"type":"text","id":"hl1","xpath":"/div[1]/p[2]","startOffset":3,"endOffset":10,"content":"some words","notes":[],"color":"red","groupId":"g7","updatedAt":1712345678901,"anchor":{"quote":"some words","surface":"web"}}],"drawings":[{"id":"dr1","updatedAt":1712345678901,"color":"blue","width":4,"points":[0.1,0.2,0.3,0.4]}],"videoItems":[],"diagrams":[],"tombstones":{"highlights":{},"drawings":{},"comments":{},"videoItems":{},"diagrams":{}}}
        """.trimIndent()

        val decoded = ScholiastJson.decode<VideoPage>(tsJson)
        val reencoded = ScholiastJson.encode(decoded)

        // Key-order may differ (known fields first, extras after), so compare parsed.
        val expected = ScholiastJson.json.parseToJsonElement(tsJson)
        val actual = ScholiastJson.json.parseToJsonElement(reencoded)
        assertEquals(expected, actual)

        // And the extras really did ride along on the typed object:
        assertEquals("text", decoded.highlights.single().extras["type"]?.jsonPrimitive?.content)
        assertEquals("web", decoded.highlights.single().extras["anchor"]?.jsonObject?.get("surface")?.jsonPrimitive?.content)
        assertEquals(4, decoded.drawings.single().extras["width"]?.jsonPrimitive?.content?.toInt())
    }

    @Test
    fun `deletedAt round-trips when set and is omitted when absent`() {
        assertNull(ScholiastJson.decode<VideoPage>(
            """{"version":2,"url":"u","highlights":[],"drawings":[],"videoItems":[],"diagrams":[],"tombstones":{"highlights":{},"drawings":{},"comments":{},"videoItems":{},"diagrams":{}}}"""
        ).deletedAt)

        val withFlag = VideoPage.empty("u").copy(deletedAt = 1712345678000L)
        val json = ScholiastJson.encode(withFlag)
        assertTrue(json.contains("\"deletedAt\":1712345678000"))
        assertEquals(1712345678000L, ScholiastJson.decode<VideoPage>(json).deletedAt)
    }
}