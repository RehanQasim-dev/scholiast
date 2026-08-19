package com.scholiast.android.ui.settings

import com.scholiast.android.domain.transcribe.Service
import com.scholiast.android.domain.transcribe.SpeechSettings
import com.scholiast.android.domain.transcribe.TranscriberSource
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Task 19: the settings store contract (in-memory fake, JVM-testable). */
class SettingsViewModelTest {

    @Test
    fun `in-memory settings round-trip`() = runBlocking {
        val settings = FakeAppSettings()
        assertEquals(SpeechSettings.DEFAULT_GROQ_MODEL, settings.groqModel())
        assertNull(settings.apiKey(Service.GROQ))

        settings.setGroqKey("groq-key")
        settings.setGeminiKey("gemini-key")
        settings.setGroqModel("whisper-1")
        settings.setSpeechLanguage("fr")
        settings.setPreferredTranscriber(TranscriberSource.GEMINI)

        assertEquals("groq-key", settings.apiKey(Service.GROQ))
        assertEquals("gemini-key", settings.apiKey(Service.GEMINI))
        assertEquals("whisper-1", settings.groqModel())
        assertEquals("fr", settings.speechLanguage())
        assertEquals(TranscriberSource.GEMINI, settings.preferredTranscriber())

        settings.setGroqKey(null)
        assertNull(settings.apiKey(Service.GROQ))
    }

    @Test
    fun `defaults match the plan`() = runBlocking {
        val settings = FakeAppSettings()
        assertEquals("whisper-large-v3-turbo", settings.groqModel())
        assertEquals("gemini-3.6-flash", settings.geminiModel())
        assertEquals("gemma-4-31b-it", settings.gemmaModel())
        assertEquals(TranscriberSource.LOCAL, settings.preferredTranscriber())
        assertEquals(15, settings.seekStepSeconds())
        assertEquals(1.0f, settings.defaultPlaybackSpeed())
        assertTrue(settings.dynamicTheme())
    }

    @Test
    fun `seek step and speed setters`() = runBlocking {
        val settings = FakeAppSettings()
        settings.setSeekStepSeconds(30)
        settings.setDefaultPlaybackSpeed(1.5f)
        settings.setDynamicTheme(false)
        assertEquals(30, settings.seekStepSeconds())
        assertEquals(1.5f, settings.defaultPlaybackSpeed())
        assertFalse(settings.dynamicTheme())
    }

    @Test
    fun `settings state maps api keys to booleans`() = runBlocking {
        val settings = FakeAppSettings()
        settings.setGemmaKey("gemma-key")
        assertEquals("gemma-key", settings.apiKey(Service.GEMMA))
    }

    @Test
    fun `active stt model round-trip`() = runBlocking {
        val settings = FakeAppSettings()
        assertNull(settings.activeSttModel())
        settings.setActiveSttModel("voice-input-english-74.bin")
        assertEquals("voice-input-english-74.bin", settings.activeSttModel())
        settings.setActiveSttModel(null)
        assertNull(settings.activeSttModel())
    }
}

/** In-memory [AppSettings] for JVM tests (DataStore needs an Android Context). */
class FakeAppSettings : AppSettings {
    private val keys = mutableMapOf<Service, String?>(
        Service.GROQ to null,
        Service.GEMINI to null,
        Service.GEMMA to null,
    )
    private var groqModel = SpeechSettings.DEFAULT_GROQ_MODEL
    private var geminiModel = SpeechSettings.DEFAULT_GEMINI_MODEL
    private var gemmaModel = "gemma-4-31b-it"
    private var addPrompt = SpeechSettings.DEFAULT_ADD_COMMENT_PROMPT
    private var editPrompt = SpeechSettings.DEFAULT_EDIT_COMMENT_PROMPT
    private var speechLanguage: String? = null
    private var preferred = TranscriberSource.LOCAL
    private var seekStep = 15
    private var speed = 1.0f
    private var dynamic = true
    private var activeSttModel: String? = null

    override suspend fun apiKey(service: Service): String? = keys[service]

    override fun groqModel(): String = groqModel
    override fun geminiModel(): String = geminiModel
    override fun gemmaModel(): String = gemmaModel
    override fun addCommentPrompt(): String = addPrompt
    override fun editCommentPrompt(): String = editPrompt
    override fun speechLanguage(): String? = speechLanguage
    override fun preferredTranscriber(): TranscriberSource = preferred
    override fun seekStepSeconds(): Int = seekStep
    override fun defaultPlaybackSpeed(): Float = speed
    override fun dynamicTheme(): Boolean = dynamic

    override suspend fun setGroqKey(key: String?) { keys[Service.GROQ] = key }
    override suspend fun setGeminiKey(key: String?) { keys[Service.GEMINI] = key }
    override suspend fun setGemmaKey(key: String?) { keys[Service.GEMMA] = key }
    override suspend fun setKey(service: Service, key: String?) { keys[service] = key }
    override suspend fun setGroqModel(model: String) { groqModel = model }
    override suspend fun setGeminiModel(model: String) { geminiModel = model }
    override suspend fun setGemmaModel(model: String) { gemmaModel = model }
    override suspend fun setAddCommentPrompt(prompt: String) { addPrompt = prompt }
    override suspend fun setEditCommentPrompt(prompt: String) { editPrompt = prompt }
    override suspend fun setSpeechLanguage(lang: String?) { speechLanguage = lang }
    override suspend fun setPreferredTranscriber(source: TranscriberSource) { preferred = source }
    override suspend fun setSeekStepSeconds(seconds: Int) { seekStep = seconds }
    override suspend fun setDefaultPlaybackSpeed(speed: Float) { this.speed = speed }
    override suspend fun setDynamicTheme(dynamic: Boolean) { this.dynamic = dynamic }
    override fun activeSttModel(): String? = activeSttModel
    override suspend fun setActiveSttModel(fileName: String?) { activeSttModel = fileName }
}