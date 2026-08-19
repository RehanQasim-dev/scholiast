package com.scholiast.android.domain.transcribe

import com.scholiast.android.domain.transcribe.TranscriptionError.INVALID_REQUEST
import com.scholiast.android.domain.transcribe.TranscriptionError.NETWORK
import com.scholiast.android.domain.transcribe.TranscriptionError.NOT_CONFIGURED
import com.scholiast.android.domain.transcribe.TranscriptionError.RATE_LIMITED
import com.scholiast.android.domain.transcribe.TranscriptionError.SERVER
import com.scholiast.android.domain.transcribe.TranscriptionError.UNAUTHORIZED
import com.scholiast.android.domain.transcribe.TranscriptionError.UNKNOWN
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody

/**
 * Groq Whisper transcriber (plan §2 / §5.5.2) — the OpenAI-compatible
 * `POST /openai/v1/audio/transcriptions` endpoint with `whisper-large-v3-turbo`
 * (plan §5.11). Plain OkHttp multipart upload; the model id and the API key
 * come from [SpeechSettings] — never hardcoded.
 *
 * Request (`multipart/form-data`):
 *   `model` = settings model (default `whisper-large-v3-turbo`)
 *   `file`  = the 16 kHz mono WAV (Task 09's `WavWriter`)
 *   `language` = speech-language setting when present (ISO-639-1)
 *   `response_format` = `verbose_json` (word/segment timestamps come back)
 *   `Authorization: Bearer <key>`
 *
 * Response (`verbose_json`): `{ "text": "...", "segments": [{ "start": s,
 * "end": e, "text": "..." }] }` — segments are parsed into
 * [TranscriptionResult.Success.timestamps].
 */
class GroqTranscriber(
    private val settings: SpeechSettings,
    private val okHttp: OkHttpClient = defaultClient(),
    private val endpoint: String = GROQ_TRANSCRIPTIONS_URL,
    private val json: Json = Json { ignoreUnknownKeys = true },
) : Transcriber {

    override val source: TranscriberSource = TranscriberSource.GROQ

    override suspend fun transcribe(
        audio: AudioSource,
        language: String?,
        onPartial: (String) -> Unit,
    ): TranscriptionResult {
        val key = settings.apiKey(Service.GROQ)
            ?: return notConfigured(source, "Set up your Groq key in Settings to use voice.")
        val model = settings.groqModel()
        val wav = audio.toWavFile() ?: return TranscriptionResult.Failure(
            source, INVALID_REQUEST, "The recording could not be converted to WAV.",
        )
        return withContext(Dispatchers.IO) {
            try {
                transcribeInternal(key, model, wav, language, onPartial)
            } catch (e: IOException) {
                TranscriptionResult.Failure(
                    source, NETWORK, "Could not reach Groq. Check your connection.", e,
                )
            } finally {
                // A FloatSamples source was materialized to a temp file; the
                // recorder's WavFile is owned by the caller.
                if (audio is AudioSource.FloatSamples) wav.delete()
            }
        }
    }

    private fun transcribeInternal(
        key: String,
        model: String,
        wav: File,
        language: String?,
        onPartial: (String) -> Unit,
    ): TranscriptionResult {
        val body = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("model", model)
            .addFormDataPart("file", wav.name, wav.asRequestBody(WAV_MEDIA_TYPE))
            .apply { if (!language.isNullOrBlank()) addFormDataPart("language", language!!) }
            .addFormDataPart("response_format", "verbose_json")
            .build()

        val request = Request.Builder()
            .url(endpoint)
            .header("Authorization", "Bearer $key")
            .post(body)
            .build()

        okHttp.newCall(request).execute().use { resp ->
            val responseBody = resp.body?.string().orEmpty()
            if (resp.code !in 200..299) return failureFor(resp.code, responseBody)
            val text = parseText(responseBody)
            if (text.isBlank()) {
                return TranscriptionResult.Failure(source, UNKNOWN, "Groq returned no text.")
            }
            onPartial(text)
            return TranscriptionResult.Success(
                source = source,
                text = text,
                timestamps = parseSegments(responseBody),
            )
        }
    }

    /** `text` field of the OpenAI-compatible response. */
    private fun parseText(body: String): String =
        (json.parseToJsonElement(body) as? JsonObject)?.get("text")
            ?.jsonPrimitive?.contentOrNull?.trim().orEmpty()

    /** `segments[]` (`{start, end, text}`, seconds) → [WordTimestamp] (ms). */
    private fun parseSegments(body: String): List<WordTimestamp>? {
        val root = json.parseToJsonElement(body) as? JsonObject ?: return null
        val segments = root["segments"] as? JsonArray ?: return null
        return segments.mapNotNull { el ->
            val obj = el as? JsonObject ?: return@mapNotNull null
            val start = obj["start"]?.jsonPrimitive?.doubleOrNull ?: return@mapNotNull null
            val end = obj["end"]?.jsonPrimitive?.doubleOrNull ?: return@mapNotNull null
            val text = obj["text"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
            WordTimestamp(
                startMs = (start * 1000).toLong(),
                endMs = (end * 1000).toLong(),
                text = text,
            )
        }.takeIf { it.isNotEmpty() }
    }

    private fun failureFor(code: Int, body: String): TranscriptionResult.Failure {
        val message = errorMessage(body) ?: "Groq error (HTTP $code)."
        val error = when (code) {
            401 -> UNAUTHORIZED
            429 -> RATE_LIMITED
            in 400..499 -> INVALID_REQUEST
            in 500..599 -> SERVER
            else -> UNKNOWN
        }
        return TranscriptionResult.Failure(source, error, message)
    }

    /** Groq errors are `{ "error": { "message": "..." } }` (OpenAI shape). */
    private fun errorMessage(body: String): String? {
        val root = try {
            json.parseToJsonElement(body) as? JsonObject
        } catch (_: Exception) {
            return null
        }
        val message = (root?.get("error") as? JsonObject)?.get("message")
            ?.jsonPrimitive?.contentOrNull
        return message?.takeIf { it.isNotBlank() }
    }

    companion object {
        const val GROQ_TRANSCRIPTIONS_URL: String = "https://api.groq.com/openai/v1/audio/transcriptions"

        private val WAV_MEDIA_TYPE = "audio/wav".toMediaType()

        /** Longer read timeout: transcription of up to ~2 min of audio takes a while. */
        private fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()
    }
}