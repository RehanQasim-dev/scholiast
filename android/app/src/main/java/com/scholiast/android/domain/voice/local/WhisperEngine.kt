package com.scholiast.android.domain.voice.local

import java.io.File

/**
 * The inference surface [com.scholiast.android.domain.transcribe.FutoTranscriber] needs from
 * the engine. The production implementation wraps [WhisperGGML] (native); tests inject a fake.
 */
interface WhisperEngine {
    /** Run inference. May throw [InferenceCancelledException] or [BailLanguageException]. */
    suspend fun infer(
        samples: FloatArray,
        prompt: String,
        languages: Array<String>,
        bailLanguages: Array<String>,
        decodingMode: DecodingMode,
        suppressNonSpeechTokens: Boolean,
        partialResultCallback: (String) -> Unit
    ): String

    /** Request a cooperative native abort of any in-flight inference. */
    fun cancel()

    suspend fun close()
}

/** Creates engines for a model. */
fun interface WhisperEngineFactory {
    fun create(model: ModelLoader, manager: ModelManager): WhisperEngine
}

/**
 * Production factory: loads `libscholiast_whisper.so`, opens the model through the shared
 * [ModelManager] (so the cache, the runner and the cancel path all share ONE open engine per
 * model) and wraps it. Throws [UnsatisfiedLinkError] when the .so is missing.
 */
object NativeWhisperEngineFactory : WhisperEngineFactory {
    override fun create(model: ModelLoader, manager: ModelManager): WhisperEngine {
        WhisperGGML.ensureNativeLibraryLoaded()
        val ggml = manager.obtainModel(model)
        return object : WhisperEngine {
            override suspend fun infer(
                samples: FloatArray,
                prompt: String,
                languages: Array<String>,
                bailLanguages: Array<String>,
                decodingMode: DecodingMode,
                suppressNonSpeechTokens: Boolean,
                partialResultCallback: (String) -> Unit
            ): String = ggml.infer(
                samples, prompt, languages, bailLanguages, decodingMode,
                suppressNonSpeechTokens, partialResultCallback
            )

            override fun cancel() = ggml.cancel()

            override suspend fun close() = ggml.close()
        }
    }
}