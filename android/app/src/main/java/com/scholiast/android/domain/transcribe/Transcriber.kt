package com.scholiast.android.domain.transcribe

import com.scholiast.android.ui.voice.WavWriter
import java.io.File
import java.io.IOException

/**
 * The voice-input layer (plan §5.5.5). One [Transcriber] per backend:
 * [GroqTranscriber] (Whisper), [GeminiTranscriber] (prompt-aware), and a
 * local whisper.cpp implementation (Task 11) that streams partials.
 *
 * ## Contract
 * - All implementations are suspend and cancellation-aware (blocking OkHttp /
 *   native calls run on `Dispatchers.IO`, so cancelling the caller cancels the
 *   request).
 * - [transcribe] never throws for expected failures (network, 401, 429, no
 *   key): those come back as a typed [TranscriptionResult.Failure] the UI can
 *   render (toast / disabled button). Unexpected bugs may still throw.
 * - [onPartial] streams intermediate text. The cloud transcribers call it once
 *   with the final text (they don't stream); the local engine calls it as it
 *   goes. The UI must treat it as best-effort and only trust the returned
 *   result.
 */
interface Transcriber {
    /** Which backend this is — stamped on every result. */
    val source: TranscriberSource

    /**
     * Transcribe [audio]. [language] is the speech-language setting (Groq +
     * local STT; Gemini ignores it — plan §2). Returns the final result; calls
     * [onPartial] with interim text when the backend streams.
     */
    suspend fun transcribe(
        audio: AudioSource,
        language: String?,
        onPartial: (String) -> Unit = {},
    ): TranscriptionResult
}

/**
 * What a transcriber consumes. Task 09's recorder produces float samples
 * (`FloatSamples` — the local STT path); the cloud transcribers need the WAV
 * file (`WavFile`, produced by Task 09's `WavWriter`).
 */
sealed interface AudioSource {
    /** A 16 kHz mono 16-bit PCM WAV file (from `WavWriter.encodeWav`). */
    data class WavFile(val file: File) : AudioSource

    /** Raw float-normalized PCM samples (the recorder's `stop()` array). */
    data class FloatSamples(val samples: FloatArray) : AudioSource
}

/** Which backend produced (or was asked to produce) a transcription. */
enum class TranscriberSource {
    /** Local whisper.cpp engine (Task 11). No key, works offline. */
    LOCAL,

    /** Groq Whisper (`whisper-large-v3-turbo`). */
    GROQ,

    /** Google AI Gemini (`gemini-3.6-flash`), prompt-aware. */
    GEMINI,
}

/**
 * Typed outcome of [Transcriber.transcribe]. The UI renders each case
 * differently: [Success] text becomes the draft verbatim; [Failure] with
 * [TranscriptionError.NOT_CONFIGURED] disables the mic action + toast
 * ("Set up Gemini in Settings"), [NETWORK] shows the offline banner, and
 * 401/429 map to their own messages.
 */
sealed interface TranscriptionResult {
    data class Success(
        val source: TranscriberSource,
        val text: String,
        /** Word/segment timestamps when the backend returned them (Groq
         *  `verbose_json` segments; local STT). Seconds → ms. */
        val timestamps: List<WordTimestamp>? = null,
    ) : TranscriptionResult

    data class Failure(
        val source: TranscriberSource,
        val error: TranscriptionError,
        val message: String,
        val cause: Throwable? = null,
    ) : TranscriptionResult
}

/** A timestamped word/segment. `startMs`/`endMs` are milliseconds. */
data class WordTimestamp(val startMs: Long, val endMs: Long, val text: String)

/** Categorized transcription failure — the user-facing message is [Failure.message]. */
enum class TranscriptionError {
    /** No API key for the backend — the action must be disabled + toast. */
    NOT_CONFIGURED,

    /** No network / timeout / connection refused. */
    NETWORK,

    /** 401 — the stored key was rejected. */
    UNAUTHORIZED,

    /** 429 — quota exhausted. */
    RATE_LIMITED,

    /** 4xx other than 401/429 (bad request, unsupported format). */
    INVALID_REQUEST,

    /** 5xx from the provider. */
    SERVER,

    /** Anything else (bad response body, unexpected error). */
    UNKNOWN,
}

/**
 * Selects the transcriber for a flow (plan §5.5.2): settings preference first,
 * then Gemini (prompt-aware) over Groq when both keys exist, then the local
 * engine as the offline fallback.
 *
 * ```
 * val t = registry.forAddComment() ?: return Failure(NOT_CONFIGURED, ...)
 * ```
 */
class TranscriberRegistry(
    private val settings: SpeechSettings,
    private val groq: Transcriber,
    private val gemini: Transcriber,
    private val local: Transcriber? = null,
) {
    /**
     * The transcriber the add-comment flow should use, or `null` when nothing
     * is configured (the UI disables the mic + "Set up speech in Settings").
     */
    suspend fun forAddComment(): Transcriber? {
        val preferred = settings.preferredTranscriber()
        if (preferred != TranscriberSource.LOCAL && keyFor(preferred) != null) {
            return transcriberFor(preferred)
        }
        // Gemini beats Groq for add-comment when both are configured (plan §2:
        // "if Gemini configured, audio + prompt → Gemini response used directly").
        if (settings.apiKey(Service.GEMINI) != null) return gemini
        if (settings.apiKey(Service.GROQ) != null) return groq
        return local
    }

    /** The transcriber for a specific backend, or `null` if it isn't wired up. */
    fun transcriberFor(source: TranscriberSource): Transcriber? = when (source) {
        TranscriberSource.GROQ -> groq
        TranscriberSource.GEMINI -> gemini
        TranscriberSource.LOCAL -> local
    }

    private suspend fun keyFor(source: TranscriberSource): String? = when (source) {
        TranscriberSource.GROQ -> settings.apiKey(Service.GROQ)
        TranscriberSource.GEMINI -> settings.apiKey(Service.GEMINI)
        TranscriberSource.LOCAL -> null
    }
}

/** A [TranscriptionResult.Failure] for the "nothing configured" case. */
fun notConfigured(source: TranscriberSource, setupMessage: String): TranscriptionResult.Failure =
    TranscriptionResult.Failure(source, TranscriptionError.NOT_CONFIGURED, setupMessage)

/**
 * Materialize [audio] as a WAV file the cloud APIs can upload. `FloatSamples`
 * are encoded via Task 09's [WavWriter] into a temp file in [tmpDir] (default:
 * the JVM temp dir). Returns `null` on encode failure.
 */
internal fun AudioSource.toWavFile(tmpDir: File = File(System.getProperty("java.io.tmpdir"))): File? {
    return when (this) {
        is AudioSource.WavFile -> file
        is AudioSource.FloatSamples -> {
            if (samples.isEmpty()) return null
            try {
                val tmp = File.createTempFile("scholiast-voice", ".wav", tmpDir)
                WavWriter.write(samples, tmp)
                tmp
            } catch (e: IOException) {
                null
            }
        }
    }
}