package com.scholiast.android.domain.ocr

import com.scholiast.android.data.db.LoadedVideoPage
import com.scholiast.android.data.db.OcrTextDao
import com.scholiast.android.data.db.OcrTextEntity
import com.scholiast.android.data.db.VideoPageEntity
import com.scholiast.android.data.model.VideoItem
import com.scholiast.android.data.notes.VideoItemRepository
import com.scholiast.android.domain.transcribe.DefaultSpeechSettings
import com.scholiast.android.domain.transcribe.Service
import com.scholiast.android.domain.transcribe.TranscriptionError.INVALID_REQUEST
import com.scholiast.android.domain.transcribe.TranscriptionError.NETWORK
import com.scholiast.android.domain.transcribe.TranscriptionError.RATE_LIMITED
import com.scholiast.android.domain.transcribe.TranscriptionError.SERVER
import com.scholiast.android.domain.transcribe.TranscriptionError.UNAUTHORIZED
import com.scholiast.android.domain.transcribe.TranscriptionError.UNKNOWN
import java.io.File
import java.util.Base64
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Task 15 tests: the Gemma OCR client against MockWebServer (request shape —
 * inline JPEG base64 + the OCR prompt, response parse, cleaning, error
 * mapping, no-key no-op), the [OcrRunner] skip/retry/offline policy, and
 * [OcrStorage] persistence into the item + `ocr_texts` row. JVM-only — the
 * OCR layer has no Android deps except `android.util.Log` (stubbed in unit
 * tests).
 */
class GemmaClientTest {

    private lateinit var server: MockWebServer
    private val json = Json { ignoreUnknownKeys = true }

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    // --- fixtures ------------------------------------------------------------

    private fun settings(configure: DefaultSpeechSettings.() -> Unit = {}): DefaultSpeechSettings =
        DefaultSpeechSettings().apply(configure)

    private fun client(
        s: com.scholiast.android.domain.transcribe.SpeechSettings,
        baseUrl: String = server.url("/").toString().removeSuffix("/"),
        model: String = GemmaClient.DEFAULT_GEMMA_MODEL,
    ) = GemmaClient(s, OkHttpClient(), baseUrl, model)

    private fun jpegFile(bytes: ByteArray = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte())): File {
        val f = File.createTempFile("ocr-test", ".jpg")
        f.writeBytes(bytes)
        f.deleteOnExit()
        return f
    }

    private fun gemmaCandidates(text: String): MockResponse =
        MockResponse().setBody(
            """{"candidates":[{"content":{"role":"model","parts":[{"text":"$text"}]}}]}""",
        )

    /** `contents[0].parts` of a generateContent request body. */
    private fun parts(body: JsonObject): JsonArray =
        ((body["contents"] as JsonArray)[0] as JsonObject)["parts"] as JsonArray

    // --- client: request shape ----------------------------------------------

    @Test
    fun `client sends inline jpeg base64 plus the OCR prompt`() = runBlocking {
        server.enqueue(gemmaCandidates("Slide one: photosynthesis"))
        val s = settings { setKey(Service.GEMMA, "gemma-key-123") }
        val jpeg = jpegFile()

        val result = client(s).ocr(jpeg)

        val ok = result as? OcrResult.Success
        assertNotNull("expected Success, got $result", ok)
        assertEquals("Slide one: photosynthesis", ok!!.text)

        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/v1beta/models/${GemmaClient.DEFAULT_GEMMA_MODEL}:generateContent", req.path?.substringBefore("?"))
        assertEquals("gemma-key-123", req.path?.substringAfter("key="))

        val body = json.parseToJsonElement(req.body.readUtf8()) as JsonObject
        val parts = parts(body)
        val inline = (parts[0] as JsonObject)["inlineData"] as JsonObject
        assertEquals("image/jpeg", inline["mimeType"]!!.jsonPrimitive.content)
        val decoded = Base64.getDecoder().decode(inline["data"]!!.jsonPrimitive.content)
        assertEquals(jpeg.readBytes().toList(), decoded.toList())
        val prompt = (parts[1] as JsonObject)["text"]!!.jsonPrimitive.content
        assertEquals(GemmaClient.OCR_PROMPT, prompt)
    }

    @Test
    fun `client honors an injected model id`() = runBlocking {
        server.enqueue(gemmaCandidates("hi"))
        val s = settings { setKey(Service.GEMMA, "gemma-key-123") }

        client(s, model = "gemma-4-31b-it").ocr(byteArrayOf(1, 2, 3))

        val req = server.takeRequest()
        assertTrue(req.path!!.startsWith("/v1beta/models/gemma-4-31b-it:generateContent"))
    }

    @Test
    fun `client with a missing file skips without a request`() = runBlocking {
        val s = settings { setKey(Service.GEMMA, "gemma-key-123") }
        val missing = File("/nonexistent/frame.jpg")

        val result = client(s).ocr(missing)

        assertEquals(OcrResult.Skipped(OcrSkipReason.FILE_MISSING), result)
        assertEquals(0, server.requestCount)
    }

    // --- client: response parsing + cleaning ---------------------------------

    @Test
    fun `client joins multi-part text`() = runBlocking {
        server.enqueue(
            MockResponse().setBody(
                """{"candidates":[{"content":{"parts":[{"text":"The "},{"text":"slide"}]}}]}""",
            ),
        )
        val s = settings { setKey(Service.GEMMA, "gemma-key-123") }

        val result = client(s).ocr(byteArrayOf(1))

        assertEquals(OcrResult.Success("The slide"), result)
    }

    @Test
    fun `client strips a fenced response and cleans whitespace`() = runBlocking {
        server.enqueue(
            MockResponse().setBody(
                "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"```text\\n  Slide one  \\n\\n\\n\\n\\nSlide two  \\n```\"}]}}]}",
            ),
        )
        val s = settings { setKey(Service.GEMMA, "gemma-key-123") }

        val result = client(s).ocr(byteArrayOf(1))

        assertEquals(OcrResult.Success("Slide one\n\nSlide two"), result)
    }

    @Test
    fun `cleanOcrText normalizes line endings and drops fence language tokens`() {
        assertEquals("a\nb", cleanOcrText("a\r\nb"))
        assertEquals("a\n\nb", cleanOcrText("a\n\n\n\n\nb"))
        assertEquals("hello", cleanOcrText("```text\nhello\n```"))
        assertEquals("hello", cleanOcrText("```markdown\nhello\n```"))
        assertEquals("plain", cleanOcrText("```\nplain\n```"))
        assertEquals("indented", cleanOcrText("  indented  "))
        // A fence-looking but unfence-able string is left alone.
        assertEquals("```text", cleanOcrText("```text"))
    }

    @Test
    fun `client with an empty candidates list fails with unknown`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"candidates":[],"promptFeedback":{"blockReason":"SAFETY"}}"""))
        val s = settings { setKey(Service.GEMMA, "gemma-key-123") }

        val result = client(s).ocr(byteArrayOf(1))

        assertTrue(result is OcrResult.Failure)
        assertEquals(UNKNOWN, (result as OcrResult.Failure).error)
    }

    @Test
    fun `client with a blank model response fails with unknown`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"candidates":[{"content":{"parts":[{"text":"   "}]}}]}"""))
        val s = settings { setKey(Service.GEMMA, "gemma-key-123") }

        val result = client(s).ocr(byteArrayOf(1))

        assertTrue(result is OcrResult.Failure)
        assertEquals(UNKNOWN, (result as OcrResult.Failure).error)
    }

    // --- client: error mapping -----------------------------------------------

    @Test
    fun `client maps 401 to unauthorized`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":{"code":401,"message":"API key not valid"}}"""))
        val s = settings { setKey(Service.GEMMA, "bad-key") }

        val result = client(s).ocr(byteArrayOf(1))

        assertFailure(result, UNAUTHORIZED, "API key not valid")
    }

    @Test
    fun `client maps 429 to rate limited`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(429)
                .setBody("""{"error":{"code":429,"message":"Quota exceeded","status":"RESOURCE_EXHAUSTED"}}"""),
        )
        val s = settings { setKey(Service.GEMMA, "gemma-key-123") }

        val result = client(s).ocr(byteArrayOf(1))

        assertFailure(result, RATE_LIMITED, "Quota exceeded")
    }

    @Test
    fun `client maps 500 to server error`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(503).setBody("""{"error":{"message":"unavailable"}}"""))
        val s = settings { setKey(Service.GEMMA, "gemma-key-123") }

        val result = client(s).ocr(byteArrayOf(1))

        assertFailure(result, SERVER, "unavailable")
    }

    @Test
    fun `client maps a non-json error body to a generic message`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(400).setBody("plain text error"))
        val s = settings { setKey(Service.GEMMA, "gemma-key-123") }

        val result = client(s).ocr(byteArrayOf(1))

        assertTrue(result is OcrResult.Failure)
        val f = result as OcrResult.Failure
        assertEquals(INVALID_REQUEST, f.error)
        assertTrue(f.message.contains("400"))
    }

    @Test
    fun `client maps a connection failure to network error`() = runBlocking {
        val deadPort = server.port
        server.shutdown() // connection refused
        val s = settings { setKey(Service.GEMMA, "gemma-key-123") }

        val result = client(s, baseUrl = "http://127.0.0.1:$deadPort").ocr(byteArrayOf(1))

        assertTrue("expected NETWORK, got $result", (result as? OcrResult.Failure)?.error == NETWORK)
    }

    @Test
    fun `client without a key skips without a request`() = runBlocking {
        val result = client(settings()).ocr(byteArrayOf(1))

        assertEquals(OcrResult.Skipped(OcrSkipReason.NO_KEY), result)
        assertEquals(0, server.requestCount)
    }

    // --- runner: happy path ----------------------------------------------------

    @Test
    fun `runner stores recognized text on the item and the ocr row`() = runBlocking {
        server.enqueue(gemmaCandidates("Mitosis phase one"))
        val env = runnerEnv(configure = { setKey(Service.GEMMA, "gemma-key-123") })
        env.repo.addItem("https://www.youtube.com/watch?v=abc", item("fr-1"))

        val result = env.runner.run("fr-1", jpegFile())

        assertEquals("Mitosis phase one", result)
        assertEquals("Mitosis phase one", env.repo.item("fr-1")?.ocrText)
        assertEquals("Mitosis phase one", env.dao.rows["fr-1"]?.text)
        assertEquals(OcrStorage.SOURCE_GEMMA, env.dao.rows["fr-1"]?.source)
        assertNotNull(env.dao.rows["fr-1"]?.createdAt)
    }

    // --- runner: skip logic -----------------------------------------------------

    @Test
    fun `runner skips when offline without a request`() = runBlocking {
        val env = runnerEnv({ setKey(Service.GEMMA, "gemma-key-123") }, online = { false })

        val result = env.runner.run("fr-1", jpegFile())

        assertNull(result)
        assertEquals(0, server.requestCount)
        assertNull(env.repo.item("fr-1")?.ocrText)
    }

    @Test
    fun `runner skips when no key is configured`() = runBlocking {
        val env = runnerEnv()
        env.repo.addItem("https://www.youtube.com/watch?v=abc", item("fr-1"))

        val result = env.runner.run("fr-1", jpegFile())

        assertNull(result)
        assertEquals(0, server.requestCount)
        assertNull(env.repo.item("fr-1")?.ocrText)
        assertTrue(env.dao.rows.isEmpty())
    }

    @Test
    fun `runner skips when the frame file is missing`() = runBlocking {
        val env = runnerEnv(configure = { setKey(Service.GEMMA, "gemma-key-123") })

        val result = env.runner.run("fr-1", File("/nonexistent/fr-1.jpg"))

        assertNull(result)
        assertEquals(0, server.requestCount)
    }

    // --- runner: retry policy ---------------------------------------------------

    @Test
    fun `runner retries once on a server error then drops`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(503).setBody("""{"error":{"message":"unavailable"}}"""))
        server.enqueue(MockResponse().setResponseCode(503).setBody("""{"error":{"message":"still unavailable"}}"""))
        val env = runnerEnv(configure = { setKey(Service.GEMMA, "gemma-key-123") })
        env.repo.addItem("https://www.youtube.com/watch?v=abc", item("fr-1"))

        val result = env.runner.run("fr-1", jpegFile())

        assertNull(result)
        assertEquals("one retry after the first failure", 2, server.requestCount)
        assertNull(env.repo.item("fr-1")?.ocrText)
    }

    @Test
    fun `runner recovers on the retry after a transient failure`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(500).setBody("""{"error":{"message":"boom"}}"""))
        server.enqueue(gemmaCandidates("recovered text"))
        val env = runnerEnv(configure = { setKey(Service.GEMMA, "gemma-key-123") })
        env.repo.addItem("https://www.youtube.com/watch?v=abc", item("fr-1"))

        val result = env.runner.run("fr-1", jpegFile())

        assertEquals("recovered text", result)
        assertEquals(2, server.requestCount)
        assertEquals("recovered text", env.repo.item("fr-1")?.ocrText)
    }

    @Test
    fun `runner does not retry a 401`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":{"message":"bad key"}}"""))
        val env = runnerEnv(configure = { setKey(Service.GEMMA, "bad-key") })
        env.repo.addItem("https://www.youtube.com/watch?v=abc", item("fr-1"))

        val result = env.runner.run("fr-1", jpegFile())

        assertNull(result)
        assertEquals(1, server.requestCount)
        assertNull(env.repo.item("fr-1")?.ocrText)
    }

    @Test
    fun `runner drops when the model returns no text`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"candidates":[{"content":{"parts":[{"text":" "}]}}]}"""))
        val env = runnerEnv(configure = { setKey(Service.GEMMA, "gemma-key-123") })
        env.repo.addItem("https://www.youtube.com/watch?v=abc", item("fr-1"))

        val result = env.runner.run("fr-1", jpegFile())

        assertNull(result)
        assertNull(env.repo.item("fr-1")?.ocrText)
        assertTrue(env.dao.rows.isEmpty())
    }

    // --- runner: detached mode ----------------------------------------------------

    @Test
    fun `runner in detached mode returns immediately and stores in the background`() = runBlocking {
        server.enqueue(gemmaCandidates("background text"))
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
        val env = runnerEnv({ setKey(Service.GEMMA, "gemma-key-123") }, scope = scope, detached = true)
        env.repo.addItem("https://www.youtube.com/watch?v=abc", item("fr-1"))

        // run() itself must not suspend on the network call.
        val result = env.runner.run("fr-1", jpegFile())
        assertNull("detached run returns immediately", result)

        scope.coroutineContext[Job]!!.children.forEach { it.join() }
        assertEquals("background work still stores the text", "background text", env.repo.item("fr-1")?.ocrText)
    }

    // --- storage -----------------------------------------------------------------

    @Test
    fun `storage updates the item and upserts the ocr entity`() = runBlocking {
        val repo = FakeVideoItemRepository()
        val dao = FakeOcrTextDao()
        val storage = OcrStorage(repo, dao, clock = { 1234L })
        repo.addItem("https://www.youtube.com/watch?v=abc", item("fr-1"))

        val stored = storage.store("fr-1", "text here")

        assertTrue(stored)
        assertEquals("text here", repo.item("fr-1")?.ocrText)
        assertEquals(OcrTextEntity("fr-1", "text here", "gemma", 1234L), dao.rows["fr-1"])
    }

    @Test
    fun `storage with an unknown item id is a no-op`() = runBlocking {
        val repo = FakeVideoItemRepository()
        val dao = FakeOcrTextDao()
        val storage = OcrStorage(repo, dao)

        assertFalse(storage.store("ghost", "text"))
        assertTrue(dao.rows.isEmpty())
    }

    @Test
    fun `storage finds the item across multiple pages`() = runBlocking {
        val repo = FakeVideoItemRepository()
        repo.addItem("https://www.youtube.com/watch?v=aaa", item("fr-a"))
        repo.addItem("https://www.youtube.com/watch?v=bbb", item("fr-b"))
        val storage = OcrStorage(repo, FakeOcrTextDao())

        val found = storage.findItem("fr-b")

        assertEquals("https://www.youtube.com/watch?v=bbb", found?.first)
        assertEquals("fr-b", found?.second?.id)
    }

    // --- helpers ------------------------------------------------------------------

    private fun item(id: String) = VideoItem(id = id, kind = "frame", videoTime = 42.0)

    private fun runnerEnv(
        configure: DefaultSpeechSettings.() -> Unit = {},
        online: suspend () -> Boolean = { true },
        scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
        detached: Boolean = false,
    ): RunnerEnv {
        val s = settings(configure)
        val repo = FakeVideoItemRepository()
        val dao = FakeOcrTextDao()
        val storage = OcrStorage(repo, dao)
        val runner = OcrRunner(
            client = client(s),
            storage = storage,
            scope = scope,
            isOnline = online,
            detached = detached,
        )
        return RunnerEnv(runner, repo, dao)
    }

    private data class RunnerEnv(
        val runner: OcrRunner,
        val repo: FakeVideoItemRepository,
        val dao: FakeOcrTextDao,
    )

    private fun assertFailure(result: OcrResult, error: com.scholiast.android.domain.transcribe.TranscriptionError, message: String) {
        assertTrue("expected Failure, got $result", result is OcrResult.Failure)
        val f = result as OcrResult.Failure
        assertEquals(error, f.error)
        assertEquals(message, f.message)
    }

    /** In-memory repository (same contract as Task 06/14's test fakes). */
    private class FakeVideoItemRepository : VideoItemRepository {
        val pages = mutableMapOf<String, MutableList<VideoItem>>()

        fun item(id: String): VideoItem? = pages.values.flatten().firstOrNull { it.id == id }

        override suspend fun upsertPage(pageUrl: String, videoId: String?, title: String?): VideoPageEntity {
            pages.putIfAbsent(pageUrl, mutableListOf())
            return pageEntity(pageUrl)
        }

        override suspend fun loadPage(pageUrl: String): LoadedVideoPage? {
            val items = pages[pageUrl] ?: return null
            return LoadedVideoPage(
                urlHash = pageUrl, url = pageUrl, videoId = null, title = null,
                items = items, updatedAt = 0L, snap = null, fileId = null, headRevisionId = null,
            )
        }

        override suspend fun listRecentPages(limit: Int): List<VideoPageEntity> = pages.keys.map(::pageEntity)

        override suspend fun listAllPages(): List<VideoPageEntity> = listRecentPages()

        override suspend fun addItem(pageUrl: String, item: VideoItem): VideoItem {
            val stamped = item.copy(updatedAt = 1000L)
            pages.getOrPut(pageUrl) { mutableListOf() }.let { items ->
                val idx = items.indexOfFirst { it.id == stamped.id }
                if (idx >= 0) items[idx] = stamped else items.add(stamped)
            }
            return stamped
        }

        override suspend fun updateItem(pageUrl: String, item: VideoItem): VideoItem? {
            val items = pages[pageUrl] ?: return null
            val idx = items.indexOfFirst { it.id == item.id }
            if (idx < 0) return null
            val stamped = item.copy(updatedAt = 2000L)
            items[idx] = stamped
            return stamped
        }

        override suspend fun deleteItem(pageUrl: String, itemId: String): Boolean {
            val items = pages[pageUrl] ?: return false
            val removed = items.removeAll { it.id == itemId }
            if (items.isEmpty()) pages.remove(pageUrl)
            return removed
        }

        override suspend fun deletePage(pageUrl: String) {
            pages.remove(pageUrl)
        }

        private fun pageEntity(pageUrl: String) = VideoPageEntity(
            urlHash = pageUrl, url = pageUrl, videoId = null, title = null,
            itemsJson = "[]", updatedAt = 0L, snapJson = null, fileId = null, headRevisionId = null,
        )
    }

    /** In-memory [OcrTextDao] — the Room impl is Task 02's, owned elsewhere. */
    private class FakeOcrTextDao : OcrTextDao {
        val rows = mutableMapOf<String, OcrTextEntity>()

        override suspend fun upsert(ocr: OcrTextEntity) {
            rows[ocr.itemId] = ocr
        }

        override suspend fun get(itemId: String): OcrTextEntity? = rows[itemId]

        override suspend fun getMany(itemIds: List<String>): List<OcrTextEntity> =
            rows.values.filter { it.itemId in itemIds }

        override suspend fun delete(itemId: String) {
            rows.remove(itemId)
        }

        override suspend fun deleteAll() {
            rows.clear()
        }

        override suspend fun listAll(): List<OcrTextEntity> =
            rows.values.sortedByDescending { it.createdAt }
    }
}