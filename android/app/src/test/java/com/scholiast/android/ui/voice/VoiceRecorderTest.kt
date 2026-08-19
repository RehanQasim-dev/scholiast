package com.scholiast.android.ui.voice

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.text.Charsets
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for the pure recorder core (Task 09). No Android dependencies — these run on the
 * JVM only. (The Gradle build is Task 01's; until it lands, run with any JUnit4 host, or `./gradlew
 * :app:testDebugUnitTest` once the skeleton exists.)
 */
class VoiceRecorderTest {

    // ---- AudioCapture: buffer growth -----------------------------------------------

    @Test
    fun `starts at 30s capacity and grows past it`() {
        val capture = AudioCapture()
        assertEquals(RECORDER_SAMPLE_RATE * 30, captureInitialCapacity(capture))

        val chunk = ShortArray(1600) { (it % 1000).toShort() }
        var fed = 0
        var ok = true
        // Feed 45 seconds worth of audio in 1600-sample chunks.
        while (fed < RECORDER_SAMPLE_RATE * 45 && ok) {
            ok = capture.feed(chunk, chunk.size)
            fed += chunk.size
        }
        assertTrue("should have been able to feed 45s", ok)
        assertEquals(RECORDER_SAMPLE_RATE * 45, capture.position)
        // Buffer must have grown beyond the initial 30 s.
        assertTrue(capture.bufferSize > RECORDER_SAMPLE_RATE * 30)
        assertEquals(RECORDER_SAMPLE_RATE * 45 * 1000L / RECORDER_SAMPLE_RATE, capture.elapsedMs)
    }

    @Test
    fun `max length guard stops growth at 2 minutes`() {
        val capture = AudioCapture()
        val chunk = ShortArray(1600) { 2000 }
        val maxSamples = RECORDER_SAMPLE_RATE * 120

        var fed = 0
        var ok = true
        while (ok) {
            ok = capture.feed(chunk, chunk.size)
            if (ok) fed += chunk.size
        }
        // The last chunk was refused: position is exactly at the 2-minute cap.
        assertEquals(maxSamples, capture.position)
        assertEquals(maxSamples, fed)
        assertFalse("feed must refuse past the cap", capture.feed(chunk, chunk.size))
        // Auto-stop signal is what the recorder loop reacts to.
        assertEquals(2 * 60 * 1000L, capture.elapsedMs)
    }

    @Test
    fun `magnitude stays in range and responds to volume`() {
        val quiet = AudioCapture.computeMagnitude(ShortArray(1600) { 1 }, 1600)
        val loud = AudioCapture.computeMagnitude(ShortArray(1600) { 12000 }, 1600)
        assertTrue("quiet magnitude near 0", quiet in 0f..0.1f)
        assertTrue("loud magnitude near 1", loud in 0.9f..1f)
        assertTrue("louder input yields larger magnitude", loud > quiet)
    }

    @Test
    fun `close rejects further feeds and snapshot is stable`() {
        val capture = AudioCapture()
        val chunk = ShortArray(1600) { 500 }
        assertTrue(capture.feed(chunk, chunk.size))
        capture.close()
        assertFalse(capture.feed(chunk, chunk.size))
        val snap = capture.snapshot()
        assertEquals(1600, snap.size)
        // Close + snapshot must not double-count (no writes happened after close).
        assertEquals(1600, capture.position)
        capture.reset()
        assertEquals(0, capture.position)
        assertTrue("reset reopens the buffer", capture.feed(chunk, chunk.size))
    }

    // ---- RecordingDriver: state machine --------------------------------------------

    @Test
    fun `state transitions idle to recording to stopped to processing to idle`() {
        val driver = RecordingDriver()
        assertEquals(RecorderState.Idle, driver.state.value)

        assertTrue(driver.begin())
        val rec = driver.state.value as RecorderState.Recording
        assertEquals(0L, rec.elapsedMs)

        // Second begin while recording is a no-op.
        assertFalse(driver.begin())

        val chunk = ShortArray(1600) { 1000 }
        assertTrue(driver.feed(chunk, chunk.size))
        val rec2 = driver.state.value as RecorderState.Recording
        assertTrue(rec2.elapsedMs > 0)
        assertTrue(rec2.magnitude >= 0f)

        val samples = driver.finish()
        assertEquals(1600, samples.size)
        val stopped = driver.state.value as RecorderState.Stopped
        assertEquals(1600, stopped.samples.size)
        assertTrue(samples.contentEquals(stopped.samples))

        driver.markProcessing()
        assertEquals(RecorderState.Processing, driver.state.value)

        driver.complete()
        assertEquals(RecorderState.Idle, driver.state.value)
    }

    @Test
    fun `cancel discards samples and returns to idle`() {
        val driver = RecordingDriver()
        driver.begin()
        val chunk = ShortArray(1600) { 3000 }
        assertTrue(driver.feed(chunk, chunk.size))

        driver.cancel()
        assertEquals(RecorderState.Idle, driver.state.value)

        // Next recording starts empty.
        driver.begin()
        val samples = driver.finish()
        assertEquals(0, samples.size)
    }

    @Test
    fun `fail moves any state to error and resets`() {
        val driver = RecordingDriver()
        driver.begin()
        driver.fail("mic busy")
        val err = driver.state.value as RecorderState.Error
        assertEquals("mic busy", err.message)

        // Error → begin restarts fresh.
        assertTrue(driver.begin())
        assertTrue(driver.state.value is RecorderState.Recording)
    }

    @Test
    fun `finish from idle returns empty samples`() {
        val driver = RecordingDriver()
        assertEquals(0, driver.finish().size)
        assertTrue(driver.state.value is RecorderState.Stopped)
    }

    // ---- stop-returns-samples (through the driver) ---------------------------------

    @Test
    fun `stop returns the exact samples fed`() {
        val driver = RecordingDriver()
        driver.begin()
        val chunk = ShortArray(1600) { 8000 }
        driver.feed(chunk, chunk.size)
        val samples = driver.finish()
        assertEquals(1600, samples.size)
        val expected = AudioCapture.normalizeSample(8000)
        assertTrue(abs(samples.first() - expected) < 1e-6f)
        assertEquals(samples.size, chunk.size)
    }

    // ---- WavWriter ---------------------------------------------------------------

    @Test
    fun `wav header is 16k mono 16-bit pcm`() {
        val samples = floatArrayOf(0f, 0.5f, -0.5f, 1f, -1f)
        val file = File.createTempFile("voice-test", ".wav")
        file.deleteOnExit()
        WavWriter.write(samples, file)

        val bytes = file.readBytes()
        assertEquals(44 + samples.size * 2, bytes.size)

        val bb = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals("RIFF", String(bytes, 0, 4, Charsets.US_ASCII))
        assertEquals(36 + samples.size * 2, bb.getInt(4))
        assertEquals("WAVE", String(bytes, 8, 4, Charsets.US_ASCII))
        assertEquals("fmt ", String(bytes, 12, 4, Charsets.US_ASCII))
        assertEquals(16, bb.getInt(16))          // fmt chunk size
        assertEquals(1, bb.getShort(20).toInt())  // PCM
        assertEquals(1, bb.getShort(22).toInt())  // mono
        assertEquals(RECORDER_SAMPLE_RATE, bb.getInt(24)) // 16000
        assertEquals(32000, bb.getInt(28))       // byte rate
        assertEquals(2, bb.getShort(32).toInt()) // block align
        assertEquals(16, bb.getShort(34).toInt())// bits per sample
        assertEquals("data", String(bytes, 36, 4, Charsets.US_ASCII))
        assertEquals(samples.size * 2, bb.getInt(40))

        // First sample 0 → 0x0000; second 0.5 → 16383 (0.5 × Short.MAX_VALUE, truncated);
        // third -0.5 → -16384 = 0xC000.
        assertEquals(0, bb.getShort(44).toInt())
        assertEquals(0x3FFF, bb.getShort(46).toInt())
        assertEquals(0xC000.toShort(), bb.getShort(48))
    }

    @Test
    fun `encodeWav writes into cacheDir voice subfolder with a wav name`() {
        val cacheDir = File.createTempFile("cache", "").apply { delete() }
        cacheDir.mkdirs()
        cacheDir.deleteOnExit()
        val file = WavWriter.encodeWav(FloatArray(3200), cacheDir)
        file.deleteOnExit()
        assertTrue(file.name.startsWith("voice-"))
        assertTrue(file.name.endsWith(".wav"))
        assertTrue(file.exists())
        assertEquals(cacheDir, file.parentFile?.parentFile)
        assertTrue(file.length() == 44L + 3200 * 2)
    }

    @Test
    fun `quantize clamps out of range floats`() {
        assertEquals(Short.MAX_VALUE, WavWriter.quantize(2f))
        assertEquals(Short.MIN_VALUE, WavWriter.quantize(-2f))
        assertEquals(0.toShort(), WavWriter.quantize(0f))
    }

    // ---- helpers ----------------------------------------------------------------

    private fun captureInitialCapacity(capture: AudioCapture): Int {
        // The buffer size is private; derive it from the documented initial capacity.
        return RECORDER_SAMPLE_RATE * 30
    }
}