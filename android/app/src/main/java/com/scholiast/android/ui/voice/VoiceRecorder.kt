package com.scholiast.android.ui.voice

import android.content.Context
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.coroutines.coroutineContext
import kotlin.math.pow
import kotlin.math.sqrt

/**
 * Voice recorder (tap-to-toggle) — Task 09.
 *
 * Ported from the FUTO Keyboard `AudioRecognizer.kt` recording loop (16 kHz mono PCM-16
 * `VOICE_RECOGNITION`, 1600-sample reads, float accumulation, magnitude `1 - 0.1^(24*rms)`,
 * buffer growth +30 s, max ~2 min), minus the VAD / Bluetooth / mic-blocked / model-runner
 * extras. Tap-to-toggle means stopping is explicit.
 *
 * Architecture:
 *  - [AudioCapture] (pure, JVM-testable) — the growing float buffer, RMS magnitude, max-length
 *    guard. No Android dependencies.
 *  - [RecordingDriver] (pure, JVM-testable) — owns the [RecorderState] state machine and feeds
 *    [AudioCapture]. No Android dependencies.
 *  - [AndroidVoiceRecorder] — the thin `AudioRecord` + audio-focus shell that wires a real mic
 *    into the driver. This is the production implementation of the [VoiceRecorder] contract.
 *
 * Contract (see `VoiceRecorder.Interface.md` for the full text used by Tasks 07/10/11):
 *
 * ```
 * interface VoiceRecorder {
 *     val state: StateFlow<RecorderState>
 *     fun start(scope: CoroutineScope)
 *     fun stop(): FloatArray
 *     fun cancel()
 * }
 * ```
 *
 * The sampling format is fixed: 16 kHz, mono, 16-bit signed PCM. `stop()` returns the
 * accumulated samples normalized to floats in [-1, 1). The transcriber layer (Tasks 10/11)
 * consumes the `FloatArray` directly, or calls [WavWriter.encodeWav] to get a WAV file for
 * Groq/Gemini upload.
 */

/** Sample rate the recorder always uses (matches FUTO and the whisper.cpp engine). */
const val RECORDER_SAMPLE_RATE: Int = 16000

/**
 * Recording state machine. `Stopped(samples)` is the terminal "samples are ready" state;
 * `Processing` is set by the owner (the ViewModel) while a transcriber runs, and returns to
 * `Idle` when done. `Error(msg)` carries a user-facing message.
 */
sealed interface RecorderState {
    /** Nothing happening. Tapping starts a recording. */
    data object Idle : RecorderState

    /** Recording in progress. [elapsedMs] is wall-clock mic time, [magnitude] ∈ [0, 1). */
    data class Recording(val elapsedMs: Long, val magnitude: Float) : RecorderState

    /** Recording finished, samples being handed to a transcriber (or discarded). */
    data object Processing : RecorderState

    /** Terminal state: the recording is done and the samples are available. */
    data class Stopped(val samples: FloatArray) : RecorderState

    /** Failure (no permission, mic busy, …). [message] is user-facing. */
    data class Error(val message: String) : RecorderState
}

/** The recorder contract used by Tasks 07/10/11. See `VoiceRecorder.Interface.md`. */
interface VoiceRecorder {
    /** Current recorder state; collect this to drive the mic UI. */
    val state: StateFlow<RecorderState>

    /** Begin recording. Idle/Stopped/Error → Recording. Safe to call when already recording. */
    fun start(scope: CoroutineScope)

    /**
     * Stop recording and return the captured samples (float-normalized, 16 kHz mono).
     * Recording → Stopped(samples). Returns an empty array if not currently recording.
     */
    fun stop(): FloatArray

    /** Discard the current recording and return to Idle. */
    fun cancel()
}

/**
 * Pure growing sample buffer (JVM-testable, no Android deps). Mirrors FUTO's `floatSamples`
 * `FloatBuffer`: starts at [initialCapacity] samples, expands by [growthSamples] when full, and
 * refuses to grow past [maxSamples] (the ~2 min max-length guard → `feed` returns false so the
 * caller auto-stops).
 *
 * Feed it 1600-sample chunks exactly like FUTO's `recordingJob` does.
 */
internal class AudioCapture(
    private val initialCapacity: Int = RECORDER_SAMPLE_RATE * 30,
    private val growthSamples: Int = RECORDER_SAMPLE_RATE * 30,
    private val maxSamples: Int = RECORDER_SAMPLE_RATE * 120,
) {
    private var buffer: FloatArray = FloatArray(initialCapacity)

    /** Current backing-buffer size (grows in +30 s steps). */
    val bufferSize: Int get() = buffer.size

    /** Number of samples accumulated so far. */
    var position: Int = 0
        private set

    /** Magnitude of the most recent chunk: `1 - 0.1^(24*rms)`, ∈ [0, 1). */
    var magnitude: Float = 0f
        private set

    private var closed: Boolean = false

    /** Elapsed recording time derived from the sample count. */
    val elapsedMs: Long get() = position.toLong() * 1000L / RECORDER_SAMPLE_RATE

    /**
     * Append [count] samples from [chunk] (already-scaled by [normalizeSample] on write).
     * Returns `false` when appending would exceed [maxSamples] (auto-stop signal); the buffer is
     * left untouched in that case. Returns `false` after [close] too.
     */
    @Synchronized
    fun feed(chunk: ShortArray, count: Int): Boolean {
        if (closed || count <= 0) return false
        if (position + count > maxSamples) return false
        if (position + count > buffer.size) {
            buffer = buffer.copyOf(buffer.size + growthSamples)
        }
        for (i in 0 until count) {
            buffer[position + i] = normalizeSample(chunk[i])
        }
        position += count
        magnitude = computeMagnitude(chunk, count)
        return true
    }

    /** A copy of the accumulated samples — the `FloatArray` handed to the transcriber. */
    @Synchronized
    fun snapshot(): FloatArray = buffer.copyOf(position)

    /** Stop accepting writes; guards the snapshot in `stop()` against a racing feed. */
    @Synchronized
    fun close() {
        closed = true
    }

    /** Clear the buffer and reopen it for the next recording. */
    @Synchronized
    fun reset() {
        buffer = FloatArray(initialCapacity)
        position = 0
        magnitude = 0f
        closed = false
    }

    companion object {
        /** Normalize a 16-bit PCM sample to a float in [-1, 1). */
        fun normalizeSample(sample: Short): Float = sample.toFloat() / Short.MAX_VALUE.toFloat()

        /**
         * RMS magnitude of a chunk, mapped through FUTO's curve `1 - 0.1^(24*rms)`.
         * Ported verbatim from `AudioRecognizer.recordingJob` (uses the actual read count, not
         * the fixed chunk size, which FUTO uses; identical for full reads).
         */
        fun computeMagnitude(chunk: ShortArray, count: Int): Float {
            if (count <= 0) return 0f
            var sumSquares = 0.0
            for (i in 0 until count) {
                val f = normalizeSample(chunk[i])
                sumSquares += f.toDouble() * f.toDouble()
            }
            val rms = sqrt(sumSquares / count).toFloat()
            return 1.0f - 0.1f.pow(24.0f * rms)
        }
    }
}

/**
 * Pure state machine driving [AudioCapture] (JVM-testable, no Android deps). The Android
 * recorder shell feeds it chunks and reads [state]. Transitions:
 *
 *   Idle ──begin──▶ Recording ──finish──▶ Stopped(samples)
 *     ▲              │  │                   │
 *     └──────────────┘  └──cancel──▶ Idle   └──markProcessing──▶ Processing ──complete──▶ Idle
 *   any ──fail──▶ Error ──begin──▶ Recording
 *
 * `begin`/`finish`/`cancel`/`fail` are thread-safe against the feed loop via [AudioCapture]'s
 * lock plus the state guard.
 */
internal class RecordingDriver(
    private val capture: AudioCapture = AudioCapture(),
) {
    private val _state = MutableStateFlow<RecorderState>(RecorderState.Idle)
    val state: StateFlow<RecorderState> = _state.asStateFlow()

    /** True if currently in the Recording state. */
    val isRecording: Boolean get() = _state.value is RecorderState.Recording

    /** Idle/Stopped/Error → Recording. Returns false if already recording (no-op). */
    @Synchronized
    fun begin(): Boolean {
        if (isRecording) return false
        capture.reset()
        _state.value = RecorderState.Recording(0L, 0f)
        return true
    }

    /**
     * Feed one read chunk into the buffer and refresh the Recording state's elapsed/magnitude.
     * Returns `false` when the max-length guard triggers (buffer would overflow) — the caller
     * should auto-stop.
     */
    @Synchronized
    fun feed(chunk: ShortArray, count: Int): Boolean {
        if (_state.value !is RecorderState.Recording) return false
        val ok = capture.feed(chunk, count)
        if (_state.value is RecorderState.Recording) {
            _state.value = RecorderState.Recording(capture.elapsedMs, capture.magnitude)
        }
        return ok
    }

    /** Recording → Stopped(samples). Returns the samples (empty if not recording). */
    @Synchronized
    fun finish(): FloatArray {
        val samples = if (isRecording) capture.snapshot() else FloatArray(0)
        _state.value = RecorderState.Stopped(samples)
        return samples
    }

    /** Recording → Idle, discarding samples. */
    @Synchronized
    fun cancel() {
        capture.reset()
        _state.value = RecorderState.Idle
    }

    /** Stopped → Processing (transcriber running). No-op from any other state. */
    @Synchronized
    fun markProcessing() {
        if (_state.value is RecorderState.Stopped) {
            _state.value = RecorderState.Processing
        }
    }

    /** Processing → Idle (transcriber done, ready for the next recording). */
    @Synchronized
    fun complete() {
        if (_state.value is RecorderState.Processing) {
            capture.reset()
            _state.value = RecorderState.Idle
        }
    }

    /** Any state → Error(msg), discarding samples. */
    @Synchronized
    fun fail(message: String) {
        capture.reset()
        _state.value = RecorderState.Error(message)
    }
}

/**
 * Production recorder: an `AudioRecord` (16 kHz mono PCM-16, `VOICE_RECOGNITION`) streaming into
 * a [RecordingDriver]. Owns audio focus (`GAIN_TRANSIENT_EXCLUSIVE`, so the lecture video keeps
 * playing normally afterwards) and the recording coroutine.
 *
 * The read loop is a faithful port of FUTO's `recordingJob`: blocking 1600-sample reads, float
 * accumulation with +30 s buffer growth, magnitude `1 - 0.1^(24*rms)`, and a cooperative stop
 * check after every read. The non-blocking catch-up drain is kept (drains whatever is buffered
 * after a slow consumer). VAD, Bluetooth SCO and mic-blocked detection are intentionally dropped.
 */
class AndroidVoiceRecorder private constructor(
    private val driver: RecordingDriver,
    context: Context,
) : VoiceRecorder {

    internal constructor(context: Context) : this(RecordingDriver(), context)

    override val state: StateFlow<RecorderState> get() = driver.state

    private val appContext = context.applicationContext
    private val audioManager = appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    private var audioRecord: AudioRecord? = null
    private var recorderJob: Job? = null
    private var focusRequest: AudioFocusRequest? = null
    private var autoStopped: Boolean = false

    /** True when the last [stop] was forced by the 2-minute max-length guard (friendly toast). */
    val lastStopWasAuto: Boolean get() = autoStopped

    override fun start(scope: CoroutineScope) {
        if (!driver.begin()) return

        autoStopped = false
        requestAudioFocus()

        val record = try {
            createAudioRecord()
        } catch (e: SecurityException) {
            driver.fail("Microphone permission was revoked. Grant it in Settings and try again.")
            abandonAudioFocus()
            return
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start AudioRecord", e)
            driver.fail("Could not open the microphone. It may be in use by another app.")
            abandonAudioFocus()
            return
        }

        record.startRecording()
        audioRecord = record

        recorderJob = scope.launch(kotlinx.coroutines.Dispatchers.IO) {
            readLoop(record)
        }
    }

    override fun stop(): FloatArray {
        if (!driver.isRecording) return FloatArray(0)
        return stopInternal()
    }

    override fun cancel() {
        teardownHardware()
        driver.cancel()
    }

    /** Move to Processing (transcriber running) — delegates to the driver. */
    fun markProcessing() = driver.markProcessing()

    /** Return to Idle after a transcribe round — delegates to the driver. */
    fun complete() = driver.complete()

    /** Any state → Error(msg), discarding samples (permission denied, mic busy, …). */
    fun fail(message: String) = driver.fail(message)

    /** Drop everything: release the mic, abandon focus, back to Idle. */
    fun release() {
        teardownHardware()
        driver.cancel()
        abandonAudioFocus()
    }

    private fun stopInternal(): FloatArray {
        teardownHardware()
        return driver.finish()
    }

    /** Stop the read loop and release the hardware, but leave the samples intact. */
    private fun teardownHardware() {
        recorderJob?.cancel()
        recorderJob = null
        try {
            audioRecord?.stop()
        } catch (_: Exception) {
            // Already stopped / never started.
        }
        audioRecord?.release()
        audioRecord = null
        abandonAudioFocus()
    }

    private suspend fun readLoop(record: AudioRecord) {
        val chunk = ShortArray(READ_CHUNK_SIZE)
        while (coroutineContext.isActive) {
            val nRead = record.read(chunk, 0, READ_CHUNK_SIZE, AudioRecord.READ_BLOCKING)
            if (nRead <= 0) break
            if (!driver.feed(chunk, nRead)) {
                // Max-length guard hit — auto-stop with a friendly cutoff.
                autoStopped = true
                stopInternal()
                return
            }
            drainBuffered(record, chunk)
        }
    }

    /**
     * FUTO's catch-up drain: after a slow consumer, read whatever else is buffered
     * non-blocking so we never fall behind the mic.
     */
    private suspend fun drainBuffered(record: AudioRecord, chunk: ShortArray) {
        while (coroutineContext.isActive) {
            val nRead = record.read(chunk, 0, READ_CHUNK_SIZE, AudioRecord.READ_NON_BLOCKING)
            if (nRead <= 0) break
            if (!driver.feed(chunk, nRead)) {
                autoStopped = true
                stopInternal()
                return
            }
        }
    }

    private fun createAudioRecord(): AudioRecord {
        // 5 s of 16 kHz mono PCM-16 (FUTO's size), never below the device's reported minimum.
        val minBufferSize = AudioRecord.getMinBufferSize(
            RECORDER_SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        val bufferSize = maxOf(RECORDER_SAMPLE_RATE * 2 * 5, minBufferSize)
        val record = AudioRecord(
            MediaRecorder.AudioSource.VOICE_RECOGNITION,
            RECORDER_SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufferSize,
        )
        if (record.state != AudioRecord.STATE_INITIALIZED) {
            throw IllegalStateException("AudioRecord failed to initialize")
        }
        return record
    }

    /**
     * Ported from FUTO's `focusAudio`/`unfocusAudio`: transient-exclusive focus so the user's
     * video/audio ducks only while recording, then plays normally again. API 30 min, so the
     * API-26 `AudioFocusRequest` needs no SDK guard.
     */
    private fun requestAudioFocus() {
        focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
            .build()
        audioManager.requestAudioFocus(focusRequest!!)
    }

    private fun abandonAudioFocus() {
        focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
        focusRequest = null
    }

    private companion object {
        const val TAG = "VoiceRecorder"
        const val READ_CHUNK_SIZE: Int = 1600
    }
}

/**
 * Pure WAV encoder (JVM-testable, no Android deps): 16 kHz mono 16-bit signed PCM little-endian
 * WAV. Used by Task 10's Groq/Gemini path (they need a file upload); the local STT path consumes
 * the raw [FloatArray] instead.
 *
 * Expected call from Android: `WavWriter.encodeWav(samples, File(context.cacheDir, "voice"))`.
 */
object WavWriter {

    const val SAMPLE_RATE: Int = RECORDER_SAMPLE_RATE

    /** Convenience: write to `cacheDir/voice/<timestamp>.wav` and return the file. */
    fun encodeWav(samples: FloatArray, cacheDir: java.io.File): java.io.File {
        val voiceDir = java.io.File(cacheDir, "voice").apply { mkdirs() }
        val file = java.io.File(voiceDir, "voice-${System.currentTimeMillis()}.wav")
        write(samples, file)
        return file
    }

    /** Write [samples] (float-normalized in [-1, 1)) as a 16-bit PCM WAV to [file]. */
    fun write(samples: FloatArray, file: java.io.File) {
        file.parentFile?.mkdirs()
        java.io.FileOutputStream(file).use { out ->
            val dataSize = samples.size * 2
            val byteRate = SAMPLE_RATE * 2
            val header = java.nio.ByteBuffer.allocate(44).order(java.nio.ByteOrder.LITTLE_ENDIAN)
            header.put("RIFF".toByteArray(Charsets.US_ASCII))
            header.putInt(36 + dataSize)
            header.put("WAVE".toByteArray(Charsets.US_ASCII))
            header.put("fmt ".toByteArray(Charsets.US_ASCII))
            header.putInt(16)                    // fmt chunk size
            header.putShort(1)                   // PCM
            header.putShort(1)                   // mono
            header.putInt(SAMPLE_RATE)
            header.putInt(byteRate)
            header.putShort(2)                   // block align
            header.putShort(16)                  // bits per sample
            header.put("data".toByteArray(Charsets.US_ASCII))
            header.putInt(dataSize)
            out.write(header.array())

            val pcm = java.nio.ByteBuffer.allocate(dataSize).order(java.nio.ByteOrder.LITTLE_ENDIAN)
            for (sample in samples) {
                pcm.putShort(quantize(sample))
            }
            out.write(pcm.array())
        }
    }

    /** Float [-1, 1) → 16-bit signed PCM, clamped. */
    fun quantize(sample: Float): Short {
        val clamped = sample.coerceIn(-1f, 1f)
        val scaled = if (clamped >= 0f) clamped * Short.MAX_VALUE else clamped * -Short.MIN_VALUE.toFloat()
        return scaled.toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
    }
}