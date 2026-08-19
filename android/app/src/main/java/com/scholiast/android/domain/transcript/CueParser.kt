package com.scholiast.android.domain.transcript

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull

/**
 * Parses YouTube caption track payloads into cues. Two input formats, mirroring
 * the desktop `video-transcript.ts`:
 *   1. **JSON3** (`baseUrl&fmt=json3`) — the format [TranscriptClient] always
 *      requests. Events with `tStartMs` start a cue; `aAppend` events (no
 *      `tStartMs`) accumulate their segs into the previous cue's text and never
 *      create a cue of their own — YouTube splits long lines into a start event
 *      plus one or more append events.
 *   2. **XML** — a faithful `parseCuesXml` port (srv3 `<p t="ms" d="ms">` with
 *      `<s>` word segments, then the simple `<text start="s" dur="s">` format),
 *      kept as a defensive fallback for when `fmt=json3` is ignored.
 *
 * All functions are pure (string in → cues out), so they are JVM-testable
 * without any Android dependency.
 */
object CueParser {

    private val json = Json { ignoreUnknownKeys = true }

    class ParseException(message: String, cause: Throwable? = null) : Exception(message, cause)

    /** Auto-detect: XML payloads start with `<`; JSON3 is an object. */
    fun parse(raw: String): List<TranscriptCue> =
        if (raw.trimStart().startsWith("<")) parseXml(raw) else parseJson3(raw)

    // --- JSON3 --------------------------------------------------------------

    /**
     * JSON3 shape (what `&fmt=json3` returns):
     * ```
     * { "wireMagic": "pb3", "events": [
     *     { "tStartMs": 0, "dDurationMs": 2680, "segs": [{"utf8": "Hello"}, {"tOffsetMs": 900, "acAsrConf": 0.9, "utf8": " world"}] },
     *     { "aAppend": 0, "segs": [{"utf8": ", and welcome."}] },
     *     ...
     * ]}
     * ```
     * A cue's `index` is its start event's position in `events` (append events
     * leave gaps). `endMs` = `tStartMs + dDurationMs` (no "+5 s" heuristic like
     * the desktop's `loadTranscript`, since real durations are available).
     */
    fun parseJson3(raw: String): List<TranscriptCue> {
        val events = try {
            (json.parseToJsonElement(raw) as? JsonObject)?.get("events") as? JsonArray
        } catch (e: Exception) {
            throw ParseException("malformed JSON3 caption payload", e)
        } ?: return emptyList()

        val cues = mutableListOf<TranscriptCue>()
        var startIndex = -1
        var startMs = -1L
        var endMs = -1L
        val text = StringBuilder()

        fun flush() {
            if (startIndex >= 0 && text.isNotBlank()) {
                cues += TranscriptCue(startIndex, startMs, endMs, text.toString().trim())
            }
            text.clear()
        }

        events.forEachIndexed { eventIndex, element ->
            val obj = element as? JsonObject ?: return@forEachIndexed
            val tStart = (obj["tStartMs"] as? JsonPrimitive)?.longOrNull
            if (tStart != null) {
                flush()
                startIndex = eventIndex
                startMs = tStart
                endMs = tStart + ((obj["dDurationMs"] as? JsonPrimitive)?.longOrNull ?: 0L)
                text.append(segsUtf8(obj))
            } else if (startIndex >= 0) {
                // aAppend (or an unknown non-start event): accumulate into the
                // previous cue; extend its end if a duration is given.
                text.append(segsUtf8(obj))
                val dur = (obj["dDurationMs"] as? JsonPrimitive)?.longOrNull
                if (dur != null && dur > 0) endMs = startMs + dur
            }
        }
        flush()
        return cues
    }

    private fun segsUtf8(obj: JsonObject): String =
        (obj["segs"] as? JsonArray)
            ?.mapNotNull { seg -> ((seg as? JsonObject)?.get("utf8") as? JsonPrimitive)?.contentOrNull }
            ?.joinToString("") ?: ""

    // --- XML (parseCuesXml port) ---------------------------------------------

    private val SRV3_P = Regex("""<p\s+t="(\d+)"(?:[^>]*?\sd="(\d+)")?[^>]*>([\s\S]*?)</p>""")
    private val SRV3_S = Regex("""<s[^>]*>([^<]*)</s>""")
    private val STRIP_TAGS = Regex("""<[^>]+>""")
    private val TEXT_TAG = Regex("""<text\s+start="([^"]*)"(?:[^>]*?\sdur="([^"]*)")?[^>]*>([\s\S]*?)</text>""")
    private val COLLAPSE_WS = Regex("""\s{2,}""")

    /** Port of the desktop `parseCuesXml`: srv3 first, then the simple format. */
    fun parseXml(xml: String): List<TranscriptCue> {
        parseSrv3(xml).let { if (it.isNotEmpty()) return it }
        return parseTextFormat(xml)
    }

    // srv3: <p t="ms" d="ms"><s>word</s>…</p> — one line = one cue.
    private fun parseSrv3(xml: String): List<TranscriptCue> {
        val cues = mutableListOf<TranscriptCue>()
        for (m in SRV3_P.findAll(xml)) {
            val startMs = m.groupValues[1].toLongOrNull() ?: continue
            val durMs = m.groupValues[2].toLongOrNull() ?: 0L
            val inner = m.groupValues[3]
            var text = ""
            for (s in SRV3_S.findAll(inner)) text += s.groupValues[1]
            if (text.isEmpty()) text = STRIP_TAGS.replace(inner, "")
            text = clean(text)
            if (text.isNotEmpty()) cues += TranscriptCue(cues.size, startMs, startMs + durMs, text)
        }
        return cues
    }

    // Simple format: <text start="s" dur="s">…</text> — timestamps in seconds.
    private fun parseTextFormat(xml: String): List<TranscriptCue> {
        val cues = mutableListOf<TranscriptCue>()
        for (m in TEXT_TAG.findAll(xml)) {
            val start = m.groupValues[1].toFloatOrNull() ?: 0f
            val dur = m.groupValues[2].toFloatOrNull() ?: 0f
            val text = clean(STRIP_TAGS.replace(m.groupValues[3], ""))
            if (text.isNotEmpty()) {
                cues += TranscriptCue(cues.size, (start * 1000).toLong(), ((start + dur) * 1000).toLong(), text)
            }
        }
        return cues
    }

    // Collapse whitespace first, then decode entities — same order as the TS.
    private fun clean(text: String): String =
        decodeEntities(text.replace('\n', ' ').replace(COLLAPSE_WS, " ")).trim()

    private fun decodeEntities(text: String): String {
        var s = text
            .replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
            .replace("&quot;", "\"").replace("&#39;", "'").replace("&apos;", "'")
        s = HEX_ENTITY.replace(s) { m ->
            val cp = m.groupValues[1].toIntOrNull(16)
            if (cp != null && cp in 0..0x10FFFF) String(Character.toChars(cp)) else m.value
        }
        s = DEC_ENTITY.replace(s) { m ->
            val cp = m.groupValues[1].toIntOrNull()
            if (cp != null && cp in 0..0x10FFFF) String(Character.toChars(cp)) else m.value
        }
        return s
    }

    private val HEX_ENTITY = Regex("&#x([0-9a-fA-F]+);")
    private val DEC_ENTITY = Regex("&#(\\d+);")
}