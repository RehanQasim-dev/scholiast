package com.scholiast.android.domain.transcript

/**
 * Port of the desktop `semanticChunk` (`video-transcript.ts`) — Defuddle's
 * `groupBySentence` algorithm adapted to cue objects. A paragraph is a run of
 * consecutive cues; cues are never split mid-word (they never split at all).
 *
 * Break signals, in priority order:
 *  - sentence end on the current cue (`.!?` plus CJK punctuation, optionally
 *    followed by a closing quote/bracket);
 *  - a long speech pause — the gap between two **consecutive** cue starts
 *    exceeding [GROUP_GAP_MS];
 *  - an unpunctuated run whose span from the paragraph's first cue start
 *    reaches [MAX_GROUP_MS] (flushed at the cue boundary).
 *
 * Mid-cue sentence boundaries ("…compiler. And neither…" inside one cue) are
 * handled by [splitOnInternalSentences]; [semanticChunk] alone assumes every
 * sentence ends at a cue boundary, which matches the TS byte-for-byte.
 */
object TranscriptChunker {

    private val SENT_END = Regex("""[.!?。！？]["')\]’”]?\s*$""")
    private const val GROUP_GAP_MS = 20_000L   // TRANSCRIPT_GROUP_GAP_SECONDS = 20
    private const val MAX_GROUP_MS = 30_000L   // TRANSCRIPT_MAX_GROUP_SECONDS = 30

    private val INTERNAL_SENT_RE = Regex("""([.!?。！？]["')\]’”]?)\s+(?=[A-Z“"‘'])""")

    /**
     * Pre-split cues that carry a mid-cue sentence boundary into separate cues.
     * Both halves keep the original cue's start/end (timestamps within a split
     * cue resolve to the same millisecond — fine granularity loss; the chunk
     * boundary is what matters). Emitted indexes are sequential.
     */
    fun splitOnInternalSentences(cues: List<TranscriptCue>): List<TranscriptCue> {
        val out = mutableListOf<TranscriptCue>()
        for (c in cues) {
            val positions = mutableListOf<Int>()
            for (m in INTERNAL_SENT_RE.findAll(c.text)) {
                positions += m.range.first + m.groupValues[1].length
            }
            if (positions.isEmpty()) {
                out += c.copy(index = out.size)
                continue
            }
            var prev = 0
            for (pos in positions) {
                val piece = c.text.substring(prev, pos).trim()
                if (piece.isNotEmpty()) out += TranscriptCue(out.size, c.startMs, c.endMs, piece)
                prev = pos
            }
            val tail = c.text.substring(prev).trim()
            if (tail.isNotEmpty()) out += TranscriptCue(out.size, c.startMs, c.endMs, tail)
        }
        return out
    }

    /**
     * Exact port of the desktop `semanticChunk`. Returns paragraphs built from
     * the grouped cue runs.
     */
    fun semanticChunk(cues: List<TranscriptCue>): List<TranscriptParagraph> {
        if (cues.isEmpty()) return emptyList()
        val paragraphs = mutableListOf<TranscriptParagraph>()
        val pending = mutableListOf<TranscriptCue>()

        fun flush() {
            if (pending.isNotEmpty()) {
                paragraphs += buildParagraph(paragraphs.size, pending)
                pending.clear()
            }
        }

        for (c in cues) {
            val prev = pending.lastOrNull()
            if (prev != null && c.startMs - prev.startMs > GROUP_GAP_MS) flush()
            pending += c
            if (SENT_END.containsMatchIn(c.text)) { flush(); continue }
            if (c.startMs - pending.first().startMs >= MAX_GROUP_MS) flush()
        }
        flush()
        return paragraphs
    }

    /** The full pipeline the transcript panel should call: internal-sentence
     * split, then semantic grouping. */
    fun chunk(cues: List<TranscriptCue>): List<TranscriptParagraph> =
        semanticChunk(splitOnInternalSentences(cues))

    private fun buildParagraph(index: Int, cues: List<TranscriptCue>): TranscriptParagraph =
        TranscriptParagraph(
            index = index,
            text = cues.joinToString(" ") { it.text },
            startMs = cues.first().startMs,
            endMs = cues.last().endMs,
            cueRange = cues.first().index..cues.last().index,
        )
}