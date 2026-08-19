package com.scholiast.android.domain.transcript

import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Fixture-driven tests for the transcript data layer (JVM, no Android deps).
 * MockWebServer serves the innertube `/player` endpoint and the caption track
 * `baseUrl`; the fixture responses mirror the captured YouTube shapes (see
 * LOG.md for the exact request/response shapes).
 */
class TranscriptClientTest {

    // --- Fixtures -------------------------------------------------------------

    /** Realistic `&fmt=json3` payload: two `aAppend` events (indexes 1 and 5)
     * accumulate into events 0 and 4; indexes 1/5 never become cues. */
    private val JSON3_FIXTURE = """
        {
          "wireMagic": "pb3",
          "pens": [{"w": 0, "a": 1, "f": 6}],
          "wsWinStyles": [{"fo": true, "pc": 6710886, "ms": 6710886}],
          "wpWinPositions": [{"ap": 168, "ah": 34}],
          "events": [
            {"tStartMs": 0, "dDurationMs": 2680, "segs": [{"utf8": "Welcome back to lecture "}, {"tOffsetMs": 900, "acAsrConf": 0.91, "utf8": "twelve."}]},
            {"aAppend": 0, "segs": [{"utf8": " Today we cover "}, {"utf8": "transformer architectures."}]},
            {"tStartMs": 2680, "dDurationMs": 2210, "segs": [{"utf8": "First, the attention mechanism."}]},
            {"tStartMs": 4890, "dDurationMs": 1900, "segs": [{"utf8": "Every token gets a query, key, and value."}]},
            {"tStartMs": 6790, "dDurationMs": 2130, "segs": [{"utf8": "Now let's talk about training stability."}]},
            {"aAppend": 4, "segs": [{"utf8": " It matters a lot in practice."}]},
            {"tStartMs": 8920, "dDurationMs": 1750, "segs": [{"utf8": "Gradients can vanish without care."}]},
            {"tStartMs": 10670, "dDurationMs": 2030, "segs": [{"utf8": "So we add residual connections."}]}
          ]
        }
    """.trimIndent()

    /** Player response shape: `captions.playerCaptionsTracklistRenderer.captionTracks[]`. */
    private fun playerResponseFixture(captionBaseUrl: String, tracks: String): String = """
        {
          "responseContext": {"serviceTrackingParams": [{"service": "GFEEDBACK", "sc": "SERVICE_GFEEDBACK"}]},
          "playabilityStatus": {"status": "OK", "playableInEmbed": true},
          "videoDetails": {"videoId": "dQw4w9WgXcQ", "title": "Test lecture", "lengthSeconds": "1270"},
          "captions": {
            "playerCaptionsTracklistRenderer": {
              "captionTracks": $tracks,
              "audioTracks": [{"captionTrackIndices": [0, 1, 2, 3]}]
            }
          }
        }
    """.trimIndent()

    private fun tracksFixture(baseUrl: String): String = """
        [
          {"baseUrl": "$baseUrl&lang=es&name=Spanish", "languageCode": "es", "kind": "asr", "name": {"simpleText": "Spanish (auto-generated)"}},
          {"baseUrl": "$baseUrl&lang=en&name=English", "languageCode": "en", "kind": "asr", "name": {"simpleText": "English (auto-generated)"}},
          {"baseUrl": "$baseUrl&lang=en-orig&name=English-original", "languageCode": "en", "name": {"simpleText": "English (original)"}},
          {"baseUrl": "$baseUrl&lang=fr&name=French", "languageCode": "fr", "name": {"simpleText": "Français"}}
        ]
    """.trimIndent()

    private fun tracks(): List<CaptionTrack> = listOf(
        CaptionTrack("es", "Spanish (auto-generated)", "https://youtube.com/api/timedtext&lang=es", isAsr = true),
        CaptionTrack("en", "English (auto-generated)", "https://youtube.com/api/timedtext&lang=en", isAsr = true),
        CaptionTrack("en", "English (original)", "https://youtube.com/api/timedtext&lang=en-orig", isAsr = false),
        CaptionTrack("fr", "Français", "https://youtube.com/api/timedtext&lang=fr", isAsr = false),
    )

    // --- JSON3 cue parsing -----------------------------------------------------

    @Test
    fun `parseJson3 handles aAppend events without creating spurious cues`() {
        val cues = CueParser.parseJson3(JSON3_FIXTURE)

        assertEquals(6, cues.size)
        // Index = position of the tStartMs event in the events array (1 and 5 are appends).
        assertEquals(listOf(0, 2, 3, 4, 6, 7), cues.map { it.index })

        // aAppend text accumulated into the previous cue, trimmed.
        assertEquals("Welcome back to lecture twelve. Today we cover transformer architectures.", cues[0].text)
        assertEquals("Now let's talk about training stability. It matters a lot in practice.", cues[3].text)

        // start/end from tStartMs + dDurationMs.
        assertEquals(0L, cues[0].startMs)
        assertEquals(2680L, cues[0].endMs)
        assertEquals(2680L, cues[1].startMs)
        assertEquals(4890L, cues[1].endMs)
        assertEquals(10670L, cues[5].startMs)
        assertEquals(12700L, cues[5].endMs)
    }

    @Test
    fun `parseJson3 with no events returns empty`() {
        assertTrue(CueParser.parseJson3("""{"wireMagic": "pb3", "events": []}""").isEmpty())
        assertTrue(CueParser.parseJson3("""{"wireMagic": "pb3"}""").isEmpty())
    }

    @Test
    fun `parseJson3 with malformed json throws ParseException`() {
        val e = try {
            CueParser.parseJson3("{oops not json")
            null
        } catch (e: Exception) {
            e
        }
        assertTrue(e is CueParser.ParseException)
    }

    // --- XML fallback (parseCuesXml port) ---------------------------------------

    @Test
    fun `parseXml srv3 format`() {
        val xml = """
            <?xml version="1.0" encoding="utf-8" ?>
            <transcript>
              <p t="0" d="2680"><s>Welcome back </s><s>to lecture </s><s>twelve.</s></p>
              <p t="2680" d="2210"><s>First, the attention mechanism.</s></p>
              <p t="4890"><s>No duration attribute here.</s></p>
            </transcript>
        """.trimIndent()
        val cues = CueParser.parseXml(xml)
        assertEquals(3, cues.size)
        assertEquals(0, cues[0].index)
        assertEquals("Welcome back to lecture twelve.", cues[0].text)
        assertEquals(0L, cues[0].startMs)
        assertEquals(2680L, cues[0].endMs)
        assertEquals("First, the attention mechanism.", cues[1].text)
        assertEquals(4890L, cues[2].startMs)
        assertEquals(4890L, cues[2].endMs) // no dur → end == start
    }

    @Test
    fun `parseXml text format with entity decoding`() {
        val xml = """
            <?xml version="1.0" encoding="utf-8" ?>
            <transcript>
              <text start="0" dur="2.68">Welcome &amp; thanks, it&#39;s great</text>
              <text start="2.68" dur="2.21">Second line</text>
            </transcript>
        """.trimIndent()
        val cues = CueParser.parseXml(xml)
        assertEquals(2, cues.size)
        assertEquals("Welcome & thanks, it's great", cues[0].text)
        assertEquals(0L, cues[0].startMs)
        assertEquals(2680L, cues[0].endMs)
        assertEquals(2680L, cues[1].startMs)
        assertEquals(4890L, cues[1].endMs)
    }

    @Test
    fun `parse auto-detects xml vs json3`() {
        assertTrue(CueParser.parse("<transcript></transcript>").isEmpty())
        assertEquals(6, CueParser.parse(JSON3_FIXTURE).size)
    }

    // --- Chunking (semanticChunk port) -------------------------------------------

    @Test
    fun `semanticChunk matches TS behavior on the json3 fixture`() {
        val cues = CueParser.parseJson3(JSON3_FIXTURE)
        val paragraphs = TranscriptChunker.semanticChunk(cues)

        // Every cue ends a sentence → one paragraph per cue, in order.
        assertEquals(6, paragraphs.size)
        assertEquals(listOf(0, 2, 3, 4, 6, 7), paragraphs.map { it.cueRange.first })
        assertEquals(listOf(0, 2, 3, 4, 6, 7), paragraphs.map { it.cueRange.last })
        assertEquals(0L, paragraphs[0].startMs)
        assertEquals(2680L, paragraphs[0].endMs)
        assertEquals("Welcome back to lecture twelve. Today we cover transformer architectures.", paragraphs[0].text)
        assertEquals("So we add residual connections.", paragraphs[5].text)
    }

    @Test
    fun `semanticChunk flushes on a long gap between consecutive cue starts`() {
        val cues = listOf(
            TranscriptCue(0, 0L, 3000L, "Opening sentence."),
            TranscriptCue(1, 5000L, 7000L, "second cue"),
            TranscriptCue(2, 26000L, 28000L, "after a long pause"), // gap 21s > 20s
            TranscriptCue(3, 30000L, 32000L, "tail"),
        )
        val paragraphs = TranscriptChunker.semanticChunk(cues)
        assertEquals(3, paragraphs.size)
        assertEquals("Opening sentence.", paragraphs[0].text)
        assertEquals("second cue", paragraphs[1].text)
        assertEquals("after a long pause tail", paragraphs[2].text)
        assertEquals(26000L, paragraphs[2].startMs)
        assertEquals(32000L, paragraphs[2].endMs)
        assertEquals(2..3, paragraphs[2].cueRange)
    }

    @Test
    fun `semanticChunk flushes an unpunctuated run at 30 seconds`() {
        val cues = listOf(
            TranscriptCue(0, 0L, 5000L, "alpha"),
            TranscriptCue(1, 10000L, 15000L, "beta"),
            TranscriptCue(2, 20000L, 25000L, "gamma"),
            TranscriptCue(3, 31000L, 36000L, "delta"), // 31s from para start → flush
            TranscriptCue(4, 41000L, 46000L, "epsilon"),
        )
        val paragraphs = TranscriptChunker.semanticChunk(cues)
        assertEquals(2, paragraphs.size)
        // The 30 s rule flushes AFTER pushing the triggering cue (TS behavior):
        // delta belongs to the flushed paragraph.
        assertEquals("alpha beta gamma delta", paragraphs[0].text)
        assertEquals(0..3, paragraphs[0].cueRange)
        assertEquals(36000L, paragraphs[0].endMs) // end = the triggering cue's end
        assertEquals("epsilon", paragraphs[1].text)
        assertEquals(4..4, paragraphs[1].cueRange)
        assertEquals(41000L, paragraphs[1].startMs)
        assertEquals(46000L, paragraphs[1].endMs)
    }

    @Test
    fun `splitOnInternalSentences splits a two-sentence cue`() {
        val cues = listOf(
            TranscriptCue(0, 0L, 2680L, "Welcome back to lecture twelve. Today we cover transformer architectures."),
            TranscriptCue(2, 2680L, 4890L, "First, the attention mechanism."),
        )
        val split = TranscriptChunker.splitOnInternalSentences(cues)
        assertEquals(3, split.size)
        assertEquals("Welcome back to lecture twelve.", split[0].text)
        assertEquals("Today we cover transformer architectures.", split[1].text)
        // Both halves keep the original cue's timing.
        assertEquals(0L, split[0].startMs)
        assertEquals(0L, split[1].startMs)
        assertEquals(2680L, split[1].endMs)
        // Unsplit cues keep their text and renumber sequentially.
        assertEquals("First, the attention mechanism.", split[2].text)
        assertEquals(2, split[2].index)
    }

    // --- pickTrack priority ------------------------------------------------------

    @Test
    fun `pickTrack prefers the session language`() {
        val track = TranscriptClient.pickTrack(tracks(), "fr")
        assertEquals("fr", track?.languageCode)
        // ASR is NOT deprioritized for an exact preference match (desktop behavior).
        val es = TranscriptClient.pickTrack(tracks(), "es")
        assertEquals("es", es?.languageCode)
        assertTrue(es!!.isAsr)
    }

    @Test
    fun `pickTrack falls back to English non-ASR`() {
        // "de" has no exact match → English, non-ASR preferred over ASR.
        val track = TranscriptClient.pickTrack(tracks(), "de")
        assertEquals("en", track?.languageCode)
        assertTrue(!track!!.isAsr)
        assertEquals("English (original)", track.name)

        // No preference at all → same.
        val noPref = TranscriptClient.pickTrack(tracks(), null)
        assertEquals("en", noPref?.languageCode)
        assertTrue(!noPref!!.isAsr)
    }

    @Test
    fun `pickTrack falls back to first non-ASR when no English`() {
        val noEnglish = listOf(
            CaptionTrack("es", "Spanish", "u", isAsr = true),
            CaptionTrack("fr", "Français", "u", isAsr = false),
        )
        val track = TranscriptClient.pickTrack(noEnglish, null)
        assertEquals("fr", track?.languageCode)
    }

    @Test
    fun `pickTrack falls back to first track when everything is ASR`() {
        val allAsr = listOf(
            CaptionTrack("es", "Spanish", "u", isAsr = true),
            CaptionTrack("en", "English", "u", isAsr = true),
        )
        // English (even ASR) beats the first track — desktop behavior.
        val track = TranscriptClient.pickTrack(allAsr, null)
        assertEquals("en", track?.languageCode)
    }

    @Test
    fun `pickTrack returns null for an empty list`() {
        assertNull(TranscriptClient.pickTrack(emptyList(), null))
    }

    // --- Innertube client (MockWebServer) ----------------------------------------

    @Test
    fun `getTranscript happy path fetches player then json3 captions`() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val captionUrl = server.url("/api/timedtext").toString()
            val client = TranscriptClient(
                okHttp = OkHttpClient(),
                playerEndpoint = server.url("/youtubei/v1/player?prettyPrint=false").toString(),
            )
            server.enqueue(MockResponse().setBody(playerResponseFixture(captionUrl, tracksFixture(captionUrl))))
            server.enqueue(MockResponse().setBody(JSON3_FIXTURE))

            val result = client.getTranscript("dQw4w9WgXcQ")

            val loaded = (result as? TranscriptResult.Success)?.transcript
            assertNotNull("expected Success, got $result", loaded)
            assertEquals(4, loaded!!.tracks.size)
            assertEquals("en", loaded.languageCode)
            assertEquals(6, loaded.cues.size)
            // The client runs the full chunk() pipeline (internal-sentence split
            // + semanticChunk), so the two two-sentence cues split → 8 paragraphs.
            assertEquals(8, loaded.paragraphs.size)
            assertEquals("Welcome back to lecture twelve.", loaded.paragraphs[0].text)
            assertEquals("Today we cover transformer architectures.", loaded.paragraphs[1].text)
            assertEquals("It matters a lot in practice.", loaded.paragraphs[5].text)
            assertEquals("So we add residual connections.", loaded.paragraphs[7].text)

            // Player request carries the IOS context.
            val playerReq = server.takeRequest()
            assertEquals("/youtubei/v1/player", playerReq.path?.substringBefore("?"))
            assertTrue(playerReq.body.readUtf8().contains("\"clientName\":\"IOS\""))
            // Caption request appends fmt=json3 to the picked track's baseUrl.
            val captionReq = server.takeRequest()
            assertTrue(captionReq.path!!.contains("fmt=json3"))
            assertTrue(captionReq.path!!.contains("lang=en-orig"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `getTranscript falls back IOS to WEB when IOS has no captions`() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val captionUrl = server.url("/api/timedtext").toString()
            val client = TranscriptClient(
                okHttp = OkHttpClient(),
                playerEndpoint = server.url("/youtubei/v1/player").toString(),
            )
            server.enqueue(MockResponse().setBody("""{"playabilityStatus": {"status": "OK"}}"""))       // IOS: no captions
            server.enqueue(MockResponse().setBody(playerResponseFixture(captionUrl, tracksFixture(captionUrl)))) // WEB: captions
            server.enqueue(MockResponse().setBody(JSON3_FIXTURE))

            val result = client.getTranscript("dQw4w9WgXcQ")

            assertTrue("expected Success, got $result", result is TranscriptResult.Success)
            val iosReq = server.takeRequest()
            assertTrue(iosReq.body.readUtf8().contains("\"IOS\""))
            val webReq = server.takeRequest()
            assertTrue(webReq.body.readUtf8().contains("\"WEB\""))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `getTranscript returns NoCaptions when no track exists`() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val client = TranscriptClient(
                okHttp = OkHttpClient(),
                playerEndpoint = server.url("/youtubei/v1/player").toString(),
            )
            server.enqueue(MockResponse().setBody("""{"playabilityStatus": {"status": "OK"}}""")) // IOS: none
            server.enqueue(MockResponse().setBody("""{"playabilityStatus": {"status": "OK"}}""")) // WEB: none

            val result = client.getTranscript("dQw4w9WgXcQ")

            assertEquals(TranscriptResult.NoCaptions, result)
            assertEquals(2, server.requestCount) // no caption fetch attempted
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `getTranscript surfaces HttpError 404 from the player endpoint`() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val client = TranscriptClient(
                okHttp = OkHttpClient(),
                playerEndpoint = server.url("/youtubei/v1/player").toString(),
            )
            server.enqueue(MockResponse().setResponseCode(404).setBody("Not Found"))

            val result = client.getTranscript("dQw4w9WgXcQ")

            assertEquals(TranscriptResult.HttpError(404), result)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `getTranscript surfaces HttpError 404 from the caption fetch`() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val captionUrl = server.url("/api/timedtext").toString()
            val client = TranscriptClient(
                okHttp = OkHttpClient(),
                playerEndpoint = server.url("/youtubei/v1/player").toString(),
            )
            server.enqueue(MockResponse().setBody(playerResponseFixture(captionUrl, tracksFixture(captionUrl))))
            server.enqueue(MockResponse().setResponseCode(404).setBody("Not Found"))

            val result = client.getTranscript("dQw4w9WgXcQ")

            assertEquals(TranscriptResult.HttpError(404), result)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `getTranscript surfaces ParseError on a malformed caption body`() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val captionUrl = server.url("/api/timedtext").toString()
            val client = TranscriptClient(
                okHttp = OkHttpClient(),
                playerEndpoint = server.url("/youtubei/v1/player").toString(),
            )
            server.enqueue(MockResponse().setBody(playerResponseFixture(captionUrl, tracksFixture(captionUrl))))
            server.enqueue(MockResponse().setBody("{oops not json"))

            val result = client.getTranscript("dQw4w9WgXcQ")

            assertTrue("expected ParseError, got $result", result is TranscriptResult.ParseError)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `getTranscript surfaces NetworkError when the endpoint is unreachable`() = runBlocking {
        val server = MockWebServer()
        server.start()
        val deadPort = server.port
        server.shutdown() // connection refused

        val client = TranscriptClient(
            okHttp = OkHttpClient(),
            playerEndpoint = "http://127.0.0.1:$deadPort/player",
        )
        val result = client.getTranscript("dQw4w9WgXcQ")

        assertTrue("expected NetworkError, got $result", result is TranscriptResult.NetworkError)
    }

    @Test
    fun `setSessionLanguage drives the default track choice and caches per language`() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val captionUrl = server.url("/api/timedtext").toString()
            val client = TranscriptClient(
                okHttp = OkHttpClient(),
                playerEndpoint = server.url("/youtubei/v1/player").toString(),
            )
            client.setSessionLanguage("dQw4w9WgXcQ", "fr")
            server.enqueue(MockResponse().setBody(playerResponseFixture(captionUrl, tracksFixture(captionUrl))))
            server.enqueue(MockResponse().setBody(JSON3_FIXTURE))

            val result = client.getTranscript("dQw4w9WgXcQ") // no explicit lang → session pref

            val loaded = (result as? TranscriptResult.Success)?.transcript
            assertEquals("fr", loaded?.languageCode)
            server.takeRequest() // player request
            val captionReq = server.takeRequest()
            assertTrue(captionReq.path!!.contains("lang=fr"))
            assertTrue(captionReq.path!!.contains("fmt=json3"))

            // Second call (no new enqueue) must come from the cache.
            val again = client.getTranscript("dQw4w9WgXcQ", "fr")
            assertTrue(again is TranscriptResult.Success)
            assertEquals(2, server.requestCount)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `fetchTracks exposes the full track list for the language picker`() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val captionUrl = server.url("/api/timedtext").toString()
            val client = TranscriptClient(
                okHttp = OkHttpClient(),
                playerEndpoint = server.url("/youtubei/v1/player").toString(),
            )
            server.enqueue(MockResponse().setBody(playerResponseFixture(captionUrl, tracksFixture(captionUrl))))

            val tracks = client.fetchTracks("dQw4w9WgXcQ")

            assertEquals(4, tracks?.size)
            assertEquals(listOf("es", "en", "en", "fr"), tracks?.map { it.languageCode })
            assertEquals(listOf(true, true, false, false), tracks?.map { it.isAsr })
        } finally {
            server.shutdown()
        }
    }
}