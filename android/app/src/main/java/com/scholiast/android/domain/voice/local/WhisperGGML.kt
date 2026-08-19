package com.scholiast.android.domain.voice.local

import androidx.annotation.Keep
import java.nio.Buffer
import kotlinx.coroutines.withContext

@OptIn(kotlinx.coroutines.DelicateCoroutinesApi::class)
val inferenceContext = kotlinx.coroutines.newSingleThreadContext("whisper-ggml-inference")

enum class DecodingMode(val value: Int) {
    Greedy(0),
    BeamSearch5(5)
}

class BailLanguageException(val language: String) : Exception()
class InferenceCancelledException : Exception()
class InvalidModelException : Exception("The Whisper model could not be loaded from the given buffer")

/**
 * Thin JNI wrapper around the vendored whisper.cpp engine (`libscholiast_whisper.so`).
 *
 * Ported from the FUTO Keyboard's `WhisperGGML.kt` (FUTO Source First License 1.1). The
 * native classpath string in `app/src/main/cpp/org_futo_voiceinput_WhisperGGML.cpp` matches
 * this package/class name.
 *
 * The model must be a direct [MappedByteBuffer] (mmap'd via `FileChannel.map`, or an asset's
 * `openFd`) — the JNI only supports `whisper_init_from_buffer_with_params`.
 *
 * All inference is confined to [inferenceContext] (single thread); never call the externals
 * off that thread.
 */
@Keep
class WhisperGGML(
    modelBuffer: Buffer
) {
    private var handle: Long = 0L

    init {
        ensureNativeLibraryLoaded()
        handle = openFromBufferNative(modelBuffer)
        if (handle == 0L) {
            throw InvalidModelException()
        }
    }

    private var partialResultCallback: (String) -> Unit = { }

    @Keep
    private fun invokePartialResult(text: String) {
        partialResultCallback(text.trim())
    }

    /**
     * Run `whisper_full` on CPU. `languages` empty = autodetect; 1 language = force it;
     * 2+ = autodetect among them. Cancels cooperatively via [cancel] (native abort callback).
     */
    @Throws(BailLanguageException::class, InferenceCancelledException::class)
    suspend fun infer(
        samples: FloatArray,
        prompt: String,
        languages: Array<String>,
        bailLanguages: Array<String>,
        decodingMode: DecodingMode,
        suppressNonSpeechTokens: Boolean,
        partialResultCallback: (String) -> Unit
    ): String = withContext(inferenceContext) {
        if (handle == 0L) {
            throw IllegalStateException("WhisperGGML has already been closed, cannot infer")
        }
        this@WhisperGGML.partialResultCallback = partialResultCallback

        val result = inferNative(handle, samples, prompt, languages, bailLanguages, decodingMode.value, suppressNonSpeechTokens).trim()

        if (result.contains("<>CANCELLED<>")) {
            if (result.contains("flag")) {
                throw InferenceCancelledException()
            } else if (result.contains("lang=")) {
                val language = result.split("lang=")[1]
                throw BailLanguageException(language)
            } else {
                throw IllegalStateException("Cancelled for unknown reason")
            }
        } else {
            return@withContext result
        }
    }

    /** Set the native abort flag — the running `whisper_full` stops at the next check. */
    fun cancel() {
        if (handle == 0L) return
        cancelNative(handle)
    }

    suspend fun close() = withContext(inferenceContext) {
        if (handle != 0L) {
            closeNative(handle)
        }
        handle = 0L
    }

    private external fun openNative(path: String): Long
    private external fun openFromBufferNative(buffer: Buffer): Long
    private external fun inferNative(handle: Long, samples: FloatArray, prompt: String, languages: Array<String>, bailLanguages: Array<String>, decodingMode: Int, suppressNonSpeechTokens: Boolean): String
    private external fun cancelNative(handle: Long)
    private external fun closeNative(handle: Long)

    companion object {
        @Volatile
        private var loaded = false

        /** Load `libscholiast_whisper.so` once; the JNI_OnLoad registers our native methods. */
        fun ensureNativeLibraryLoaded() {
            if (loaded) return
            synchronized(this) {
                if (loaded) return
                System.loadLibrary("scholiast_whisper")
                loaded = true
            }
        }
    }
}