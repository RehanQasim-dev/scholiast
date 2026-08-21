package com.scholiast.android.ui.reader

import com.scholiast.android.data.model.PageHighlight
import com.scholiast.android.data.notes.makeVideoNote
import com.scholiast.android.data.notes.noteId
import com.scholiast.android.data.notes.noteVersion
import com.scholiast.android.data.notes.parseVideoNote
import com.scholiast.android.data.notes.withEditedMark

/**
 * The logic core of the reader's comment-thread actions (Task 31, plan §5.5) —
 * pure JVM over [PageHighlight] lists, no Android/Compose dependencies, so
 * every rule unit-tests in `HighlightActionsControllerTest`.
 *
 * Desktop parity (`src/utils/highlighter.ts` + §3.2 of the repo AGENTS.md):
 * - A multi-block selection produces several pieces sharing `extras.groupId`;
 *   the thread's `notes[]` live on ONE piece — the **representative** (first
 *   piece in list order = document order). Replies append there; edit/delete
 *   address indexes into that array.
 * - Note strings are the chat-message format shared with the desktop:
 *   `text<!--timestamp:N-->` ([makeVideoNote]; N = the comment's stable sync
 *   id) and edits restamp `<!--edited:M-->` while keeping the original
 *   timestamp ([withEditedMark]).
 * - Whole-thread delete is gated at ≥2 replies (below that, deleting the last
 *   reply IS deleting the thread).
 * - Every mutation stamps `updatedAt` newest-wins, mirroring
 *   `RoomPageHighlightRepository`'s merge rule.
 *
 * Threads are addressed by [key]: a `groupId` when grouped, else the single
 * highlight's id. Both resolve through [piecesOf].
 */
object HighlightActionsController {

    /** Why a whole-thread delete was refused. */
    enum class DeleteBlockReason { NOT_FOUND, TOO_FEW_REPLIES }

    /** Outcome of [deleteThread]: the new list plus the refusal reason when gated. */
    sealed interface ThreadDeleteResult {
        data class Deleted(val highlights: List<PageHighlight>) : ThreadDeleteResult

        /** Gated: [highlights] is the input list UNCHANGED. */
        data class Blocked(
            val reason: DeleteBlockReason,
            val highlights: List<PageHighlight>,
        ) : ThreadDeleteResult
    }

    /**
     * Immutable pre-delete snapshot — the snackbar Undo payload. Holds the WHOLE
     * list before deletion (desktop parity: the dashboard snapshots the page
     * record before an optimistic delete), so [restore] rewinds exactly.
     */
    data class DeleteUndo(val highlightsBefore: List<PageHighlight>)

    // ------------------------------------------------------------------
    // Resolution
    // ------------------------------------------------------------------

    /**
     * Every piece of the annotation [key] addresses: all highlights sharing
     * `extras.groupId` when [key] names a group, else the one highlight with
     * that id. Empty when nothing matches.
     */
    fun piecesOf(highlights: List<PageHighlight>, key: String): List<PageHighlight> {
        val byGroup = highlights.filter { HighlightController.groupIdOf(it) == key }
        if (byGroup.isNotEmpty()) return byGroup
        return highlights.filter { it.id == key }
    }

    /**
     * The representative piece whose `notes[]` hold the thread — the FIRST
     * piece in list order (document order), matching where the desktop puts
     * comments for grouped selections.
     */
    fun ownerOf(highlights: List<PageHighlight>, key: String): PageHighlight? =
        piecesOf(highlights, key).firstOrNull()

    fun replyCount(owner: PageHighlight?): Int = owner?.notes?.size ?: 0

    /** Whole-thread delete is allowed only once the thread holds 2+ replies. */
    fun canDeleteThread(highlights: List<PageHighlight>, key: String): Boolean =
        replyCount(ownerOf(highlights, key)) >= 2

    /** TalkBack announcement for the sheet's pinned quote (plan §6.4). */
    fun announceLabel(color: String?, replyCount: Int): String =
        "${color ?: "yellow"} highlight, $replyCount " + if (replyCount == 1) "comment" else "comments"

    // ------------------------------------------------------------------
    // Replies
    // ------------------------------------------------------------------

    /**
     * Append [text] to the representative's `notes[]` as
     * `text<!--timestamp:N-->` (N = [now]); blank text is a no-op. Stamps the
     * owner's `updatedAt` newest-wins.
     */
    fun addReply(
        highlights: List<PageHighlight>,
        key: String,
        text: String,
        now: () -> Long = System::currentTimeMillis,
    ): List<PageHighlight> {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return highlights
        val owner = ownerOf(highlights, key) ?: return highlights
        val t = now()
        val updated = owner.copy(
            notes = (owner.notes ?: emptyList()) + makeVideoNote(trimmed, t),
            updatedAt = t,
        )
        return replacePiece(highlights, updated)
    }

    /**
     * Replace `notes[index]` with [newText], keeping the ORIGINAL timestamp
     * marker (the stable sync id) and stamping `<!--edited:M-->`:
     * `newText<!--timestamp:N--><!--edited:M-->`. Blank text or a bad index is
     * a no-op (the UI disables Save on blank drafts anyway).
     */
    fun editReply(
        highlights: List<PageHighlight>,
        key: String,
        index: Int,
        newText: String,
        now: () -> Long = System::currentTimeMillis,
    ): List<PageHighlight> {
        val trimmed = newText.trim()
        if (trimmed.isEmpty()) return highlights
        val owner = ownerOf(highlights, key) ?: return highlights
        val notes = owner.notes ?: return highlights
        if (index !in notes.indices) return highlights
        val t = now()
        val originalTs = parseVideoNote(notes[index]).timestamp
        val base = originalTs?.let { makeVideoNote(trimmed, it) } ?: trimmed
        val updatedNotes = notes.toMutableList().also { it[index] = withEditedMark(base, t) }
        return replacePiece(highlights, owner.copy(notes = updatedNotes, updatedAt = t))
    }

    /**
     * Remove `notes[index]`; an empty remaining thread stores `notes = null`.
     * Bad index is a no-op. Stamps the owner's `updatedAt`.
     */
    fun deleteReply(
        highlights: List<PageHighlight>,
        key: String,
        index: Int,
        now: () -> Long = System::currentTimeMillis,
    ): List<PageHighlight> {
        val owner = ownerOf(highlights, key) ?: return highlights
        val notes = owner.notes ?: return highlights
        if (index !in notes.indices) return highlights
        val remaining = notes.toMutableList().also { it.removeAt(index) }
        val updated = owner.copy(
            notes = remaining.takeIf { it.isNotEmpty() },
            updatedAt = now(),
        )
        return replacePiece(highlights, updated)
    }

    // ------------------------------------------------------------------
    // Thread delete (gated) + undo
    // ------------------------------------------------------------------

    /**
     * Remove EVERY piece of the thread — but only once it holds ≥2 replies
     * (desktop parity: below that the per-reply delete already empties it).
     * Gated calls return [ThreadDeleteResult.Blocked] carrying the UNCHANGED
     * list; persistence layers turn the removal into sync tombstones.
     */
    fun deleteThread(highlights: List<PageHighlight>, key: String): ThreadDeleteResult {
        val pieces = piecesOf(highlights, key)
        if (pieces.isEmpty()) return ThreadDeleteResult.Blocked(DeleteBlockReason.NOT_FOUND, highlights)
        if (replyCount(pieces.first()) < 2) {
            return ThreadDeleteResult.Blocked(DeleteBlockReason.TOO_FEW_REPLIES, highlights)
        }
        val ids = pieces.map { it.id }.toSet()
        return ThreadDeleteResult.Deleted(highlights.filterNot { it.id in ids })
    }

    /**
     * Snapshot the list for Undo BEFORE deleting. Null when the thread doesn't
     * exist (nothing could be deleted, so there is nothing to undo).
     */
    fun snapshotForUndo(highlights: List<PageHighlight>, key: String): DeleteUndo? =
        if (piecesOf(highlights, key).isEmpty()) null else DeleteUndo(highlights.toList())

    /** Rewind to the exact pre-delete state (desktop: the snapshotted record wins). */
    fun restore(undo: DeleteUndo): List<PageHighlight> = undo.highlightsBefore.toList()

    // ------------------------------------------------------------------
    // Recolor
    // ------------------------------------------------------------------

    /**
     * Set [color] on ALL pieces sharing the thread's `extras.groupId` (an
     * ungrouped thread recolors just its own piece), restamping every touched
     * `updatedAt` so the sync merge propagates newest-wins — same rule as
     * [HighlightController.recolor].
     */
    fun recolor(
        highlights: List<PageHighlight>,
        key: String,
        color: String,
        now: () -> Long = System::currentTimeMillis,
    ): List<PageHighlight> {
        val target = ownerOf(highlights, key) ?: return highlights
        val gid = HighlightController.groupIdOf(target)
        val t = now()
        return highlights.map { hl ->
            val member = if (gid != null) HighlightController.groupIdOf(hl) == gid else hl.id == target.id
            if (member) hl.copy(color = color, updatedAt = t) else hl
        }
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /** Convenience readers re-exported for callers pinning formats in tests/UI. */
    fun noteStableId(note: String): String = noteId(note)

    fun noteEditedVersion(note: String): Long = noteVersion(note)

    private fun replacePiece(highlights: List<PageHighlight>, piece: PageHighlight): List<PageHighlight> =
        highlights.map { if (it.id == piece.id) piece else it }
}
