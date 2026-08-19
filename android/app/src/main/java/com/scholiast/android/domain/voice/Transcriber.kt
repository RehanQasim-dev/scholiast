package com.scholiast.android.domain.voice

import java.io.File

/**
 * The speech-to-text contract shared by all transcriber backends.
 *
 * NOTE: This file is owned by Task 10 (`domain/voice/Transcriber.kt` in task-10's task.md).
 * Task 11 created it because it had not landed yet — the signature below is copied verbatim
 * from task-10's task.md. Task 10 should treat this as the agreed contract (edit in place,
 * don't fork).
 */
sealed interface AudioSource {
    /** A 16 kHz mono PCM WAV file (Task 09's [com.scholiast.android.ui.voice.WavWriter] output). */
    data class WavFile(val file: File) : AudioSource

    /** Raw float-normalized samples in [-1, 1) — what Task 09's `VoiceRecorder.stop()` returns. */
    data class FloatSamples(val samples: FloatArray) : AudioSource
}

enum class TranscriptionSource { Groq, Gemini, Local }

/**
 * Typed result: either [text] or a user-facing [error]. `isSuccess` is `error == null`.
 */
data class TranscriptionResult(
    val text: String,
    val source: TranscriptionSource,
    val error: String? = null,
) {
    val isSuccess: Boolean get() = error == null
}

interface Transcriber {
    /**
     * Transcribe [audio] into text. [language] is an ISO-639-1 whisper language code
     * (e.g. "en"); null means auto-detect.
     *
     * Never throws for user-facing failures — returns a [TranscriptionResult] with [error]
     * set. Cancellation of the calling coroutine is propagated (and, for the local engine,
     * triggers a cooperative native abort).
     */
    suspend fun transcribe(audio: AudioSource, language: String?): TranscriptionResult
}