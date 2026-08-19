package com.scholiast.android.domain.transcribe

/**
 * The cloud service a secret belongs to. Keys never live in code or in this
 * task's files — they come from the Android Keystore (Task 16 owns the
 * Keystore wrapper) via an injected [ApiKeyProvider].
 */
enum class Service {
    /** Groq — Whisper transcription (`whisper-large-v3-turbo`). */
    GROQ,

    /** Google AI — Gemini speech/text (`gemini-3.6-flash`). */
    GEMINI,

    /** Google AI — Gemma vision (OCR, v1.1). Defined here so the settings UI
     *  has one place to ask for every key; nothing in this package consumes it. */
    GEMMA,
}

/**
 * Injected secret provider. **Defined here only** — Task 16 implements it with
 * an Android Keystore-backed store (plan §2: keys live in the Keystore); the
 * transcriber layer and the UI code against this interface and never see where
 * the value came from.
 *
 * Returns `null` when the service is not configured (no key stored).
 */
interface ApiKeyProvider {
    suspend fun apiKey(service: Service): String?
}

/**
 * The speech settings the transcriber layer and the voice UI code against
 * (plan §5.5.6 / §5.11). **Defined here with a default in-memory impl; Task 19
 * provides the real DataStore + Keystore implementation.**
 *
 * [apiKey] is inherited from [ApiKeyProvider] — one interface for Task 19 to
 * implement, one seam for everything else to inject.
 */
interface SpeechSettings : ApiKeyProvider {
    /** Groq model id (default `whisper-large-v3-turbo`). */
    fun groqModel(): String

    /** Gemini model id (default `gemini-3.6-flash`). */
    fun geminiModel(): String

    /** The add-comment prompt used when Gemini handles a new spoken comment
     *  (plan §5.5.6 default below). User-editable in Settings. */
    fun addCommentPrompt(): String

    /** The voice-edit prompt used when Gemini edits an existing comment
     *  (plan §5.5.6 default below). User-editable, per-session override allowed. */
    fun editCommentPrompt(): String

    /** Speech language passed to Groq Whisper + the local STT engine
     *  (plan §2: default English; Gemini needs no language input). */
    fun speechLanguage(): String?

    /** Which transcriber the user prefers (online → cloud, offline → local). */
    fun preferredTranscriber(): TranscriberSource

    companion object {
        /** Plan §5.5.6 defaults — the app ships with these. */
        const val DEFAULT_ADD_COMMENT_PROMPT: String =
            "You are helping write study notes. Turn the user's speech into a clear, concise note, " +
                "keeping technical terms and key facts. Output only the note text."

        const val DEFAULT_EDIT_COMMENT_PROMPT: String =
            "The user wants to modify their note below. Follow their spoken instructions, keep it " +
                "concise, output only the revised note."

        const val DEFAULT_GROQ_MODEL: String = "whisper-large-v3-turbo"
        const val DEFAULT_GEMINI_MODEL: String = "gemini-3.6-flash"
    }
}

/**
 * In-memory [SpeechSettings] for tests and for the app before Task 19's
 * DataStore/Keystore impl lands. Keys start `null` (nothing configured).
 */
class DefaultSpeechSettings(
    private val keys: MutableMap<Service, String> = mutableMapOf(),
    private var groqModel: String = SpeechSettings.DEFAULT_GROQ_MODEL,
    private var geminiModel: String = SpeechSettings.DEFAULT_GEMINI_MODEL,
    private var addPrompt: String = SpeechSettings.DEFAULT_ADD_COMMENT_PROMPT,
    private var editPrompt: String = SpeechSettings.DEFAULT_EDIT_COMMENT_PROMPT,
    private var language: String? = null,
    private var preferred: TranscriberSource = TranscriberSource.LOCAL,
) : SpeechSettings {

    /** Set (or clear with `null`) a key for [service]. */
    fun setKey(service: Service, key: String?) {
        if (key == null) keys.remove(service) else keys[service] = key
    }

    override suspend fun apiKey(service: Service): String? = keys[service]

    override fun groqModel(): String = groqModel

    override fun geminiModel(): String = geminiModel

    override fun addCommentPrompt(): String = addPrompt

    override fun editCommentPrompt(): String = editPrompt

    override fun speechLanguage(): String? = language

    override fun preferredTranscriber(): TranscriberSource = preferred
}