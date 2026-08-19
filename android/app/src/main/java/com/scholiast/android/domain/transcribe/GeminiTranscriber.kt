package com.scholiast.android.domain.transcribe

import com.scholiast.android.domain.transcribe.TranscriptionError.INVALID_REQUEST
import com.scholiast.android.domain.transcribe.TranscriptionError.NETWORK
import com.scholiast.android.domain.transcribe.TranscriptionError.NOT_CONFIGURED
import com.scholiast.android.domain.transcribe.TranscriptionError.RATE_LIMITED
import com.scholiast.android.domain.transcribe.TranscriptionError.SERVER
import com.scholiast.android.domain.transcribe.TranscriptionError.UNAUTHORIZED
import com.scholiast.android.domain.transcribe.TranscriptionError.UNKNOWN
import java.io.IOException
import java.util.Base64
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * Google AI Gemini transcriber (plan §2 / §5.5.2 / §5.5.3), model default
 * `gemini-3.6-flash` (plan §5.11). The prompt-aware path: audio + prompt →
 * `generateContent` → response text. The add-comment flow uses the
 * settings prompt ([transcribe]); the voice-edit flow passes the user-edited
 * prompt ([transcribeWithPrompt]).
 *
 * ## Request shape (task.md agent note, verified against the REST docs)
 * `POST {base}/v1beta/models/{model}:generateContent?key={key}`
 * `{ "contents": [ { "parts": [
 *      { "inlineData": { "mimeType": "audio/wav", "data": "<base64>" } },
 *      { "text": "<prompt>" } ] } ] }`
 *
 * ## Long audio (plan §5.5.3 "chunking or file API")
 * Inline data is capped at [MAX_INLINE_BYTES] (the recorder's 2-min WAV is
 * ~3.8 MB, so inline covers the real flow). Anything larger goes through the
 * **Files API** instead: resumable upload (`X-Goog-Upload-*` headers) → a
 * `fileData` part references the uploaded file → the file is deleted after
 * the call. `maxInlineBytes` is injectable so tests can force the file path.
 *
 * Response: `{ "candidates": [ { "content": { "parts": [ { "text": ... } ] } } ] }`
 * — all part texts are joined.
 */
class GeminiTranscriber(
    private val settings: SpeechSettings,
    private val okHttp: OkHttpClient = defaultClient(),
    private val baseUrl: String = DEFAULT_GEMINI_BASE_URL,
    private val uploadUrl: String = DEFAULT_GEMINI_UPLOAD_URL,
    private val maxInlineBytes: Long = MAX_INLINE_BYTES,
    private val json: Json = Json { ignoreUnknownKeys = true },
) : Transcriber {

    override val source: TranscriberSource = TranscriberSource.GEMINI

    /** Add-comment flow: audio + the settings' add-comment prompt. */
    override suspend fun transcribe(
        audio: AudioSource,
        language: String?,
        onPartial: (String) -> Unit,
    ): TranscriptionResult = transcribeWithPrompt(audio, settings.addCommentPrompt(), onPartial)

    /**
     * Voice-edit flow (plan §5.5.3): audio + the caller's prompt (pre-filled
     * from settings, per-session override allowed). Gemini needs no language
     * input (plan §2), so [language] is dropped here.
     */
    suspend fun transcribeWithPrompt(
        audio: AudioSource,
        prompt: String,
        onPartial: (String) -> Unit = {},
    ): TranscriptionResult {
        val key = settings.apiKey(Service.GEMINI)
            ?: return notConfigured(source, "Set up Gemini in Settings.")
        val wav = audio.toWavFile() ?: return TranscriptionResult.Failure(
            source, INVALID_REQUEST, "The recording could not be converted to WAV.",
        )
        return withContext(Dispatchers.IO) {
            try {
                transcribeInternal(key, wav, prompt, onPartial)
            } catch (e: IOException) {
                TranscriptionResult.Failure(
                    source, NETWORK, "Could not reach Gemini. Check your connection.", e,
                )
            } finally {
                if (audio is AudioSource.FloatSamples) wav.delete()
            }
        }
    }

    private fun transcribeInternal(
        key: String,
        wav: java.io.File,
        prompt: String,
        onPartial: (String) -> Unit,
    ): TranscriptionResult {
        val model = settings.geminiModel()
        val bytes = wav.readBytes()
        val audioPart: JsonObject = if (bytes.size <= maxInlineBytes) {
            buildJsonObject {
                put(
                    "inlineData",
                    buildJsonObject {
                        put("mimeType", "audio/wav")
                        put("data", Base64.getEncoder().encodeToString(bytes))
                    },
                )
            }
        } else {
            buildJsonObject {
                put(
                    "fileData",
                    buildJsonObject {
                        put("mimeType", "audio/wav")
                        put("fileUri", uploadAndGetUri(key, wav))
                    },
                )
            }
        }

        val request = Request.Builder()
            .url(generateContentUrl(model, key))
            .post(generateContentBody(audioPart, prompt).toRequestBody(JSON_MEDIA_TYPE))
            .build()

        return okHttp.newCall(request).execute().use { resp ->
            val body = resp.body?.string().orEmpty()
            if (resp.code !in 200..299) return failureFor(resp.code, body)
            val text = parseResponseText(body)
            if (text.isBlank()) {
                return TranscriptionResult.Failure(
                    source, UNKNOWN, "Gemini returned no text. The audio may be too short.",
                )
            }
            onPartial(text)
            TranscriptionResult.Success(source, text, timestamps = null)
        }
    }

    // --- Files API path (long audio) -----------------------------------------

    /**
     * Resumable-upload the WAV and return its `fileUri` for a `fileData` part.
     * Mirrors the documented two-step flow: start-command with metadata →
     * control URL from `X-Goog-Upload-Control-URL` → PUT the raw bytes.
     */
    private fun uploadAndGetUri(key: String, wav: java.io.File): String {
        val start = Request.Builder()
            .url("$uploadUrl/v1beta/files?key=$key")
            .header("X-Goog-Upload-Protocol", "resumable")
            .header("X-Goog-Upload-Command", "start, upload, finalize")
            .header("X-Goog-Upload-Header-Content-Length", wav.length().toString())
            .header("X-Goog-Upload-Header-Content-Type", "audio/wav")
            .post(
                buildJsonObject {
                    put("file", buildJsonObject { put("display_name", "voice.wav") })
                }.toString().toRequestBody(JSON_MEDIA_TYPE),
            )
            .build()

        val controlUrl = okHttp.newCall(start).execute().use { resp ->
            if (resp.code !in 200..299) throw IOException("Gemini upload start failed: HTTP ${resp.code}")
            resp.header("X-Goog-Upload-Control-URL")
                ?: throw IOException("Gemini upload start returned no control URL")
        }

        val media = Request.Builder()
            .url(controlUrl)
            .put(wav.readBytes().toRequestBody(WAV_MEDIA_TYPE))
            .build()

        val fileUri = okHttp.newCall(media).execute().use { resp ->
            val body = resp.body?.string().orEmpty()
            if (resp.code !in 200..299) throw IOException("Gemini upload failed: HTTP ${resp.code}")
            val file = (json.parseToJsonElement(body) as? JsonObject)?.get("file") as? JsonObject
            val uri = file?.get("uri")?.jsonPrimitive?.contentOrNull
            val name = file?.get("name")?.jsonPrimitive?.contentOrNull
            // Best-effort cleanup — a failure here must not fail the transcription.
            if (name != null) {
                try {
                    deleteUploadedFile(key, name)
                } catch (_: Exception) {
                }
            }
            uri ?: throw IOException("Gemini upload response had no file uri")
        }

        return fileUri
    }

    private fun deleteUploadedFile(key: String, name: String) {
        val delete = Request.Builder()
            .url("$baseUrl/v1beta/$name?key=$key")
            .delete()
            .build()
        okHttp.newCall(delete).execute().close()
    }

    // --- Request/response shaping -------------------------------------------------

    private fun generateContentUrl(model: String, key: String): String =
        "$baseUrl/v1beta/models/$model:generateContent?key=$key"

    private fun generateContentBody(audioPart: JsonObject, prompt: String): String =
        buildJsonObject {
            put(
                "contents",
                JsonArray(
                    listOf(
                        buildJsonObject {
                            put(
                                "parts",
                                JsonArray(
                                    listOf(
                                        audioPart,
                                        buildJsonObject { put("text", prompt) },
                                    ),
                                ),
                            )
                        },
                    ),
                ),
            )
        }.toString()

    /**
     * `candidates[0].content.parts[].text` joined. `{ "candidates": [],
     * "promptFeedback": { "blockReason": ... } }` (safety block) also yields
     * empty — surfaced as an error by the caller.
     */
    private fun parseResponseText(body: String): String {
        val root = json.parseToJsonElement(body) as? JsonObject ?: return ""
        val candidates = root["candidates"] as? JsonArray ?: return ""
        val content = (candidates.firstOrNull() as? JsonObject)?.get("content") as? JsonObject
        val parts = content?.get("parts") as? JsonArray ?: return ""
        return parts.mapNotNull { part ->
            (part as? JsonObject)?.get("text")?.jsonPrimitive?.contentOrNull
        }.joinToString("").trim()
    }

    private fun failureFor(code: Int, body: String): TranscriptionResult.Failure {
        val message = errorMessage(body) ?: "Gemini error (HTTP $code)."
        val error = when (code) {
            400 -> INVALID_REQUEST
            401, 403 -> UNAUTHORIZED
            429 -> RATE_LIMITED
            in 500..599 -> SERVER
            else -> UNKNOWN
        }
        return TranscriptionResult.Failure(source, error, message)
    }

    /** Gemini errors: `{ "error": { "code": 429, "message": "...", "status": ... } }`. */
    private fun errorMessage(body: String): String? {
        val root = try {
            json.parseToJsonElement(body) as? JsonObject
        } catch (_: Exception) {
            return null
        }
        return (root?.get("error") as? JsonObject)?.get("message")
            ?.jsonPrimitive?.contentOrNull
            ?.takeIf { it.isNotBlank() }
    }

    companion object {
        const val DEFAULT_GEMINI_BASE_URL: String = "https://generativelanguage.googleapis.com"
        const val DEFAULT_GEMINI_UPLOAD_URL: String = "https://generativelanguage.googleapis.com/upload"

        /** Inline-data cap: comfortably above the recorder's 2-min WAV (~3.8 MB),
         *  far below the API's 20 MB inline limit. */
        const val MAX_INLINE_BYTES: Long = 8L * 1024 * 1024

        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
        private val WAV_MEDIA_TYPE = "audio/wav".toMediaTypeOrNull()!!

        private fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .writeTimeout(120, TimeUnit.SECONDS)
            .build()
    }
}