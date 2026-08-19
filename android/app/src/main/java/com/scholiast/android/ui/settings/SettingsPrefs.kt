package com.scholiast.android.ui.settings

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.scholiast.android.domain.sync.drive.KeystoreKeyProvider
import com.scholiast.android.domain.transcribe.Service
import com.scholiast.android.domain.transcribe.SpeechSettings
import com.scholiast.android.domain.transcribe.TranscriberSource
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.settingsDataStore by preferencesDataStore(name = "scholiast_settings")

/**
 * The app's full settings surface (Task 19): non-secrets in DataStore, secrets in
 * the Keystore via the app-wide [KeystoreKeyProvider], implementing Task 10's
 * [SpeechSettings] so the transcribers read live values.
 *
 * Values are cached in memory once [load] has run (the VM calls it at start);
 * every setter writes through to DataStore AND updates the cache, so a getter
 * after any write returns the new value without another disk read.
 */
class SettingsPrefs(private val context: Context) : AppSettings {

    private val keyProvider = KeystoreKeyProvider.unlockForApp(context)

    // In-memory cache; seeded by load(), kept in sync by every setter.
    private var groqModel: String = SpeechSettings.DEFAULT_GROQ_MODEL
    private var geminiModel: String = SpeechSettings.DEFAULT_GEMINI_MODEL
    private var gemmaModel: String = DEFAULT_GEMMA_MODEL
    private var addPrompt: String = SpeechSettings.DEFAULT_ADD_COMMENT_PROMPT
    private var editPrompt: String = SpeechSettings.DEFAULT_EDIT_COMMENT_PROMPT
    private var speechLanguage: String? = null
    private var preferred: TranscriberSource = TranscriberSource.LOCAL
    private var seekStepSeconds: Int = DEFAULT_SEEK_STEP_SECONDS
    private var defaultSpeed: Float = DEFAULT_SPEED
    private var dynamicTheme: Boolean = true
    private var loaded = false

    /** Read the persisted values once. Idempotent; safe to call on every start. */
    suspend fun load() {
        if (loaded) return
        val prefs = context.settingsDataStore.data.first()
        groqModel = prefs[K_GROQ_MODEL] ?: SpeechSettings.DEFAULT_GROQ_MODEL
        geminiModel = prefs[K_GEMINI_MODEL] ?: SpeechSettings.DEFAULT_GEMINI_MODEL
        gemmaModel = prefs[K_GEMMA_MODEL] ?: DEFAULT_GEMMA_MODEL
        addPrompt = prefs[K_ADD_PROMPT] ?: SpeechSettings.DEFAULT_ADD_COMMENT_PROMPT
        editPrompt = prefs[K_EDIT_PROMPT] ?: SpeechSettings.DEFAULT_EDIT_COMMENT_PROMPT
        speechLanguage = prefs[K_SPEECH_LANGUAGE]
        preferred = prefs[K_PREFERRED_TRANSCRIBER]
            ?.let { runCatching { TranscriberSource.valueOf(it) }.getOrNull() }
            ?: TranscriberSource.LOCAL
        seekStepSeconds = prefs[K_SEEK_STEP] ?: DEFAULT_SEEK_STEP_SECONDS
        defaultSpeed = prefs[K_DEFAULT_SPEED] ?: DEFAULT_SPEED
        dynamicTheme = prefs[K_DYNAMIC_THEME] ?: true
        loaded = true
    }

    /** True once [load] has read the persisted values. */
    fun isLoaded(): Boolean = loaded

    override suspend fun apiKey(service: Service): String? = keyProvider.apiKey(service)

    override fun groqModel(): String = groqModel
    override fun geminiModel(): String = geminiModel
    override fun gemmaModel(): String = gemmaModel
    override fun addCommentPrompt(): String = addPrompt
    override fun editCommentPrompt(): String = editPrompt
    override fun speechLanguage(): String? = speechLanguage
    override fun preferredTranscriber(): TranscriberSource = preferred
    override fun seekStepSeconds(): Int = seekStepSeconds
    override fun defaultPlaybackSpeed(): Float = defaultSpeed
    override fun dynamicTheme(): Boolean = dynamicTheme

    override suspend fun setGroqKey(key: String?) = keyProvider.setKey(Service.GROQ, key)
    override suspend fun setGeminiKey(key: String?) = keyProvider.setKey(Service.GEMINI, key)
    override suspend fun setGemmaKey(key: String?) = keyProvider.setKey(Service.GEMMA, key)

    /** Set (or clear, with null) the stored key for [service] (Groq/Gemini/Gemma). */
    override suspend fun setKey(service: Service, key: String?) = keyProvider.setKey(service, key)

    override suspend fun setGroqModel(model: String) = write(K_GROQ_MODEL, model) { groqModel = it }
    override suspend fun setGeminiModel(model: String) = write(K_GEMINI_MODEL, model) { geminiModel = it }
    override suspend fun setGemmaModel(model: String) = write(K_GEMMA_MODEL, model) { gemmaModel = it }
    override suspend fun setAddCommentPrompt(prompt: String) = write(K_ADD_PROMPT, prompt) { addPrompt = it }
    override suspend fun setEditCommentPrompt(prompt: String) = write(K_EDIT_PROMPT, prompt) { editPrompt = it }

    override suspend fun setSpeechLanguage(lang: String?) = writeNullable(K_SPEECH_LANGUAGE, lang) {
        speechLanguage = it
    }

    override suspend fun setPreferredTranscriber(source: TranscriberSource) {
        context.settingsDataStore.edit { it[K_PREFERRED_TRANSCRIBER] = source.name }
        preferred = source
    }

    override suspend fun setSeekStepSeconds(seconds: Int) = write(K_SEEK_STEP, seconds) { seekStepSeconds = it }
    override suspend fun setDefaultPlaybackSpeed(speed: Float) = write(K_DEFAULT_SPEED, speed) { defaultSpeed = it }
    override suspend fun setDynamicTheme(dynamic: Boolean) = write(K_DYNAMIC_THEME, dynamic) { dynamicTheme = it }

    private suspend fun write(key: androidx.datastore.preferences.core.Preferences.Key<String>, value: String, cache: (String) -> Unit) {
        context.settingsDataStore.edit { it[key] = value }
        cache(value)
    }

    private suspend fun write(key: androidx.datastore.preferences.core.Preferences.Key<Int>, value: Int, cache: (Int) -> Unit) {
        context.settingsDataStore.edit { it[key] = value }
        cache(value)
    }

    private suspend fun write(key: androidx.datastore.preferences.core.Preferences.Key<Float>, value: Float, cache: (Float) -> Unit) {
        context.settingsDataStore.edit { it[key] = value }
        cache(value)
    }

    private suspend fun write(key: androidx.datastore.preferences.core.Preferences.Key<Boolean>, value: Boolean, cache: (Boolean) -> Unit) {
        context.settingsDataStore.edit { it[key] = value }
        cache(value)
    }

    private suspend fun writeNullable(key: androidx.datastore.preferences.core.Preferences.Key<String>, value: String?, cache: (String?) -> Unit) {
        context.settingsDataStore.edit { if (value == null) it.remove(key) else it[key] = value }
        cache(value)
    }

    companion object {
        const val DEFAULT_GEMMA_MODEL: String = "gemma-4-31b-it"
        const val DEFAULT_SEEK_STEP_SECONDS: Int = 15
        const val DEFAULT_SPEED: Float = 1.0f

        private val K_GROQ_MODEL = stringPreferencesKey("groq_model")
        private val K_GEMINI_MODEL = stringPreferencesKey("gemini_model")
        private val K_GEMMA_MODEL = stringPreferencesKey("gemma_model")
        private val K_ADD_PROMPT = stringPreferencesKey("add_comment_prompt")
        private val K_EDIT_PROMPT = stringPreferencesKey("edit_comment_prompt")
        private val K_SPEECH_LANGUAGE = stringPreferencesKey("speech_language")
        private val K_PREFERRED_TRANSCRIBER = stringPreferencesKey("preferred_transcriber")
        private val K_SEEK_STEP = intPreferencesKey("seek_step_seconds")
        private val K_DEFAULT_SPEED = floatPreferencesKey("default_speed")
        private val K_DYNAMIC_THEME = booleanPreferencesKey("dynamic_theme")
    }
}

/**
 * The settings contract the ViewModel and the UI code against: Task 10's
 * [SpeechSettings] plus the extra fields (Gemma OCR model, playback, appearance)
 * and the setters. [SettingsPrefs] is the DataStore+Keystore implementation;
 * tests use an in-memory fake.
 */
interface AppSettings : SpeechSettings {
    fun gemmaModel(): String

    suspend fun setGroqKey(key: String?)
    suspend fun setGeminiKey(key: String?)
    suspend fun setGemmaKey(key: String?)
    suspend fun setKey(service: Service, key: String?)
    suspend fun setGroqModel(model: String)
    suspend fun setGeminiModel(model: String)
    suspend fun setGemmaModel(model: String)
    suspend fun setAddCommentPrompt(prompt: String)
    suspend fun setEditCommentPrompt(prompt: String)
    suspend fun setSpeechLanguage(lang: String?)
    suspend fun setPreferredTranscriber(source: TranscriberSource)

    fun seekStepSeconds(): Int
    suspend fun setSeekStepSeconds(seconds: Int)
    fun defaultPlaybackSpeed(): Float
    suspend fun setDefaultPlaybackSpeed(speed: Float)
    fun dynamicTheme(): Boolean
    suspend fun setDynamicTheme(dynamic: Boolean)
}