package com.scholiast.android.domain.transcribe

import com.scholiast.android.domain.transcribe.TranscriptionError.INVALID_REQUEST
import com.scholiast.android.domain.transcribe.TranscriptionError.NOT_CONFIGURED
import com.scholiast.android.domain.transcribe.TranscriptionError.UNKNOWN
import com.scholiast.android.domain.transcribe.TranscriptionResult.Failure
import com.scholiast.android.domain.transcribe.TranscriptionResult.Success
import com.scholiast.android.domain.voice.local.DecodingMode
import com.scholiast.android.domain.voice.local.InferenceCancelledException
import com.scholiast.android.domain.voice.local.ModelDownloadable
import com.scholiast.android.domain.voice.local.ModelLoader
import com.scholiast.android.domain.voice.local.ModelManager
import com.scholiast.android.domain.voice.local.ModelStore
import com.scholiast.android.domain.voice.local.WhisperEngine
import com.scholiast.android.domain.voice.local.WhisperEngineFactory
import com.scholiast.android.domain.voice.local.WavDecoder
import com.scholiast.android.ui.voice.WavWriter
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * JVM tests for the local STT stack's pure parts.
 *
 * NOTE: the native `libscholiast_whisper.so` cannot run in JVM unit tests (no NDK-built
 * library on the host JVM). Everything touching the engine runs through a [WhisperEngine]
 * fake; the real engine path must be exercised on a device/emulator (see task-11 LOG.md for
 * the manual test steps).
 */
class FutoTranscriberTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private fun downloadedModel(name: String = "test.bin"): ModelLoader = object : ModelLoader {
        override val name = "Test model"
        override fun exists(modelsDir: File): Boolean = File(modelsDir, name).exists()
        override fun getRequiredDownloadList(modelsDir: File): List<String> =
            if (exists(modelsDir)) emptyList() else listOf(name)

        override fun loadGGML(modelsDir: File): Nothing =
            throw UnsupportedOperationException("native load is not JVM-testable")

        override fun key(modelsDir: File): Any = "test:$name"
    }

    private fun withDownloadedModel(name: String = "test.bin"): ModelLoader {
        val model = downloadedModel(name)
        File(tmp.root, name).writeText("fake model bytes")
        return model
    }

    private fun FakeEngineFactory(engine: WhisperEngine): WhisperEngineFactory =
        WhisperEngineFactory { _, _ -> engine }

    // ---------------------------------------------------------------- wav → f32

    @Test
    fun `WavDecoder round-trips WavWriter output`() {
        val samples = floatArrayOf(0.5f, -0.5f, 0.25f, -0.25f, 0f, 1f, -1f)
        val file = tmp.newFile("clip.wav")
        WavWriter.write(samples, file)

        val decoded = WavDecoder.decode(file)
        assertArrayEquals(samples, decoded, 1e-4f)
    }

    @Test
    fun `WavDecoder handles 16-bit stereo by taking the left channel`() {
        val left = floatArrayOf(0.5f, -0.5f, 0.25f)
        val right = floatArrayOf(-0.5f, 0.5f, -0.25f)
        val dataSize = 3 * 2 * 2
        val bytes = ByteArray(44 + dataSize)
        writeRiffHeader(bytes, channels = 2, bits = 16, dataSize = dataSize)
        var i = 0
        for (n in 0 until 3) {
            putLeShort(bytes, 44 + i, (left[n] * Short.MAX_VALUE).toInt()); i += 2
            putLeShort(bytes, 44 + i, (right[n] * Short.MAX_VALUE).toInt()); i += 2
        }

        val decoded = WavDecoder.decode(bytes)
        assertArrayEquals(left, decoded, 1e-4f)
    }

    @Test
    fun `WavDecoder rejects non-WAV bytes`() {
        assertThrows<Exception> { WavDecoder.decode(ByteArray(100) { 0x41 }) }
    }

    @Test
    fun `WavDecoder rejects unsupported encoding`() {
        // fmt chunk with audioFormat = 6 (ALAW)
        val bytes = ByteArray(44 + 8)
        writeRiffHeader(bytes, channels = 1, bits = 16, dataSize = 8, audioFormat = 6)
        assertThrows<Exception> { WavDecoder.decode(bytes) }
    }

    // ---------------------------------------------------------------- checksum + paths

    @Test
    fun `ModelStore sha256 and verifyChecksum agree with known digest`() {
        val store = ModelStore(tmp.root)
        val file = tmp.newFile("m.bin")
        file.writeText("hello checksum")
        val digest = store.sha256(file)
        assertTrue("digest must be 64 lowercase hex chars", digest.matches(Regex("[0-9a-f]{64}")))
        assertTrue(store.verifyChecksum(file, digest))
        assertFalse(store.verifyChecksum(file, "0".repeat(64)))
        // Blank/null expected → existence check only.
        assertTrue(store.verifyChecksum(file, ""))
        assertFalse(store.verifyChecksum(File(tmp.root, "absent.bin"), null))
    }

    @Test
    fun `ModelStore path layout uses filesDir-models naming`() {
        val store = ModelStore(tmp.root)
        assertEquals(File(tmp.root, "tiny_en_acft_q8_0.bin"), store.modelFile("tiny_en_acft_q8_0.bin"))
        assertEquals(
            File(tmp.root, "tiny_en_acft_q8_0.bin.part"),
            store.downloadTarget("tiny_en_acft_q8_0.bin")
        )
    }

    @Test
    fun `ModelDownloadable requires download only when the file is absent`() {
        val model = ModelDownloadable(
            "m", "base_en_acft_q8_0.bin",
            "e9b4b7b81b8a28769e8aa9962aa39bb9f21b622cf6a63982e93f065ed5caf1c8"
        )
        assertFalse(model.exists(tmp.root))
        assertEquals(listOf("base_en_acft_q8_0.bin"), model.getRequiredDownloadList(tmp.root))

        File(tmp.root, "base_en_acft_q8_0.bin").writeText("fake")
        assertTrue(model.exists(tmp.root))
        assertTrue(model.getRequiredDownloadList(tmp.root).isEmpty())
    }

    @Test
    fun `model catalogue checksums are well-formed and unique`() {
        val seen = mutableSetOf<String>()
        for (m in com.scholiast.android.domain.voice.local.ALL_MODELS) {
            val d = m as? ModelDownloadable ?: continue
            assertTrue(
                "checksum must be 64 hex chars or blank: ${d.ggmlFile}",
                d.checksum.isEmpty() || d.checksum.matches(Regex("[0-9a-f]{64}"))
            )
            if (d.checksum.isNotEmpty()) {
                assertTrue("duplicate checksum", seen.add(d.checksum))
            }
        }
    }

    // ---------------------------------------------------------------- transcriber

    @Test
    fun `transcribe returns engine text for float samples`() = runBlocking {
        val engine = EchoEngine("hello world")
        val transcriber = FutoTranscriber(
            modelsDir = tmp.root,
            model = withDownloadedModel(),
            engineFactory = FakeEngineFactory(engine),
        )

        val result = transcriber.transcribe(AudioSource.FloatSamples(floatArrayOf(0f, 1f)), "en")
        assertTrue(result is Success)
        assertEquals("hello world", (result as Success).text)
        assertEquals(TranscriberSource.LOCAL, result.source)
        assertNull(result.timestamps)
        assertArrayEquals(floatArrayOf(0f, 1f), engine.lastSamples!!, 0f)
    }

    @Test
    fun `transcribe decodes a wav file before inference`() = runBlocking {
        val samples = floatArrayOf(0.5f, -0.25f, 0.125f)
        val wav = tmp.newFile("clip.wav")
        WavWriter.write(samples, wav)

        val engine = EchoEngine("from wav")
        val transcriber = FutoTranscriber(
            modelsDir = tmp.root,
            model = withDownloadedModel(),
            engineFactory = FakeEngineFactory(engine),
        )

        val result = transcriber.transcribe(AudioSource.WavFile(wav), null)
        assertTrue(result is Success)
        assertEquals("from wav", (result as Success).text)
        assertArrayEquals(samples, engine.lastSamples!!, 1e-4f)
    }

    @Test
    fun `blank engine output becomes empty text`() = runBlocking {
        val transcriber = FutoTranscriber(
            modelsDir = tmp.root,
            model = withDownloadedModel(),
            engineFactory = FakeEngineFactory(EchoEngine("(music playing)")),
        )
        val result = transcriber.transcribe(AudioSource.FloatSamples(floatArrayOf(0f)), null)
        assertTrue(result is Success)
        assertEquals("", (result as Success).text)
    }

    @Test
    fun `empty samples return empty text without touching the engine`() = runBlocking {
        val engine = EchoEngine("should not run")
        val transcriber = FutoTranscriber(
            modelsDir = tmp.root,
            model = withDownloadedModel(),
            engineFactory = FakeEngineFactory(engine),
        )
        val result = transcriber.transcribe(AudioSource.FloatSamples(FloatArray(0)), null)
        assertTrue(result is Success)
        assertEquals("", (result as Success).text)
        assertNull(engine.lastSamples)
    }

    @Test
    fun `missing model returns a NOT_CONFIGURED failure`() = runBlocking {
        val transcriber = FutoTranscriber(
            modelsDir = tmp.root,
            model = downloadedModel(), // file NOT created
            engineFactory = FakeEngineFactory(EchoEngine("x")),
        )
        val result = transcriber.transcribe(AudioSource.FloatSamples(floatArrayOf(0f)), null)
        assertTrue(result is Failure)
        val failure = result as Failure
        assertEquals(NOT_CONFIGURED, failure.error)
        assertTrue(failure.message.contains("not downloaded"))
    }

    @Test
    fun `partial results stream through onPartial and blank ones are filtered`() = runBlocking {
        val partials = mutableListOf<String>()
        val engine = StreamingEngine(listOf("you ", "(music) ", "hello "))
        val transcriber = FutoTranscriber(
            modelsDir = tmp.root,
            model = withDownloadedModel(),
            engineFactory = FakeEngineFactory(engine),
        )
        val result = transcriber.transcribe(
            AudioSource.FloatSamples(floatArrayOf(0f)), null, onPartial = { partials.add(it) }
        )
        assertTrue(result is Success)
        assertEquals("hello", (result as Success).text)
        // "you" and "(music)" are blank-result permutations → filtered; "hello " trimmed.
        assertEquals(listOf("hello"), partials)
    }

    @Test
    fun `cancelling the coroutine aborts a blocked inference cooperatively`() = runBlocking {
        val engine = BlockingEngine()
        val transcriber = FutoTranscriber(
            modelsDir = tmp.root,
            model = withDownloadedModel(),
            engineFactory = FakeEngineFactory(engine),
        )

        val scope = CoroutineScope(Dispatchers.Default)
        val deferred = scope.async {
            transcriber.transcribe(AudioSource.FloatSamples(floatArrayOf(0f, 1f, 0f)), "en")
        }

        withTimeout(5_000) {
            assertTrue("engine never started", engine.started.await(5, TimeUnit.SECONDS))
            deferred.cancel()
            val thrown = runCatching { deferred.await() }.exceptionOrNull()
            assertTrue("expected CancellationException, got $thrown", thrown is CancellationException)
            assertTrue("engine.cancel() was never called", engine.cancelCalled)
        }
        scope.cancel()
    }

    @Test
    fun `engine failure returns a typed UNKNOWN failure`() = runBlocking {
        val transcriber = FutoTranscriber(
            modelsDir = tmp.root,
            model = withDownloadedModel(),
            engineFactory = FakeEngineFactory(FailingEngine()),
        )
        val result = transcriber.transcribe(AudioSource.FloatSamples(floatArrayOf(0f)), null)
        assertTrue(result is Failure)
        assertEquals(UNKNOWN, (result as Failure).error)
        assertNotNull(result.cause)
    }

    @Test
    fun `bail language returns an INVALID_REQUEST failure`() = runBlocking {
        val transcriber = FutoTranscriber(
            modelsDir = tmp.root,
            model = withDownloadedModel(),
            engineFactory = FakeEngineFactory(BailEngine("fr")),
        )
        val result = transcriber.transcribe(AudioSource.FloatSamples(floatArrayOf(0f)), "en")
        assertTrue(result is Failure)
        assertEquals(INVALID_REQUEST, (result as Failure).error)
        assertTrue(result.message.contains("fr"))
    }

    // ---------------------------------------------------------------- helpers

    private inline fun <reified T : Throwable> assertThrows(block: () -> Unit) {
        try {
            block()
        } catch (e: Throwable) {
            if (e is T) return
            throw AssertionError("expected ${T::class.simpleName}, got $e", e)
        }
        throw AssertionError("expected ${T::class.simpleName} but nothing was thrown")
    }

    private fun writeRiffHeader(bytes: ByteArray, channels: Int, bits: Int, dataSize: Int, audioFormat: Int = 1) {
        "RIFF".toByteArray().copyInto(bytes, 0, 0, 4)
        putLeInt(bytes, 4, 36 + dataSize)
        "WAVE".toByteArray().copyInto(bytes, 8, 0, 4)
        "fmt ".toByteArray().copyInto(bytes, 12, 0, 4)
        putLeInt(bytes, 16, 16)
        putLeShort(bytes, 20, audioFormat)
        putLeShort(bytes, 22, channels)
        putLeInt(bytes, 24, 16000)
        putLeInt(bytes, 28, 16000 * channels * bits / 8)
        putLeShort(bytes, 32, channels * bits / 8)
        putLeShort(bytes, 34, bits)
        "data".toByteArray().copyInto(bytes, 36, 0, 4)
        putLeInt(bytes, 40, dataSize)
    }

    private fun putLeShort(bytes: ByteArray, offset: Int, value: Int) {
        bytes[offset] = (value and 0xFF).toByte()
        bytes[offset + 1] = ((value shr 8) and 0xFF).toByte()
    }

    private fun putLeInt(bytes: ByteArray, offset: Int, value: Int) {
        bytes[offset] = (value and 0xFF).toByte()
        bytes[offset + 1] = ((value shr 8) and 0xFF).toByte()
        bytes[offset + 2] = ((value shr 16) and 0xFF).toByte()
        bytes[offset + 3] = ((value shr 24) and 0xFF).toByte()
    }

    // ---------------------------------------------------------------- fakes

    private class EchoEngine(val text: String) : WhisperEngine {
        var lastSamples: FloatArray? = null
        override suspend fun infer(
            samples: FloatArray, prompt: String, languages: Array<String>, bailLanguages: Array<String>,
            decodingMode: DecodingMode, suppressNonSpeechTokens: Boolean,
            partialResultCallback: (String) -> Unit
        ): String {
            lastSamples = samples.copyOf()
            return text
        }

        override fun cancel() {}
        override suspend fun close() {}
    }

    /** Emits partials, then returns the last one as its final result. */
    private class StreamingEngine(private val partials: List<String>) : WhisperEngine {
        override suspend fun infer(
            samples: FloatArray, prompt: String, languages: Array<String>, bailLanguages: Array<String>,
            decodingMode: DecodingMode, suppressNonSpeechTokens: Boolean,
            partialResultCallback: (String) -> Unit
        ): String {
            partials.forEach(partialResultCallback)
            return partials.last()
        }

        override fun cancel() {}
        override suspend fun close() {}
    }

    /** Blocks until cancel() — mirrors the native abort semantics. */
    private class BlockingEngine : WhisperEngine {
        val started = CountDownLatch(1)
        val cancelled = CountDownLatch(1)
        @Volatile var cancelCalled = false

        override suspend fun infer(
            samples: FloatArray, prompt: String, languages: Array<String>, bailLanguages: Array<String>,
            decodingMode: DecodingMode, suppressNonSpeechTokens: Boolean,
            partialResultCallback: (String) -> Unit
        ): String {
            started.countDown()
            if (!cancelled.await(5, TimeUnit.SECONDS)) throw IllegalStateException("engine never cancelled")
            throw InferenceCancelledException()
        }

        override fun cancel() {
            cancelCalled = true
            cancelled.countDown()
        }

        override suspend fun close() {}
    }

    private class FailingEngine : WhisperEngine {
        override suspend fun infer(
            samples: FloatArray, prompt: String, languages: Array<String>, bailLanguages: Array<String>,
            decodingMode: DecodingMode, suppressNonSpeechTokens: Boolean,
            partialResultCallback: (String) -> Unit
        ): String = throw RuntimeException("engine exploded")

        override fun cancel() {}
        override suspend fun close() {}
    }

    private class BailEngine(private val language: String) : WhisperEngine {
        override suspend fun infer(
            samples: FloatArray, prompt: String, languages: Array<String>, bailLanguages: Array<String>,
            decodingMode: DecodingMode, suppressNonSpeechTokens: Boolean,
            partialResultCallback: (String) -> Unit
        ): String = throw com.scholiast.android.domain.voice.local.BailLanguageException(language)

        override fun cancel() {}
        override suspend fun close() {}
    }
}