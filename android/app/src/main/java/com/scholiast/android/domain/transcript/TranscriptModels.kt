package com.scholiast.android.domain.transcript

/**
 * A single caption cue: one `tStartMs` event in the JSON3 `events` array, plus
 * any `aAppend` events that accumulate into its text.
 *
 * `index` is the cue's position in the events array — the stable anchor key the
 * app's `TranscriptAnchor(startCue, startOffset, endCue, endOffset)` scheme is
 * built on (plan §5.6.3). Because `aAppend` events never create cues of their
 * own, indexes can be non-contiguous (e.g. [0, 2, 3] when event 1 was an
 * append).
 */
data class TranscriptCue(
    val index: Int,
    val startMs: Long,
    val endMs: Long,
    val text: String,
)

/**
 * A readable paragraph: a run of consecutive cues grouped by [TranscriptChunker].
 * `text` is the cue texts joined with a single space (for display/search); the
 * per-cue `text`/`startMs`/`endMs` stay on the cues for offset anchoring and
 * live follow. `cueRange` spans the first..last cue index it covers (the range
 * may include indexes that produced no cue, e.g. append events).
 */
data class TranscriptParagraph(
    val index: Int,
    val text: String,
    val startMs: Long,
    val endMs: Long,
    val cueRange: IntRange,
)

/**
 * One entry of the player response's `captions.playerCaptionsTracklistRenderer
 * .captionTracks[]` list. `isAsr` marks machine-generated tracks (`kind: "asr"`),
 * which the track picker deprioritizes.
 */
data class CaptionTrack(
    val languageCode: String,
    val name: String,
    val baseUrl: String,
    val isAsr: Boolean,
)

/** A fully loaded transcript: the track list (for the language picker), the
 * cues, and the chunked paragraphs. */
data class LoadedTranscript(
    val videoId: String,
    val languageCode: String,
    val tracks: List<CaptionTrack>,
    val cues: List<TranscriptCue>,
    val paragraphs: List<TranscriptParagraph>,
)

/**
 * Typed outcome of [TranscriptClient.getTranscript]. The UI renders each case
 * differently: an offline banner for [NetworkError], a "no captions for this
 * video" hint for [NoCaptions] (Transcript tab disabled), a 404/HTTP banner
 * for [HttpError], a parse-error toast for [ParseError].
 */
sealed interface TranscriptResult {
    data class Success(val transcript: LoadedTranscript) : TranscriptResult
    data object NoCaptions : TranscriptResult
    data class HttpError(val statusCode: Int) : TranscriptResult
    data class NetworkError(val cause: Throwable?) : TranscriptResult
    data class ParseError(val message: String, val cause: Throwable?) : TranscriptResult
}