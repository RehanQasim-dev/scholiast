package com.scholiast.android.domain.transcribe

import com.scholiast.android.domain.transcribe.TranscriptionError.INVALID_REQUEST
import com.scholiast.android.domain.transcribe.TranscriptionError.NETWORK
import com.scholiast.android.domain.transcribe.TranscriptionError.NOT_CONFIGURED
import com.scholiast.android.domain.transcribe.TranscriptionError.RATE_LIMITED
import com.scholiast.android.domain.transcribe.TranscriptionError.SERVER
import com.scholiast.android.domain.transcribe.TranscriptionError.UNAUTHORIZED
import com.scholiast.android.domain.transcribe.TranscriptionError.UNKNOWN
import com.scholiast.android.ui.voice.WavWriter
import java.io.File
import java.util.Base64
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * MockWebServer tests for the Groq + Gemini transcribers and the
 * [TranscriberRegistry] selection (task.md acceptance: Groq happy path,
 * Gemini inline-audio request shape, error mapping). JVM-only — no Android
 * deps anywhere in the transcriber layer.
 */
class TranscriberTest {

    private lateinit var server: MockWebServer
    private val json = Json { ignoreUnknownKeys = true }

    /** A tiny 16 kHz mono WAV written by Task 09's [WavWriter]. */
    private fun wavFile(bytes: FloatArray = floatArrayOf(0f, 0.25f, -0.5f, 0.75f, -0.125f)): File {
        val f = File.createTempFile("transcriber-test", ".wav")
        f.deleteOnExit()
        WavWriter.write(bytes, f)
        return f
    }

    private fun settings(configure: DefaultSpeechSettings.() -> Unit = {}): DefaultSpeechSettings =
        DefaultSpeechSettings().apply(configure)

    private fun groq(s: SpeechSettings, endpoint: String = server.url("/v1/audio/transcriptions").toString()) =
        GroqTranscriber(s, OkHttpClient(), endpoint)

    private fun gemini(s: SpeechSettings, maxInline: Long = GeminiTranscriber.MAX_INLINE_BYTES) =
        GeminiTranscriber(
            settings = s,
            okHttp = OkHttpClient(),
            baseUrl = server.url("/").toString().removeSuffix("/"),
            uploadUrl = server.url("/").toString().removeSuffix("/"),
            maxInlineBytes = maxInline,
        )

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    // --- Groq: happy path -----------------------------------------------------

    @Test
    fun `groq transcribes a wav to text via multipart upload`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"text":"Hello world"}"""))
        val s = settings { setKey(Service.GROQ, "groq-key-123") }

        val result = groq(s).transcribe(AudioSource.WavFile(wavFile()), "en")

        val ok = result as? TranscriptionResult.Success
        assertNotNull("expected Success, got $result", ok)
        assertEquals("Hello world", ok!!.text)
        assertEquals(TranscriberSource.GROQ, ok.source)

        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/v1/audio/transcriptions", req.path)
        assertEquals("Bearer groq-key-123", req.getHeader("Authorization"))
        val body = String(req.body.readByteArray(), Charsets.ISO_8859_1)
        assertTrue("multipart carries the model", body.contains("whisper-large-v3-turbo"))
        assertTrue("multipart carries the language", body.contains("name=\"language\""))
        assertTrue(body.contains("en"))
        assertTrue("multipart requests verbose_json for timestamps", body.contains("verbose_json"))
        assertTrue("multipart carries the wav bytes", body.contains("RIFF"))
    }

    @Test
    fun `groq omits language when none is configured`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"text":"hi"}"""))
        val s = settings { setKey(Service.GROQ, "groq-key-123") }

        groq(s).transcribe(AudioSource.WavFile(wavFile()), null)

        val body = server.takeRequest().body.readUtf8()
        assertTrue("no language part when language is null", !body.contains("name=\"language\""))
    }

    @Test
    fun `groq parses verbose_json segments into timestamps`() = runBlocking {
        server.enqueue(
            MockResponse().setBody(
                """
                {
                  "text": "welcome to the lecture",
                  "segments": [
                    {"id": 0, "start": 0.0, "end": 0.84, "text": " welcome"},
                    {"id": 1, "start": 0.84, "end": 1.30, "text": " to the"},
                    {"id": 2, "start": 1.30, "end": 2.10, "text": " lecture"}
                  ]
                }
                """.trimIndent(),
            ),
        )
        val s = settings { setKey(Service.GROQ, "groq-key-123") }

        val result = groq(s).transcribe(AudioSource.WavFile(wavFile()), null)

        val ok = result as? TranscriptionResult.Success
        assertEquals("welcome to the lecture", ok?.text)
        val ts = ok!!.timestamps
        assertNotNull(ts)
        assertEquals(3, ts!!.size)
        assertEquals(WordTimestamp(0, 840, "welcome"), ts[0])
        assertEquals(WordTimestamp(840, 1300, "to the"), ts[1])
        assertEquals(WordTimestamp(1300, 2100, "lecture"), ts[2])
    }

    @Test
    fun `groq converts float samples to a temp wav and cleans up`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"text":"samples transcribed"}"""))
        val s = settings { setKey(Service.GROQ, "groq-key-123") }
        val samples = FloatArray(3200) { ((it % 100) / 100f) - 0.5f }

        val result = groq(s).transcribe(AudioSource.FloatSamples(samples), null)

        val ok = result as? TranscriptionResult.Success
        assertEquals("samples transcribed", ok?.text)
        assertTrue(
            String(server.takeRequest().body.readByteArray(), Charsets.ISO_8859_1).contains("RIFF"),
        )
    }

    // --- Groq: error mapping ----------------------------------------------------

    @Test
    fun `groq maps 401 to unauthorized`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":{"message":"Invalid API key"}}"""))
        val s = settings { setKey(Service.GROQ, "bad-key") }

        val result = groq(s).transcribe(AudioSource.WavFile(wavFile()), null)

        assertFailure(result, UNAUTHORIZED, "Invalid API key")
    }

    @Test
    fun `groq maps 429 to rate limited`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(429)
                .setBody("""{"error":{"message":"Rate limit reached: 20 per 1 minute"}}"""),
        )
        val s = settings { setKey(Service.GROQ, "groq-key-123") }

        val result = groq(s).transcribe(AudioSource.WavFile(wavFile()), null)

        assertFailure(result, RATE_LIMITED, "Rate limit reached: 20 per 1 minute")
    }

    @Test
    fun `groq maps 500 to server error`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(503).setBody("""{"error":{"message":"temporarily unavailable"}}"""))
        val s = settings { setKey(Service.GROQ, "groq-key-123") }

        val result = groq(s).transcribe(AudioSource.WavFile(wavFile()), null)

        assertFailure(result, SERVER, "temporarily unavailable")
    }

    @Test
    fun `groq maps a non-openai error body to a generic message`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(400).setBody("plain text error"))
        val s = settings { setKey(Service.GROQ, "groq-key-123") }

        val result = groq(s).transcribe(AudioSource.WavFile(wavFile()), null)

        assertTrue(result is TranscriptionResult.Failure)
        val f = result as TranscriptionResult.Failure
        assertEquals(INVALID_REQUEST, f.error)
        assertTrue(f.message.contains("400"))
    }

    @Test
    fun `groq maps connection failure to network error`() = runBlocking {
        val deadPort = server.port
        server.shutdown() // connection refused
        val s = settings { setKey(Service.GROQ, "groq-key-123") }

        val result = GroqTranscriber(
            s, OkHttpClient(), "http://127.0.0.1:$deadPort/v1/audio/transcriptions",
        ).transcribe(AudioSource.WavFile(wavFile()), null)

        assertTrue("expected NETWORK, got $result", (result as? TranscriptionResult.Failure)?.error == NETWORK)
    }

    @Test
    fun `groq without a key is not configured and makes no request`() = runBlocking {
        val result = groq(settings()).transcribe(AudioSource.WavFile(wavFile()), null)

        assertTrue(result is TranscriptionResult.Failure)
        assertEquals(NOT_CONFIGURED, (result as TranscriptionResult.Failure).error)
        assertEquals(0, server.requestCount)
    }

    // --- Gemini: inline audio -----------------------------------------------

    @Test
    fun `gemini sends inline wav base64 plus the prompt`() = runBlocking {
        server.enqueue(geminiCandidates("A concise note from speech"))
        val wav = wavFile()
        val s = settings {
            setKey(Service.GEMINI, "gemini-key-456")
            // default add-comment prompt is used by transcribe()
        }

        val result = gemini(s).transcribe(AudioSource.WavFile(wav), null)

        val ok = result as? TranscriptionResult.Success
        assertNotNull("expected Success, got $result", ok)
        assertEquals("A concise note from speech", ok!!.text)
        assertEquals(TranscriberSource.GEMINI, ok.source)

        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/v1beta/models/gemini-3.6-flash:generateContent", req.path?.substringBefore("?"))
        assertEquals("gemini-key-456", req.path?.substringAfter("key="))

        val body = json.parseToJsonElement(req.body.readUtf8()) as JsonObject
        val parts = parts(body)
        val inline = (parts[0] as JsonObject)["inlineData"] as JsonObject
        assertEquals("audio/wav", inline["mimeType"]!!.jsonPrimitive.content)
        val decoded = Base64.getDecoder().decode(inline["data"]!!.jsonPrimitive.content)
        assertEquals(wav.readBytes().toList(), decoded.toList())
        val prompt = (parts[1] as JsonObject)["text"]!!.jsonPrimitive.content
        assertEquals(SpeechSettings.DEFAULT_ADD_COMMENT_PROMPT, prompt)
    }

    @Test
    fun `gemini transcribeWithPrompt uses the given prompt for the edit flow`() = runBlocking {
        server.enqueue(geminiCandidates("Make it concise: revised"))
        val s = settings { setKey(Service.GEMINI, "gemini-key-456") }

        val result = gemini(s).transcribeWithPrompt(AudioSource.WavFile(wavFile()), "Make this more concise")

        val ok = result as? TranscriptionResult.Success
        assertEquals("Make it concise: revised", ok?.text)
        val body = json.parseToJsonElement(server.takeRequest().body.readUtf8()) as JsonObject
        val parts = parts(body)
        assertEquals("Make this more concise", (parts[1] as JsonObject)["text"]!!.jsonPrimitive.content)
    }

    @Test
    fun `gemini maps 401 to unauthorized`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":{"code":401,"message":"API key not valid"}}"""))
        val s = settings { setKey(Service.GEMINI, "bad-key") }

        val result = gemini(s).transcribe(AudioSource.WavFile(wavFile()), null)

        assertFailure(result, UNAUTHORIZED, "API key not valid")
    }

    @Test
    fun `gemini maps 429 to rate limited`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(429)
                .setBody("""{"error":{"code":429,"message":"Quota exceeded","status":"RESOURCE_EXHAUSTED"}}"""),
        )
        val s = settings { setKey(Service.GEMINI, "gemini-key-456") }

        val result = gemini(s).transcribe(AudioSource.WavFile(wavFile()), null)

        assertFailure(result, RATE_LIMITED, "Quota exceeded")
    }

    @Test
    fun `gemini with empty candidates returns unknown error`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"candidates":[],"promptFeedback":{"blockReason":"SAFETY"}}"""))
        val s = settings { setKey(Service.GEMINI, "gemini-key-456") }

        val result = gemini(s).transcribe(AudioSource.WavFile(wavFile()), null)

        assertTrue(result is TranscriptionResult.Failure)
        assertEquals(UNKNOWN, (result as TranscriptionResult.Failure).error)
    }

    @Test
    fun `gemini without a key is not configured`() = runBlocking {
        val result = gemini(settings()).transcribe(AudioSource.WavFile(wavFile()), null)

        assertTrue(result is TranscriptionResult.Failure)
        assertEquals(NOT_CONFIGURED, (result as TranscriptionResult.Failure).error)
        assertEquals(0, server.requestCount)
    }

    // --- Gemini: long audio → Files API --------------------------------------

    @Test
    fun `gemini uploads long audio via the files api and references fileData`() = runBlocking {
        val wav = wavFile(FloatArray(16000 * 10) { 0f }) // 10 s → > 0 maxInline
        val uri = "https://generativelanguage.googleapis.com/v1beta/files/abc123"
        val controlUrl = server.url("/upload/control").toString()

        server.enqueue(
            MockResponse().setResponseCode(200)
                .setHeader("X-Goog-Upload-Control-URL", controlUrl)
                .setBody("{}"),
        )
        server.enqueue(
            MockResponse().setBody(
                """{"file":{"name":"files/abc123","uri":"$uri","mimeType":"audio/wav","sizeBytes":${wav.length()}}}""",
            ),
        )
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}")) // cleanup DELETE
        server.enqueue(geminiCandidates("long audio transcribed"))

        val s = settings { setKey(Service.GEMINI, "gemini-key-456") }
        val result = gemini(s, maxInline = 0L).transcribe(AudioSource.WavFile(wav), null)

        val ok = result as? TranscriptionResult.Success
        assertNotNull("expected Success, got $result", ok)
        assertEquals("long audio transcribed", ok?.text)

        // 1. Upload start (resumable protocol headers).
        val start = server.takeRequest()
        assertEquals("POST", start.method)
        assertEquals("/v1beta/files", start.path?.substringBefore("?"))
        assertEquals("resumable", start.getHeader("X-Goog-Upload-Protocol"))
        assertEquals("start, upload, finalize", start.getHeader("X-Goog-Upload-Command"))
        assertEquals(wav.length().toString(), start.getHeader("X-Goog-Upload-Header-Content-Length"))
        assertEquals("audio/wav", start.getHeader("X-Goog-Upload-Header-Content-Type"))

        // 2. PUT the raw bytes to the control URL.
        val media = server.takeRequest()
        assertEquals("PUT", media.method)
        assertEquals("/upload/control", media.path)
        assertEquals(wav.readBytes().toList(), media.body.readByteArray().toList())

        // 3. Best-effort cleanup delete.
        val cleanup = server.takeRequest()
        assertEquals("DELETE", cleanup.method)
        assertEquals("/v1beta/files/abc123", cleanup.path?.substringBefore("?"))

        // 4. generateContent references the uploaded file.
        val gen = server.takeRequest()
        assertEquals("/v1beta/models/gemini-3.6-flash:generateContent", gen.path?.substringBefore("?"))
        val body = json.parseToJsonElement(gen.body.readUtf8()) as JsonObject
        val parts = parts(body)
        val fileData = (parts[0] as JsonObject)["fileData"] as JsonObject
        assertEquals("audio/wav", fileData["mimeType"]!!.jsonPrimitive.content)
        assertEquals(uri, fileData["fileUri"]!!.jsonPrimitive.content)
    }

    // --- Registry / selection --------------------------------------------------

    private class FakeLocalTranscriber : Transcriber {
        override val source = TranscriberSource.LOCAL
        override suspend fun transcribe(
            audio: AudioSource,
            language: String?,
            onPartial: (String) -> Unit,
        ) = TranscriptionResult.Success(TranscriberSource.LOCAL, "local result")
    }

    private fun registry(
        s: SpeechSettings,
        local: Transcriber? = FakeLocalTranscriber(),
    ) = TranscriberRegistry(s, groq(s), gemini(s), local)

    @Test
    fun `registry prefers gemini for add-comment when both keys exist`() = runBlocking {
        val s = settings {
            setKey(Service.GROQ, "groq-key-123")
            setKey(Service.GEMINI, "gemini-key-456")
        }
        assertEquals(TranscriberSource.GEMINI, registry(s).forAddComment()?.source)
    }

    @Test
    fun `registry falls back to groq when only groq is configured`() = runBlocking {
        val s = settings { setKey(Service.GROQ, "groq-key-123") }
        assertEquals(TranscriberSource.GROQ, registry(s).forAddComment()?.source)
    }

    @Test
    fun `registry falls back to local when no cloud key exists`() = runBlocking {
        val s = settings()
        assertEquals(TranscriberSource.LOCAL, registry(s).forAddComment()?.source)
    }

    @Test
    fun `registry returns null when nothing at all is wired`() = runBlocking {
        val s = settings()
        val r = TranscriberRegistry(s, groq(s), gemini(s), local = null)
        assertNull(r.forAddComment())
    }

    @Test
    fun `registry honors the preferred setting when its key exists`() = runBlocking {
        val s = settings {
            setKey(Service.GROQ, "groq-key-123")
            setKey(Service.GEMINI, "gemini-key-456")
            // settings.preferred = GROQ would be set by Task 19's real impl
        }
        // Default preferred is LOCAL → gemini wins via the Gemini-over-Groq rule.
        assertEquals(TranscriberSource.GEMINI, registry(s).forAddComment()?.source)
    }

    // --- helpers ---------------------------------------------------------------

    /** `contents[0].parts` of a generateContent request body. */
    private fun parts(body: JsonObject): JsonArray =
        ((body["contents"] as JsonArray)[0] as JsonObject)["parts"] as JsonArray

    private fun geminiCandidates(text: String): MockResponse =
        MockResponse().setBody(
            """{"candidates":[{"content":{"role":"model","parts":[{"text":"$text"}]}}]}""",
        )

    private fun assertFailure(result: TranscriptionResult, error: TranscriptionError, message: String) {
        assertTrue("expected Failure, got $result", result is TranscriptionResult.Failure)
        val f = result as TranscriptionResult.Failure
        assertEquals(error, f.error)
        assertEquals(message, f.message)
    }
}