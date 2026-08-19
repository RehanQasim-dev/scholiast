package com.scholiast.android.domain.transcript

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Innertube caption-track client — the Android port of the desktop's
 * `tracksFromInnertube` + `loadTranscript` (video-transcript.ts), minus the
 * DOM/Defuddle paths (plan §5.6.1 "drop DOM/Defuddle paths").
 *
 * Flow: `POST youtubei/v1/player` with the IOS client context (falling back to
 * the WEB context when IOS yields no captions) → `captionTracks` → `pickTrack`
 * (session preference → English non-ASR → first) → fetch the track's `baseUrl`
 * with `&fmt=json3` → parse cues → chunk into paragraphs.
 *
 * The innertube response shape drifts over time; everything read from it is
 * funneled through [parseCaptionTracks] with defensive `JsonElement` walks, so
 * a shape change is contained to this file.
 *
 * Session state (track/transcript caches + the per-video language preference)
 * mirrors the desktop's module-level maps; a client instance lives for the app
 * session and is shared across videos.
 */
class TranscriptClient(
    private val okHttp: OkHttpClient = defaultClient(),
    private val playerEndpoint: String = INNERTUBE_PLAYER_URL,
    private val json: Json = Json { ignoreUnknownKeys = true },
) {

    private val tracksCache = mutableMapOf<String, List<CaptionTrack>>()
    private val transcriptCache = mutableMapOf<String, LoadedTranscript>() // "videoId:lang"
    private val sessionLangPref = mutableMapOf<String, String>()           // videoId → languageCode

    /** Per-video session language choice (plan §2: "per-video session choice").
     * Sets the preference used by [getTranscript] when no explicit language is
     * passed; the picker then calls `getTranscript(videoId, code)` to (re)load. */
    fun setSessionLanguage(videoId: String, code: String) {
        sessionLangPref[videoId] = code
    }

    /** Track list for the language picker (plan §5.6.1) — cached per video.
     * `null` when discovery failed (network/HTTP), `empty` when no captions. */
    suspend fun fetchTracks(videoId: String): List<CaptionTrack>? = withContext(Dispatchers.IO) {
        tracksCache[videoId] ?: when (val d = discoverTracks(videoId)) {
            is Discovery.Tracks -> d.tracks.also { tracksCache[videoId] = it }
            else -> null
        }
    }

    suspend fun getTranscript(videoId: String, preferredLang: String? = null): TranscriptResult =
        withContext(Dispatchers.IO) {
            try {
                getTranscriptInternal(videoId, preferredLang ?: sessionLangPref[videoId])
            } catch (e: IOException) {
                TranscriptResult.NetworkError(e)
            }
        }

    private suspend fun getTranscriptInternal(videoId: String, lang: String?): TranscriptResult {
        val cacheKey = "$videoId:${lang ?: ""}"
        transcriptCache[cacheKey]?.let { return TranscriptResult.Success(it) }

        val tracks = when (val d = discoverTracks(videoId)) {
            is Discovery.Tracks -> d.tracks.also { tracksCache[videoId] = it }
            Discovery.NoCaptions -> return TranscriptResult.NoCaptions
            is Discovery.Failed -> return d.toResult()
        }

        val track = pickTrack(tracks, lang) ?: return TranscriptResult.NoCaptions

        // Fetch the chosen track's captions (JSON3).
        val resp = get(appendFmtJson3(track.baseUrl), lang)
        if (resp.statusCode !in 200..299) return TranscriptResult.HttpError(resp.statusCode)
        val body = resp.body ?: return TranscriptResult.ParseError("empty caption response", null)
        val cues = try {
            CueParser.parse(body)
        } catch (e: Exception) {
            return TranscriptResult.ParseError("caption payload could not be parsed", e)
        }
        if (cues.isEmpty()) return TranscriptResult.NoCaptions

        val loaded = LoadedTranscript(
            videoId = videoId,
            languageCode = track.languageCode,
            tracks = tracks,
            cues = cues,
            paragraphs = TranscriptChunker.chunk(cues),
        )
        transcriptCache[cacheKey] = loaded
        return TranscriptResult.Success(loaded)
    }

    // --- Track discovery -----------------------------------------------------

    private sealed interface Discovery {
        data class Tracks(val tracks: List<CaptionTrack>) : Discovery
        data object NoCaptions : Discovery
        data class Failed(val statusCode: Int?, val cause: Throwable?) : Discovery {
            fun toResult(): TranscriptResult = when {
                statusCode != null -> TranscriptResult.HttpError(statusCode)
                cause is CueParser.ParseException -> TranscriptResult.ParseError(cause.message ?: "player response parse failure", cause)
                else -> TranscriptResult.NetworkError(cause)
            }
        }
    }

    private suspend fun discoverTracks(videoId: String): Discovery {
        for (context in listOf(IOS_CONTEXT, WEB_CONTEXT)) {
            val resp = post(playerEndpoint, playerBody(videoId, context))
            if (resp.statusCode !in 200..299) return Discovery.Failed(resp.statusCode, null)
            val body = resp.body ?: return Discovery.Failed(null, IOException("empty player response"))
            val tracks = try {
                parseCaptionTracks(body)
            } catch (e: Exception) {
                return Discovery.Failed(null, CueParser.ParseException("malformed player response", e))
            }
            if (tracks.isNotEmpty()) return Discovery.Tracks(tracks)
            // No captions from this client context — try the next one.
        }
        return Discovery.NoCaptions
    }

    // --- Response parsing seam (the innertube shape lives here) ---------------

    /**
     * `captions.playerCaptionsTracklistRenderer.captionTracks[]`, each entry
     * `{ languageCode, name: {simpleText|runs[]}, baseUrl, kind?: "asr" }`.
     * Tracks without a `baseUrl` are dropped (desktop behavior).
     */
    fun parseCaptionTracks(playerResponse: String): List<CaptionTrack> {
        val root = json.parseToJsonElement(playerResponse) as? JsonObject ?: return emptyList()
        val list = root["captions"]?.asObj()
            ?.get("playerCaptionsTracklistRenderer")?.asObj()
            ?.get("captionTracks") as? JsonArray ?: return emptyList()
        return list.mapNotNull { el ->
            val obj = el.asObj() ?: return@mapNotNull null
            val baseUrl = obj["baseUrl"]?.asPrim()?.contentOrNull ?: return@mapNotNull null
            CaptionTrack(
                languageCode = obj["languageCode"]?.asPrim()?.contentOrNull ?: "",
                name = trackName(obj),
                baseUrl = baseUrl,
                isAsr = obj["kind"]?.asPrim()?.contentOrNull == "asr",
            )
        }
    }

    // `name.simpleText || name.runs[].text.join('') || languageCode || ''`
    private fun trackName(t: JsonObject): String {
        val name = t["name"]?.asObj()
            ?: return t["languageCode"]?.asPrim()?.contentOrNull ?: ""
        name["simpleText"]?.asPrim()?.contentOrNull?.takeIf { it.isNotEmpty() }?.let { return it }
        val runs = name["runs"]?.asArr()
            ?.mapNotNull { it.asObj()?.get("text")?.asPrim()?.contentOrNull }
            ?.joinToString("")?.takeIf { it.isNotEmpty() }
        if (runs != null) return runs
        return t["languageCode"]?.asPrim()?.contentOrNull ?: ""
    }

    // --- Track picking (port of the desktop pickTrack) ------------------------

    // --- Transport -----------------------------------------------------------

    private data class HttpResponse(val statusCode: Int, val body: String?)

    private fun post(url: String, jsonBody: String): HttpResponse {
        val builder = Request.Builder().url(url)
            .post(jsonBody.toRequestBody(JSON_MEDIA_TYPE))
        return execute(builder.build())
    }

    private fun get(url: String, lang: String?): HttpResponse {
        val builder = Request.Builder().url(url)
        if (!lang.isNullOrEmpty()) builder.header("Accept-Language", lang)
        return execute(builder.build())
    }

    private fun execute(request: Request): HttpResponse {
        okHttp.newCall(request).execute().use { resp ->
            return HttpResponse(resp.code, resp.body?.string())
        }
    }

    private fun appendFmtJson3(baseUrl: String): String =
        if (baseUrl.contains('?')) "$baseUrl&fmt=json3" else "$baseUrl?fmt=json3"

    // --- Helpers ---------------------------------------------------------------

    private fun JsonElement?.asObj(): JsonObject? = this as? JsonObject
    private fun JsonElement?.asArr(): JsonArray? = this as? JsonArray
    private fun JsonElement?.asPrim(): JsonPrimitive? = this as? JsonPrimitive

    companion object {
        /** Same endpoint and contexts as the desktop (`video-transcript.ts`). */
        const val INNERTUBE_PLAYER_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false"

        private val IOS_CONTEXT: JsonObject = buildJsonObject {
            put("client", buildJsonObject {
                put("clientName", "IOS")
                put("clientVersion", "20.10.3")
            })
        }
        private val WEB_CONTEXT: JsonObject = buildJsonObject {
            put("client", buildJsonObject {
                put("clientName", "WEB")
                put("clientVersion", "2.20240101.00.00")
            })
        }

        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

        /** Same request body as the desktop: `{ "context": {client}, "videoId" }`. */
        private fun playerBody(videoId: String, context: JsonObject): String =
            buildJsonObject {
                put("context", context)
                put("videoId", videoId)
            }.toString()

        private fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build()

        /**
         * Track picking (port of the desktop `pickTrack`): session preference
         * (exact `languageCode` match, ASR not deprioritized) → English
         * (`languageCode` starts with "en", non-ASR preferred) → first
         * (non-ASR preferred).
         */
        fun pickTrack(tracks: List<CaptionTrack>, preferredLang: String?): CaptionTrack? {
            if (tracks.isEmpty()) return null
            if (!preferredLang.isNullOrEmpty()) {
                tracks.firstOrNull { it.languageCode == preferredLang }?.let { return it }
            }
            val en = tracks.filter { it.languageCode.lowercase().startsWith("en") }
            if (en.isNotEmpty()) return en.firstOrNull { !it.isAsr } ?: en.first()
            return tracks.firstOrNull { !it.isAsr } ?: tracks.first()
        }
    }
}