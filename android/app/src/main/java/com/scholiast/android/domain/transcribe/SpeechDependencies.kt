package com.scholiast.android.domain.transcribe

import android.content.Context
import com.scholiast.android.domain.voice.local.DEFAULT_MODEL
import com.scholiast.android.domain.voice.local.ENGLISH_MODELS
import com.scholiast.android.domain.voice.local.ModelFileFile
import com.scholiast.android.domain.voice.local.ModelLoader
import com.scholiast.android.ui.settings.AppSettings
import com.scholiast.android.ui.settings.SettingsPrefs
import java.io.File
import kotlinx.coroutines.runBlocking

/**
 * The app's single seam between settings and the speech pipeline (Task 19 hand-off):
 * builds the [TranscriberRegistry] every consumer uses, resolving the **active local
 * STT model** from Settings so the local engine transcribes with the file the user
 * picked — not the hardcoded default.
 *
 * Registry is cached per process and invalidated whenever settings change
 * (SettingsViewModel calls [invalidate]); the transcribers themselves read live
 * values (keys, models, prompts) from [AppSettings] on every call, so the cache
 * only pins the wiring, never the values.
 */
object SpeechDependencies {

    @Volatile
    private var cachedRegistry: TranscriberRegistry? = null

    @Volatile
    private var cachedSettings: AppSettings? = null

    /** The app's models dir — must match Settings' `stt_models`. */
    fun modelsDir(context: Context): File =
        File(context.filesDir, "stt_models")

    /** Drop the cached registry so the next call rebuilds with fresh wiring. */
    fun invalidate() {
        cachedRegistry = null
    }

    /**
     * The settings instance the registry reads from — shared, loaded once, so
     * the bridge can ask for the current speech language for the transcription.
     */
    fun settings(context: Context): AppSettings =
        cachedSettings ?: synchronized(this) {
            cachedSettings ?: SettingsPrefs(context).also { prefs ->
                runBlocking { prefs.load() }
            }.also { cachedSettings = it }
        }

    /**
     * The registry for the add-comment flow. Local engine is built over the
     * active STT model ([AppSettings.activeSttModel] → [ModelFileFile] when the
     * file exists; falls back to the first installed catalogue model, then the
     * default). Cloud transcribers read their keys/models live per call.
     */
    fun registry(context: Context): TranscriberRegistry =
        cachedRegistry ?: synchronized(this) {
            cachedRegistry ?: buildRegistry(context).also { cachedRegistry = it }
        }

    /**
     * Resolve which [ModelLoader] the local engine should run:
     * 1. The active model file the user imported/activated (exists on disk).
     * 2. The first catalogue model that is installed.
     * 3. [DEFAULT_MODEL] (tiny-en; FutoTranscriber surfaces "not downloaded").
     */
    fun activeLocalModel(settings: AppSettings, modelsDir: File): ModelLoader {
        settings.activeSttModel()?.let { name ->
            val file = File(modelsDir, name)
            if (file.isFile) return ModelFileFile(name, file)
        }
        ENGLISH_MODELS.firstOrNull { it.exists(modelsDir) }?.let { return it }
        return DEFAULT_MODEL
    }

    private fun buildRegistry(context: Context): TranscriberRegistry {
        val settings = settings(context)
        return TranscriberRegistry(
            settings = settings,
            groq = GroqTranscriber(settings),
            gemini = GeminiTranscriber(settings),
            local = FutoTranscriber(
                modelsDir = modelsDir(context),
                model = activeLocalModel(settings, modelsDir(context)),
            ),
        )
    }
}