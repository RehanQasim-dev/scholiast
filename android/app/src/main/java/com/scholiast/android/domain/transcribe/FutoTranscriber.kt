package com.scholiast.android.domain.transcribe

import com.scholiast.android.domain.transcribe.TranscriptionError.INVALID_REQUEST
import com.scholiast.android.domain.transcribe.TranscriptionError.NOT_CONFIGURED
import com.scholiast.android.domain.transcribe.TranscriptionError.UNKNOWN
import com.scholiast.android.domain.transcribe.TranscriptionResult.Failure
import com.scholiast.android.domain.transcribe.TranscriptionResult.Success
import com.scholiast.android.domain.voice.local.BailLanguageException
import com.scholiast.android.domain.voice.local.DecodingConfiguration
import com.scholiast.android.domain.voice.local.DEFAULT_MODEL
import com.scholiast.android.domain.voice.local.InferenceCancelledException
import com.scholiast.android.domain.voice.local.InferenceState
import com.scholiast.android.domain.voice.local.InvalidModelException
import com.scholiast.android.domain.voice.local.Language
import com.scholiast.android.domain.voice.local.ModelInferenceCallback
import com.scholiast.android.domain.voice.local.ModelLoader
import com.scholiast.android.domain.voice.local.ModelManager
import com.scholiast.android.domain.voice.local.MultiModelRunner
import com.scholiast.android.domain.voice.local.NativeWhisperEngineFactory
import com.scholiast.android.domain.voice.local.WavDecoder
import com.scholiast.android.domain.voice.local.WhisperEngineFactory
import com.scholiast.android.domain.voice.local.getLanguageFromWhisperString
import com.scholiast.android.domain.voice.local.isBlankResult
import java.io.File
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/**
 * The offline whisper.cpp transcriber — the `LocalSTTTranscriber` from the plan (§5.5.4/4a),
 * implementing Task 10's [Transcriber] interface.
 *
 * - Loads a model from [modelsDir] (`context.filesDir/models/`; the catalogue + downloader
 *   live in `domain/voice/local/Models.kt` / `ModelDownloader.kt`).
 * - Runs `whisper_full` on CPU, BeamSearch5, partial results streamed through [Transcriber.transcribe]'s
 *   `onPartial` (blank-result engine outputs are filtered, like the FUTO keyboard).
 * - Cooperative cancellation: cancelling the calling coroutine triggers a native abort
 *   (the abort callback stops `whisper_full`), then the call returns early as a
 *   [CancellationException]. [cancel] does the same for UI-driven stops (Task 09's flow).
 *   Offline-safe — no network at inference time.
 *
 * Engine access goes through [WhisperEngineFactory] so JVM tests can inject a fake
 * (the native `libscholiast_whisper.so` cannot run in unit tests).
 */
class FutoTranscriber(
    private val modelsDir: File,
    private val model: ModelLoader = DEFAULT_MODEL,
    private val engineFactory: WhisperEngineFactory = NativeWhisperEngineFactory,
    private val onState: (InferenceStateUi) -> Unit = {},
) : Transcriber {

    /** UI-facing engine phases (Settings/editor can surface "Loading model… / Transcribing…"). */
    enum class InferenceStateUi { LoadingModel, Encoding, Decoding, Done }

    override val source: TranscriberSource = TranscriberSource.LOCAL

    private val modelManager = ModelManager(modelsDir)
    private val runner = MultiModelRunner(modelManager)

    /**
     * True once the native library has loaded in this instance. Exposed so Settings can show
     * "engine available" without a model; false with a downloaded model means unsupported device.
     */
    var nativeLibraryLoaded: Boolean = false
        private set

    // Opt-in to the `onCancelling` overload of `Job.invokeOnCompletion` (marked
    // @InternalCoroutinesApi since kotlinx-coroutines 1.10): there is no public API that
    // fires a handler when a job STARTS cancelling, and we need exactly that so the abort
    // reaches the native engine while inference is still in-flight (see below).
    @OptIn(kotlinx.coroutines.InternalCoroutinesApi::class)
    override suspend fun transcribe(
        audio: AudioSource,
        language: String?,
        onPartial: (String) -> Unit,
    ): TranscriptionResult {
        try {
            coroutineContext.ensureActive()

            val samples = when (audio) {
                is AudioSource.WavFile -> WavDecoder.decode(audio.file)
                is AudioSource.FloatSamples -> audio.samples
            }
            if (samples.isEmpty()) {
                return Success(source, "")
            }

            if (!model.exists(modelsDir)) {
                return Failure(
                    source, NOT_CONFIGURED,
                    "The local STT model (${model.name}) is not downloaded. " +
                        "Download it in Settings → Speech."
                )
            }

            // Load the native lib (via the native factory) up-front so a missing .so is a
            // typed failure, not a crash.
            val engine = try {
                engineFactory.create(model, modelManager).also {
                    if (engineFactory === NativeWhisperEngineFactory) nativeLibraryLoaded = true
                }
            } catch (e: UnsatisfiedLinkError) {
                return Failure(
                    source, UNKNOWN,
                    "The local speech engine could not be loaded on this device.", e
                )
            }

            val job = coroutineContext[Job]
            // Cooperative abort: when the caller's coroutine is cancelled, tell the native
            // engine to stop. Must fire on the Cancelling transition, not on full completion:
            // inference runs inside `withContext(NonCancellable)`, so the job never reaches the
            // completed state until infer returns — with the default `onCancelling=false` the
            // abort would never fire while inference is in-flight. whisper_full returns
            // "<>CANCELLED<> flag" → InferenceCancelledException, translated below into a
            // CancellationException.
            job?.invokeOnCompletion(onCancelling = true, invokeImmediately = true) { cause ->
                if (cause is CancellationException) engine.cancel()
            }

            val text = try {
                onState(InferenceStateUi.LoadingModel)
                withContext(NonCancellable) {
                    runner.run(
                        samples,
                        DecodingConfiguration(
                            languages = languageToLanguages(language),
                            suppressSymbols = true,
                        ),
                        engine,
                        inferenceCallback(onPartial)
                    )
                }
            } catch (e: InferenceCancelledException) {
                throw CancellationException("Local STT cancelled", e)
            } catch (e: BailLanguageException) {
                return Failure(
                    source, INVALID_REQUEST,
                    "The recording was not in the selected language (${e.language})."
                )
            } finally {
                onState(InferenceStateUi.Done)
            }

            return Success(
                source = source,
                text = if (isBlankResult(text)) "" else text.trim(),
                timestamps = null, // the FUTO engine returns plain text, no segment times
            )
        } catch (e: InvalidModelException) {
            return Failure(
                source, INVALID_REQUEST,
                "The local STT model file is invalid or corrupt. Re-download it in Settings.", e
            )
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            return Failure(
                source, UNKNOWN,
                "Local speech failed: ${e.message ?: "unknown error"}", e
            )
        }
    }

    /** Cancel any in-flight inference (native abort) — wired to Task 09's stop/cancel UI. */
    fun cancel() {
        modelManager.cancelAll()
    }

    private fun inferenceCallback(onPartial: (String) -> Unit): ModelInferenceCallback =
        object : ModelInferenceCallback {
            override fun updateStatus(state: InferenceState) {
                onState(
                    when (state) {
                        InferenceState.LoadingModel -> InferenceStateUi.LoadingModel
                        InferenceState.Encoding -> InferenceStateUi.Encoding
                        else -> InferenceStateUi.Decoding
                    }
                )
            }

            override fun languageDetected(language: Language) {}

            override fun partialResult(string: String) {
                val trimmed = string.trim()
                if (!isBlankResult(trimmed)) onPartial(trimmed)
            }
        }

    /** A recognized whisper language string forces it; anything else → auto-detect. */
    private fun languageToLanguages(language: String?): Set<Language> {
        if (language.isNullOrBlank()) return emptySet()
        return getLanguageFromWhisperString(language.lowercase())?.let { setOf(it) } ?: emptySet()
    }
}