package com.scholiast.android.domain.transcript

import com.scholiast.android.data.normalize.Normalize
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveVideoVerificationTest {

    @Test
    fun testUrlParsingAndExtraction() {
        val rawUrl = "https://youtu.be/5j9cDZtLJrE?si=t0Bcy05_ka4iw2Pq"
        val videoId = Normalize.extractVideoId(rawUrl)
        assertEquals("5j9cDZtLJrE", videoId)

        val normalized = Normalize.normalizeUrl(rawUrl)
        assertEquals("https://youtu.be/5j9cDZtLJrE", normalized)

        val hash = Normalize.urlHash(normalized)
        assertTrue(hash.isNotEmpty())
        assertEquals(32, hash.length)

        val fileName = Normalize.pageFileName(normalized)
        assertEquals("page-$hash.json", fileName)
    }

    @Test
    fun testLiveYouTubeTranscriptFetch() = runBlocking {
        val client = TranscriptClient()
        val videoId = "5j9cDZtLJrE"
        println("Fetching transcript for videoId: $videoId")
        val result = client.getTranscript(videoId)
        println("Transcript result: $result")
        when (result) {
            is TranscriptResult.Success -> {
                println("Success! Language: ${result.transcript.languageCode}")
                println("Cues count: ${result.transcript.cues.size}")
                println("Paragraphs count: ${result.transcript.paragraphs.size}")
                if (result.transcript.cues.isNotEmpty()) {
                    println("First cue: ${result.transcript.cues.first()}")
                    println("First paragraph: ${result.transcript.paragraphs.first().text}")
                }
            }
            is TranscriptResult.NoCaptions -> {
                println("Video has no captions available on YouTube.")
            }
            is TranscriptResult.HttpError -> {
                println("HTTP error: ${result.statusCode}")
            }
            is TranscriptResult.NetworkError -> {
                println("Network error: ${result.cause?.message}")
            }
            is TranscriptResult.ParseError -> {
                println("Parse error: ${result.message}, cause: ${result.cause?.message}")
            }
        }
    }
}
