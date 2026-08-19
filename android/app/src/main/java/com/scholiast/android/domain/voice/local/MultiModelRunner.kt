package com.scholiast.android.domain.voice.local

/** Engine-side inference states, ported from FUTO `types/ModelInferenceCallback.kt`. */
enum class InferenceState {
    ExtractingMel, LoadingModel, Encoding, DecodingLanguage, SwitchingModel, DecodingStarted
}

/** Streamed inference feedback, ported from FUTO `types/ModelInferenceCallback.kt`. */
interface ModelInferenceCallback {
    fun updateStatus(state: InferenceState)
    fun languageDetected(language: Language)
    fun partialResult(string: String)
}

data class MultiModelRunConfiguration(
    val primaryModel: ModelLoader,
    val languageSpecificModels: Map<Language, ModelLoader> = emptyMap()
)

data class DecodingConfiguration(
    val glossary: List<String> = emptyList(),
    val languages: Set<Language> = emptySet(),
    val suppressSymbols: Boolean = true
)

/**
 * Runs inference with cooperative cancellation, ported from FUTO's `whisper/MultiModelRunner.kt`
 * (FUTO Source First License 1.1), slimmed: the language-specific model switch (bail) is
 * dropped for v1 — we have one model per install, so `languageSpecificModels` is always empty
 * and `bailLanguages` stays empty. [BailLanguageException] is still translated to a typed
 * result error by [com.scholiast.android.domain.transcribe.FutoTranscriber].
 *
 * Inference runs on the [WhisperEngine] supplied by the caller (which FutoTranscriber gets from
 * its [WhisperEngineFactory], so JVM tests can inject a fake; the native path loads the model
 * through [ModelManager] when the factory creates the engine). The runner never opens the model
 * itself.
 */
class MultiModelRunner(
    private val modelManager: ModelManager
) {
    suspend fun preload(runConfiguration: MultiModelRunConfiguration) {
        modelManager.obtainModel(runConfiguration.primaryModel)
    }

    @Throws(InferenceCancelledException::class, BailLanguageException::class)
    suspend fun run(
        samples: FloatArray,
        decodingConfiguration: DecodingConfiguration,
        engine: WhisperEngine,
        callback: ModelInferenceCallback
    ): String {
        callback.updateStatus(InferenceState.LoadingModel)

        val allowedLanguages = decodingConfiguration.languages.map { it.toWhisperString() }.toTypedArray()

        val glossary = if (decodingConfiguration.glossary.isNotEmpty()) {
            "(Glossary: " + decodingConfiguration.glossary.joinToString(separator = ", ") + ")"
        } else {
            ""
        }

        callback.updateStatus(InferenceState.Encoding)
        return engine.infer(
            samples = samples,
            prompt = glossary,
            languages = allowedLanguages,
            bailLanguages = arrayOf(),
            decodingMode = DecodingMode.BeamSearch5,
            suppressNonSpeechTokens = decodingConfiguration.suppressSymbols,
            partialResultCallback = { callback.partialResult(it) }
        )
    }

    fun cancelAll() {
        modelManager.cancelAll()
    }
}