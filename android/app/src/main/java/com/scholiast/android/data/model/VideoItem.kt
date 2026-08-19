package com.scholiast.android.data.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * Anchors a transcript highlight back onto the caption track so it can be
 * repainted when the transcript panel reopens. Caption cues are immutable per
 * video, so (cue index + char offset) is a stable anchor — no fragile XPath.
 *
 * Mirrors `TranscriptAnchor` in `src/utils/video/video-storage.ts` byte-for-byte.
 */
@Serializable
data class TranscriptAnchor(
    val startCue: Int,
    val startOffset: Int,
    val endCue: Int,
    val endOffset: Int,
)

/**
 * Metadata for a captured frame. The JPEG bytes NEVER live here — on Android
 * they are real files in `filesDir/frames/<itemId>.jpg` (desktop: IndexedDB),
 * referenced by id. [driveId] is the Drive blob id for cross-device sync of the
 * image.
 *
 * Mirrors `VideoFrameImage` in `video-storage.ts`. Field order matches the TS
 * interface (`dataUrl`, `driveId`, `w`, `h`) so serialized output is byte-identical.
 * [dataUrl] is the desktop's runtime-only field (stripped on every persisted
 * write) — kept here, nullable, so desktop in-memory items parse losslessly; the
 * app never writes it (`explicitNulls` omits it, exactly like the desktop).
 */
@Serializable
data class FrameImage(
    val dataUrl: String? = null,
    val driveId: String? = null,
    val w: Int,
    val h: Int,
)

/**
 * One video annotation item: a frame capture, a timestamped note, or a
 * transcript highlight. Mirrors `VideoItem` in `video-storage.ts` byte-for-byte,
 * with one app-only additive field, [ocrText].
 *
 * - [kind]: `"frame"` | `"note"` | `"transcript"` (TS union type; kept a String).
 * - [videoTime]: seconds into the video (range START for transcript items).
 * - [notes]: chat messages in the `text<!--timestamp:N--><!--edited:M-->` format
 *   (see `data/notes/VideoNote.kt` for parse/format helpers).
 * - [excalidrawScene]: preserved verbatim (JsonElement) for desktop compat —
 *   the app's native drawings express through [markup], never this field.
 * - [ocrText]: app-only (Gemma OCR, frame items); additive fields don't break
 *   desktop compat (the desktop parses JSON into plain objects and ignores
 *   unknown keys).
 */
@Serializable
data class VideoItem(
    val id: String,
    val kind: String,
    @Serializable(with = JsDoubleSerializer::class) val videoTime: Double,
    val frame: FrameImage? = null,
    val markup: VideoMarkup? = null,
    val notes: List<String> = emptyList(),
    val updatedAt: Long? = null,
    // --- transcript-only fields ---
    @Serializable(with = JsDoubleSerializer::class) val timeEnd: Double? = null,
    val quote: String? = null,
    val color: String? = null,
    val anchor: TranscriptAnchor? = null,
    val excalidrawScene: JsonElement? = null,
    // --- app-only additive field ---
    val ocrText: String? = null,
)