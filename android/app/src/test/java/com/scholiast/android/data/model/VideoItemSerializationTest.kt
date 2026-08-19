package com.scholiast.android.data.model

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Task 02 acceptance contract: a [VideoItem] serializes to the EXACT JSON the
 * desktop's `src/utils/video/video-storage.ts` produces. Expected strings below
 * mirror what `JSON.stringify` emits for the same shapes (integral doubles as
 * integers, optional fields omitted, `notes: []` always present, TS field order).
 */
class VideoItemSerializationTest {

    // --- Fixtures -------------------------------------------------------------

    /** A frame item with full markup (all four shape lists) and a drive blob id. */
    private fun frameItem(): VideoItem = VideoItem(
        id = "lq7x2abcde",
        kind = "frame",
        videoTime = 124.5,
        frame = FrameImage(driveId = "1AbCdrXyZ0123456789", w = 1280, h = 720),
        markup = VideoMarkup(
            strokes = listOf(Stroke("s1", "yellow", listOf(0.1, 0.2, 0.3, 0.4, 0.5, 0.6), "thin")),
            lines = listOf(Line("l1", "red", 0.0, 0.0, 1.0, 1.0)),
            texts = listOf(TextLabel("t1", "green", 0.25, 0.5, 0.28, 1.5, "Maxwell's equations")),
            rects = listOf(Rect("r1", "black", 0.1, 0.1, 0.2, 0.3, "thick")),
            arrows = listOf(Arrow("a1", "yellow", 0.1, 0.2, 0.8, 0.9, "medium")),
        ),
        notes = listOf("The divergence theorem applies here<!--timestamp:1712345678901-->"),
        updatedAt = 1712345678901,
    )

    /** A transcript highlight with its cue anchor and an edited comment. */
    private fun transcriptItem(): VideoItem = VideoItem(
        id = "mn8x3fghij",
        kind = "transcript",
        videoTime = 268.0,
        notes = listOf("Key point to remember<!--timestamp:1712345679000--><!--edited:1712345679999-->"),
        updatedAt = 1712345679999,
        timeEnd = 271.5,
        quote = "The gradient flows backward through the residual connection.",
        color = "yellow",
        anchor = TranscriptAnchor(3, 0, 3, 54),
    )

    /** A plain timestamped note with a two-comment thread. */
    private fun noteItem(): VideoItem = VideoItem(
        id = "op9x4jklmn",
        kind = "note",
        videoTime = 512.0,
        notes = listOf(
            "First pass at the proof<!--timestamp:1712345679100-->",
            "Second thought: the base case fails<!--timestamp:1712345679200--><!--edited:1712345679300-->",
        ),
        updatedAt = 1712345679300,
    )

    // --- Exact-string serialization (TS byte-compat) --------------------------

    @Test
    fun `frame item serializes to the exact TS JSON`() {
        val expected = """
            {"id":"lq7x2abcde","kind":"frame","videoTime":124.5,"frame":{"driveId":"1AbCdrXyZ0123456789","w":1280,"h":720},"markup":{"strokes":[{"id":"s1","color":"yellow","points":[0.1,0.2,0.3,0.4,0.5,0.6],"weight":"thin"}],"lines":[{"id":"l1","color":"red","x1":0,"y1":0,"x2":1,"y2":1}],"texts":[{"id":"t1","color":"green","x":0.25,"y":0.5,"w":0.28,"size":1.5,"text":"Maxwell's equations"}],"rects":[{"id":"r1","color":"black","x":0.1,"y":0.1,"w":0.2,"h":0.3,"weight":"thick"}],"arrows":[{"id":"a1","color":"yellow","x1":0.1,"y1":0.2,"x2":0.8,"y2":0.9,"weight":"medium"}]},"notes":["The divergence theorem applies here<!--timestamp:1712345678901-->"],"updatedAt":1712345678901}
        """.trimIndent()
        assertEquals(expected, ScholiastJson.encode(frameItem()))
    }

    @Test
    fun `transcript item serializes to the exact TS JSON`() {
        val expected = """
            {"id":"mn8x3fghij","kind":"transcript","videoTime":268,"notes":["Key point to remember<!--timestamp:1712345679000--><!--edited:1712345679999-->"],"updatedAt":1712345679999,"timeEnd":271.5,"quote":"The gradient flows backward through the residual connection.","color":"yellow","anchor":{"startCue":3,"startOffset":0,"endCue":3,"endOffset":54}}
        """.trimIndent()
        assertEquals(expected, ScholiastJson.encode(transcriptItem()))
    }

    @Test
    fun `note item serializes to the exact TS JSON`() {
        val expected = """
            {"id":"op9x4jklmn","kind":"note","videoTime":512,"notes":["First pass at the proof<!--timestamp:1712345679100-->","Second thought: the base case fails<!--timestamp:1712345679200--><!--edited:1712345679300-->"],"updatedAt":1712345679300}
        """.trimIndent()
        assertEquals(expected, ScholiastJson.encode(noteItem()))
    }

    @Test
    fun `minimal item emits notes array but omits every optional field`() {
        val item = VideoItem(id = "mi1", kind = "note", videoTime = 0.0)
        assertEquals(
            """{"id":"mi1","kind":"note","videoTime":0,"notes":[]}""",
            ScholiastJson.encode(item),
        )
    }

    // --- Round-trips ----------------------------------------------------------

    @Test
    fun `encode-decode round-trips all three fixtures`() {
        for (item in listOf(frameItem(), transcriptItem(), noteItem())) {
            assertEquals(item, ScholiastJson.decode<VideoItem>(ScholiastJson.encode(item)))
        }
    }

    @Test
    fun `decodes a TS-ordered JSON object regardless of key order`() {
        // Keys in desktop-interface order (frame dataUrl present, extras present) —
        // parse-equality must hold even though the string differs from our output.
        val tsJson = """
            {"id":"x9","kind":"frame","videoTime":10,"frame":{"dataUrl":"data:image/jpeg;base64,abc","driveId":"1D","w":640,"h":360},"markup":{"strokes":[],"lines":[],"texts":[]},"notes":[],"updatedAt":1712345678901,"excalidrawScene":{"elements":[],"appState":{}},"futureField":42}
        """.trimIndent()
        val item = ScholiastJson.decode<VideoItem>(tsJson)
        assertEquals("x9", item.id)
        assertEquals(10.0, item.videoTime, 0.0)
        assertEquals("data:image/jpeg;base64,abc", item.frame?.dataUrl)
        assertEquals("1D", item.frame?.driveId)
        assertEquals(640, item.frame?.w)
        assertEquals(360, item.frame?.h)
        assertEquals(1712345678901L, item.updatedAt)
        assertEquals("""{"elements":[],"appState":{}}""", item.excalidrawScene.toString())
        assertNull(item.ocrText)
    }

    @Test
    fun `unknown fields are ignored on read and dropped on write`() {
        val item = ScholiastJson.decode<VideoItem>(
            """{"id":"u1","kind":"note","videoTime":1.5,"notes":[],"someNewField":true}"""
        )
        assertFalse(ScholiastJson.encode(item).contains("someNewField"))
    }

    @Test
    fun `ocrText is additive - absent in desktop JSON, round-trips when set`() {
        val desktop = """{"id":"o1","kind":"frame","videoTime":1.5,"notes":[]}"""
        assertNull(ScholiastJson.decode<VideoItem>(desktop).ocrText)

        val withOcr = ScholiastJson.decode<VideoItem>(desktop).copy(ocrText = "E = mc^2")
        val json = ScholiastJson.encode(withOcr)
        assertTrue(json.contains("\"ocrText\":\"E = mc^2\""))
        assertEquals("E = mc^2", ScholiastJson.decode<VideoItem>(json).ocrText)
    }

    @Test
    fun `excalidrawScene is preserved verbatim as JsonElement`() {
        val scene = buildJsonObject {
            put("elements", JsonArray(emptyList()))
            put("appState", buildJsonObject { put("zoom", JsonPrimitive(1)) })
        }
        val item = VideoItem(id = "e1", kind = "frame", videoTime = 2.5, excalidrawScene = scene)
        val json = ScholiastJson.encode(item)
        assertTrue(json.contains("\"excalidrawScene\":{\"elements\":[],\"appState\":{\"zoom\":1}}"))
        val decoded = ScholiastJson.decode<VideoItem>(json)
        assertEquals(scene, decoded.excalidrawScene)
    }

    @Test
    fun `emptyMarkup mirrors the TS emptyMarkup shape`() {
        val markup = VideoMarkup.empty()
        assertEquals(
            """{"strokes":[],"lines":[],"texts":[],"rects":[],"arrows":[]}""",
            ScholiastJson.encode(markup),
        )
    }
}