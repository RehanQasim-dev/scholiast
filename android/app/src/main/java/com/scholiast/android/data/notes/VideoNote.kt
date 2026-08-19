package com.scholiast.android.data.notes

/**
 * Note-string helpers for the chat-message format shared with the desktop:
 * `text<!--timestamp:N--><!--edited:M-->`. The timestamp is the comment's stable
 * ID for sync merge; the edited marker records the last-edit time. Ported from
 * `src/utils/video/video-notes.ts` (`parseVideoNote`/`makeVideoNote`) and
 * `shared/merge.ts` (`commentId`/`commentVersion`).
 */

private val TIMESTAMP_RE = Regex("<!--timestamp:(\\d+)-->")
private val EDITED_RE = Regex("<!--edited:(\\d+)-->")

/** A parsed note: the plain text plus the embedded markers, if any. */
data class ParsedNote(
    val text: String,
    val timestamp: Long?,
    val edited: Long?,
)

/**
 * Mirrors the TS `parseVideoNote`: strips the markers (first occurrence each,
 * like the TS `.replace(string)`), trims the text, and reports the times.
 */
fun parseVideoNote(note: String): ParsedNote {
    val tsMatch = TIMESTAMP_RE.find(note)
    val edMatch = EDITED_RE.find(note)
    val text = note
        .replaceFirst(TIMESTAMP_RE, "")
        .replaceFirst(EDITED_RE, "")
        .trim()
    return ParsedNote(
        text = text,
        timestamp = tsMatch?.groupValues?.get(1)?.toLongOrNull(),
        edited = edMatch?.groupValues?.get(1)?.toLongOrNull(),
    )
}

/** Mirrors the TS `makeVideoNote`: `"$text<!--timestamp:$timestamp-->"`. */
fun makeVideoNote(text: String, timestamp: Long): String =
    "${text}<!--timestamp:${timestamp}-->"

/**
 * Marks a note as edited at [editedAt] (ms). Keeps the original timestamp marker
 * (the stable id) and appends `<!--edited:M-->`. The voice-edit pipeline (plan
 * §5.5.3 "stamps `<!--edited:N-->`") and every comment edit go through this, so
 * a note never loses its id or gains a duplicate edited marker.
 */
fun withEditedMark(note: String, editedAt: Long): String {
    val parsed = parseVideoNote(note)
    val ts = parsed.timestamp
    return if (ts != null) {
        "${parsed.text}<!--timestamp:$ts--><!--edited:$editedAt-->"
    } else {
        "${parsed.text}<!--edited:$editedAt-->"
    }
}

/**
 * The comment's stable id for sync merge — the timestamp string, falling back to
 * the raw text for legacy notes without a marker. Mirrors `shared/merge.ts`'s
 * `commentId`.
 */
fun noteId(note: String): String =
    TIMESTAMP_RE.find(note)?.groupValues?.get(1) ?: note

/**
 * The comment's version for sync conflict resolution — edited marker if present,
 * else the timestamp, else 0. Mirrors `shared/merge.ts`'s `commentVersion`.
 */
fun noteVersion(note: String): Long =
    EDITED_RE.find(note)?.groupValues?.get(1)?.toLongOrNull()
        ?: TIMESTAMP_RE.find(note)?.groupValues?.get(1)?.toLongOrNull()
        ?: 0L