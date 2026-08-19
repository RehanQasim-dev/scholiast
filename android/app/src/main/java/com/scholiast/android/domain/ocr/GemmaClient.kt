package com.scholiast.android.domain.ocr

import com.scholiast.android.domain.transcribe.ApiKeyProvider
import com.scholiast.android.domain.transcribe.Service
import com.scholiast.android.domain.transcribe.TranscriptionError
import com.scholiast.android.domain.transcribe.TranscriptionError.INVALID_REQUEST
import com.scholiast.android.domain.transcribe.TranscriptionError.NETWORK
import com.scholiast.android.domain.transcribe.TranscriptionError.RATE_LIMITED
import com.scholiast.android.domain.transcribe.TranscriptionError.SERVER
import com.scholiast.android.domain.transcribe.TranscriptionError.UNAUTHORIZED
import com.scholiast.android.domain.transcribe.TranscriptionError.UNKNOWN
import java.io.File
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
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * Typed outcome of a Gemma OCR call. The UI/flows render each case
 * differently: [Success] text is stored on the item; [Skipped] is a silent
 * no-op (no key / no image); [Failure] carries the categorized [TranscriptionError]
 * (reused from Task 10 — the OCR layer and the voice layer share the same
 * network/401/429 categories, so one enum maps both).
 */
sealed interface OcrResult {
    /** Recognized text, cleaned by [cleanOcrText]. Never blank. */
    data class Success(val text: String) : OcrResult

    /** OCR was not attempted. Never an error condition. */
    data class Skipped(val reason: OcrSkipReason) : OcrResult

    /** The provider rejected the request (or the response was unreadable). */
    data class Failure(
        val error: TranscriptionError,
        val message: String,
        val cause: Throwable? = null,
    ) : OcrResult
}

/** Why OCR was not attempted. */
enum class OcrSkipReason {
    /** No Gemma API key configured — silently skip (plan §5.7.3 quota-aware). */
    NO_KEY,

    /** The frame JPEG does not exist (item deleted before OCR ran). */
    FILE_MISSING,
}

/**
 * Gemma vision OCR client (plan §2 / §5.7.3 — "via Gemma 4"; §5.11 the model
 * id is a settings default). Same Google AI REST surface the Gemini
 * transcriber uses: `POST {base}/v1beta/models/{model}:generateContent?key=`
 * with the frame JPEG as an **inline base64** `inlineData` part — frames are
 * ≤1280px JPEGs (~0.5–2 MB), comfortably inside the 20 MB inline cap, so no
 * Files-API upload path is needed (unlike long audio).
 *
 * ## Request shape
 * `POST {base}/v1beta/models/{model}:generateContent?key={key}`
 * `{ "contents": [ { "parts": [
 *      { "inlineData": { "mimeType": "image/jpeg", "data": "<base64>" } },
 *      { "text": "Transcribe all text in this image. …" } ] } ] }`
 *
 * ## Response shape (standard generateContent)
 * `{ "candidates": [ { "content": { "parts": [ { "text": … } ] } } ] }` —
 * all part texts are joined, then [cleanOcrText]d.
 *
 * ## Error mapping
 * 401/403 → [TranscriptionError.UNAUTHORIZED] · 429 → [RATE_LIMITED] ·
 * other 4xx → [INVALID_REQUEST] · 5xx → [SERVER] · IO → [NETWORK].
 * No key → [OcrResult.Skipped] with [OcrSkipReason.NO_KEY], no request.
 */
class GemmaClient(
    private val keys: ApiKeyProvider,
    private val okHttp: OkHttpClient = defaultClient(),
    private val baseUrl: String = DEFAULT_BASE_URL,
    private val model: String = DEFAULT_GEMMA_MODEL,
    private val json: Json = Json { ignoreUnknownKeys = true },
) {

    /** OCR the frame JPEG at [imageFile] (Task 14's `frames/<itemId>.jpg`). */
    suspend fun ocr(imageFile: File): OcrResult {
        if (!imageFile.isFile) return OcrResult.Skipped(OcrSkipReason.FILE_MISSING)
        val bytes = try {
            imageFile.readBytes()
        } catch (e: IOException) {
            return OcrResult.Failure(UNKNOWN, "Could not read the frame image.", e)
        }
        return ocr(bytes)
    }

    /**
     * OCR an in-memory JPEG. Suspend + IO so cancelling the caller cancels the
     * blocking OkHttp call (same contract as the transcribers).
     */
    suspend fun ocr(imageJpeg: ByteArray): OcrResult {
        val key = keys.apiKey(Service.GEMMA) ?: return OcrResult.Skipped(OcrSkipReason.NO_KEY)
        return withContext(Dispatchers.IO) {
            try {
                ocrInternal(key, imageJpeg)
            } catch (e: IOException) {
                OcrResult.Failure(
                    NETWORK, "Could not reach the Gemma OCR API. Check your connection.", e,
                )
            }
        }
    }

    private fun ocrInternal(key: String, jpeg: ByteArray): OcrResult {
        val body = buildJsonObject {
            put(
                "contents",
                JsonArray(
                    listOf(
                        buildJsonObject {
                            put(
                                "parts",
                                JsonArray(
                                    listOf(
                                        buildJsonObject {
                                            put(
                                                "inlineData",
                                                buildJsonObject {
                                                    put("mimeType", "image/jpeg")
                                                    put("data", Base64.getEncoder().encodeToString(jpeg))
                                                },
                                            )
                                        },
                                        buildJsonObject { put("text", OCR_PROMPT) },
                                    ),
                                ),
                            )
                        },
                    ),
                ),
            )
        }.toString()

        val request = Request.Builder()
            .url("$baseUrl/v1beta/models/$model:generateContent?key=$key")
            .post(body.toRequestBody(JSON_MEDIA_TYPE))
            .build()

        return okHttp.newCall(request).execute().use { resp ->
            val responseBody = resp.body?.string().orEmpty()
            if (resp.code !in 200..299) return failureFor(resp.code, responseBody)
            val text = cleanOcrText(parseResponseText(responseBody))
            if (text.isBlank()) {
                return OcrResult.Failure(UNKNOWN, "The OCR model returned no text.")
            }
            OcrResult.Success(text)
        }
    }

    private fun failureFor(code: Int, body: String): OcrResult.Failure {
        val message = errorMessage(body) ?: "Gemma OCR error (HTTP $code)."
        val error = when (code) {
            401, 403 -> UNAUTHORIZED
            429 -> RATE_LIMITED
            in 400..499 -> INVALID_REQUEST
            in 500..599 -> SERVER
            else -> UNKNOWN
        }
        return OcrResult.Failure(error, message)
    }

    /** Gemini/Gemma errors: `{ "error": { "code": …, "message": …, "status": … } }`. */
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

    /** `candidates[0].content.parts[].text` joined (mirror of GeminiTranscriber).
     *  A malformed body yields "" (→ Failure by the caller), never a throw —
     *  the runner's detached coroutine must not crash on a bad response. */
    private fun parseResponseText(body: String): String {
        val root = try {
            json.parseToJsonElement(body) as? JsonObject
        } catch (_: Exception) {
            return ""
        }
        val candidates = root?.get("candidates") as? JsonArray ?: return ""
        val content = (candidates.firstOrNull() as? JsonObject)?.get("content") as? JsonObject
        val parts = content?.get("parts") as? JsonArray ?: return ""
        return parts.mapNotNull { part ->
            (part as? JsonObject)?.get("text")?.jsonPrimitive?.contentOrNull
        }.joinToString("").trim()
    }

    companion object {
        /** Plan §5.11 "the Gemma OCR model" default. The concrete Google AI
         *  model id for Gemma 4 (Gemma 4 family, April 2026) is
         *  `gemma-4-31b-it` (the flagship multimodal variant; OCR-capable).
         *  Task 19's Settings makes this user-editable. */
        const val DEFAULT_GEMMA_MODEL: String = "gemma-4-31b-it"

        const val DEFAULT_BASE_URL: String = "https://generativelanguage.googleapis.com"

        /** Minimal, language-neutral OCR prompt — raw transcription, no commentary. */
        const val OCR_PROMPT: String = "Transcribe all text in this image. Output only the transcribed text."

        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

        private fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS) // a large vision model can take a while
            .writeTimeout(120, TimeUnit.SECONDS)
            .build()
    }
}

/**
 * Clean raw model output into the stored OCR text:
 * - CRLF/CR → LF; trim.
 * - Strip a wrapping markdown fence (```` ```text … ``` ````) — vision models
 *   like to code-fence their OCR output; the stored text must be plain.
 * - Trim trailing whitespace per line (stray spaces are OCR noise); collapse
 *   runs of 3+ blank lines to a single blank line.
 *
 * Pure + unit-tested; the blank result is surfaced by [GemmaClient] as a
 * Failure so the runner never stores empty text.
 */
fun cleanOcrText(raw: String): String {
    var t = raw.replace("\r\n", "\n").replace('\r', '\n').trim()
    if (t.startsWith("```") && t.endsWith("```") && t.length >= 6) {
        t = t.substring(3, t.length - 3).trim()
        val firstLine = t.substringBefore('\n')
        if (firstLine in FENCE_LANG_TOKENS) t = t.substringAfter('\n').trim()
    }
    t = t.lines().joinToString("\n") { it.trimEnd() }
    t = t.replace(Regex("\n{3,}"), "\n\n")
    return t.trim()
}

private val FENCE_LANG_TOKENS = setOf("text", "txt", "plaintext", "markdown", "md")