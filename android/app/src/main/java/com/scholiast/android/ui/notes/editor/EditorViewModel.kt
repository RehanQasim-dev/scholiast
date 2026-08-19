package com.scholiast.android.ui.notes.editor

import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import com.scholiast.android.data.notes.TagIndex
import com.scholiast.android.data.notes.makeVideoNote
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * The bottom-sheet comment editor's state holder (plan §5.4, task 07): the
 * light-markdown draft, the markdown insert commands (bold/italic/bullet/
 * checklist/link), and the `#tag` autocomplete fed by Task 02's [TagIndex].
 *
 * The class is deliberately a plain state holder, not an androidx `ViewModel`:
 * it is scoped to one sheet instance (`remember { }` in `CommentEditorSheet`),
 * so each draft opening gets a fresh instance and nothing leaks into the
 * activity's ViewModelStore. All mutations are synchronous except
 * [onFieldChanged] (tag suggestions hit the [TagIndex]); like `NotesViewModel`,
 * suspend methods update the StateFlow in the calling coroutine, so unit tests
 * run deterministically with `runBlocking` (no Main dispatcher).
 *
 * Serialization targets the comment-markdown subset shared with the desktop
 * (`src/utils/comment-markdown.ts`): `**bold** *italic* [text](url) bare urls
 * `#tag` `- item` `- [ ] task`. Task 08's `CommentRenderer` is the inverse.
 *
 * @param tagIndex the `#tag` suggestion source; null hides autocomplete
 *   (a stub when Task 02's index is absent).
 * @param initialText the draft's starting text (reply edits, voice drafts).
 * @param clock millisecond clock for the stamped-note id (test injection).
 */
class EditorViewModel(
    private val tagIndex: TagIndex?,
    initialText: String = "",
    private val clock: () -> Long = System::currentTimeMillis,
) {

    private val _state = MutableStateFlow(
        EditorUiState(field = TextFieldValue(initialText)),
    )
    val state: StateFlow<EditorUiState> = _state.asStateFlow()

    /** Field edits from `BasicTextField` (text, caret, and selection in one). */
    suspend fun onFieldChanged(field: TextFieldValue) {
        val collapsed = field.selection.collapsed
        val token = if (collapsed) tagTokenAt(field.text, field.selection.start) else null
        val suggestions = if (token != null && tagIndex != null) {
            tagIndex.suggest(token.tag, TAG_SUGGESTION_LIMIT)
        } else {
            emptyList()
        }
        _state.update {
            it.copy(
                field = field,
                activeTagToken = token,
                tagSuggestions = suggestions,
            )
        }
    }

    /**
     * Apply a toolbar command around the current selection (or the caret).
     * One atomic text edit per call, so `BasicTextField`'s undo stack treats
     * each button press as a single step.
     */
    fun applyCommand(command: EditorCommand) {
        val field = _state.value.field
        val range = field.selection
        val edit = when (command) {
            EditorCommand.BOLD -> toggleSurround(field.text, range.start, range.end, "**")
            EditorCommand.ITALIC -> toggleSurround(field.text, range.start, range.end, "*")
            EditorCommand.BULLET -> applyLineCommand(field.text, range.start, range.end, wantTask = false)
            EditorCommand.CHECKLIST -> applyLineCommand(field.text, range.start, range.end, wantTask = true)
        }
        setEdit(edit)
    }

    /**
     * Wrap the selection as `[text](url)` (desktop `[text](url)` command).
     * Empty selection → `[](url)` with the caret inside the parens, ready to
     * type the URL. `https://` is prepended when [url] has no scheme (the
     * renderer only links http(s) URLs).
     */
    fun applyLink(url: String) {
        val field = _state.value.field
        val range = field.selection
        val target = if (url.startsWith("http://") || url.startsWith("https://")) url else "https://$url"
        val edit = insertLink(field.text, range.start, range.end, target)
        setEdit(edit)
    }

    /**
     * Replace the `#token` under the caret with the chosen [tag] (suggestions
     * are stored WITHOUT the `#`; the stored text keeps it), then close the
     * list. No-op when no token is active.
     */
    fun insertTag(tag: String) {
        val current = _state.value
        val token = current.activeTagToken ?: return
        val replacement = "#" + tag.trim().removePrefix("#")
        val newText = current.field.text.replaceRange(token.start, token.end, replacement)
        val caret = token.start + replacement.length
        _state.update {
            it.copy(
                field = it.field.copy(text = newText, selection = TextRange(caret)),
                activeTagToken = null,
                tagSuggestions = emptyList(),
            )
        }
    }

    /** Close the tag-suggestion list (arrow-key Escape, tap elsewhere). */
    fun dismissSuggestions() {
        _state.update { it.copy(activeTagToken = null, tagSuggestions = emptyList()) }
    }

    /**
     * The stored markdown for this draft: any pasted `<!--timestamp:N-->` /
     * `<!--edited:M-->` markers stripped (the save path stamps its own), the
     * text trimmed. This is what the sheet hands to `onSave`.
     */
    fun serialize(): String = serializeComment(_state.value.field.text)

    /**
     * The full note string in the chat-message format
     * `text<!--timestamp:N-->` (Task 02's `makeVideoNote`) — for consumers
     * that persist directly (Tasks 13/14). `NotesTab` stamps its own id, so
     * it uses [serialize] instead. Null when the draft is blank.
     */
    fun finalizeNote(): String? =
        serialize().takeIf { it.isNotBlank() }?.let { makeVideoNote(it, clock()) }

    /** The `#tags` in the draft, without the `#` prefix (feed [TagIndex] on save). */
    fun tagsInText(): List<String> = extractTags(_state.value.field.text)

    /** Fold this draft's tags into the index (desktop: feed on every save). */
    suspend fun feedTags() {
        val tags = tagsInText()
        if (tags.isNotEmpty()) tagIndex?.addTags(tags)
    }

    private fun setEdit(edit: TextEdit) {
        _state.update {
            it.copy(
                field = it.field.copy(text = edit.text, selection = TextRange(edit.caret)),
                activeTagToken = null,
                tagSuggestions = emptyList(),
            )
        }
    }
}

/** The toolbar commands (plan §5.4 formatting row). */
enum class EditorCommand { BOLD, ITALIC, BULLET, CHECKLIST }

/** One command's result: the new text and where the caret should land. */
data class TextEdit(val text: String, val caret: Int)

/** UI state of the editor sheet. */
data class EditorUiState(
    val field: TextFieldValue = TextFieldValue(""),
    /** The `#token` the caret sits inside (start/end offsets, tag with `#`), or null. */
    val activeTagToken: TagToken? = null,
    /** Autocomplete candidates, WITHOUT the `#` prefix (TagIndex's storage form). */
    val tagSuggestions: List<String> = emptyList(),
) {
    val text: String get() = this.field.text
    val isEmpty: Boolean get() = this.field.text.isBlank()
    val showTagSuggestions: Boolean get() = activeTagToken != null && tagSuggestions.isNotEmpty()
}

/** A `#tag` token in the draft: [tag] includes the `#`. */
data class TagToken(val start: Int, val end: Int, val tag: String)

// --- Pure markdown command transforms (JVM-tested) ----------------------------

/**
 * Clamp a `(start, endExclusive)` selection to the text bounds. `TextFieldValue`
 * selections are exclusive-end, so an end of `length` selects through the last
 * char and a collapsed caret at `length` is the empty selection at the very end.
 */
private fun clampSel(start: Int, end: Int, length: Int): Pair<Int, Int> {
    val s = start.coerceIn(0, length)
    val e = end.coerceIn(s, length)
    return s to e
}

/**
 * Surround the selection with [marker] (`**`, `*`), toggling off when the
 * selection is already surrounded (mirrors the desktop's toolbar toggle).
 * An empty selection unwraps when the caret sits INSIDE an existing marker
 * pair (caret between `**`/`*` and its close), otherwise it inserts an empty
 * pair with the caret between the markers.
 */
fun toggleSurround(text: String, selStart: Int, selEnd: Int, marker: String): TextEdit {
    val (s, e) = clampSel(selStart, selEnd, text.length)
    val before = text.take(s)
    val after = text.drop(e)
    val sel = text.substring(s, e)
    val unwraps = if (sel.isEmpty()) {
        before.endsWith(marker) && after.contains(marker)
    } else {
        before.endsWith(marker) && after.startsWith(marker)
    }
    return if (unwraps) {
        val b = before.dropLast(marker.length)
        val a = if (sel.isEmpty()) after.replaceFirst(marker, "") else after.drop(marker.length)
        TextEdit(b + sel + a, b.length + sel.length)
    } else {
        val wrapped = marker + sel + marker
        TextEdit(
            text = before + wrapped + after,
            caret = if (sel.isEmpty()) before.length + marker.length else before.length + wrapped.length,
        )
    }
}

private val TASK_MARKER_RE = Regex("""^([-*])\s+\[[ xX]\]\s*(.*)$""")
private val BULLET_MARKER_RE = Regex("""^([-*])\s+(.*)$""")

/**
 * Apply the bullet (`- `) / checklist (`- [ ] `) command to every line the
 * selection touches. Mirrors the desktop `applyCommentFormat`: same kind again
 * toggles the marker off, a different kind converts in place, a plain line gets
 * the marker. Stored markers always use `- ` (the desktop's stored form).
 */
fun applyLineCommand(text: String, selStart: Int, selEnd: Int, wantTask: Boolean): TextEdit {
    val (s, e) = clampSel(selStart, selEnd, text.length)
    var lineStart = 0
    var lineEnd: Int
    var caret = 0
    var out = ""
    while (lineStart < text.length) {
        val nextBreak = text.indexOf('\n', lineStart)
        lineEnd = if (nextBreak < 0) text.length else nextBreak
        // Only lines that intersect the selection are edited. The end bound is
        // inclusive so a caret at a line's start (or a selection ending at a
        // line boundary) counts that line.
        if (lineEnd > s && lineStart <= e) {
            val line = text.substring(lineStart, lineEnd)
            val edited = toggleLineMarker(line, wantTask)
            out += edited
            caret = out.length
        } else {
            out += text.substring(lineStart, lineEnd)
        }
        if (lineEnd < text.length) {
            out += "\n"
            caret += 1
        }
        lineStart = lineEnd + 1
    }
    return TextEdit(out, caret.coerceIn(0, out.length))
}

/** Toggle/convert one line's `- ` / `- [ ] ` marker per the desktop rules. */
fun toggleLineMarker(line: String, wantTask: Boolean): String {
    val task = TASK_MARKER_RE.matchEntire(line)
    val bullet = if (task == null) BULLET_MARKER_RE.matchEntire(line) else null
    return when {
        wantTask && task != null -> task.groupValues[2]
        wantTask && bullet != null -> "- [ ] " + bullet.groupValues[2]
        wantTask -> "- [ ] " + line
        !wantTask && bullet != null -> bullet.groupValues[2]
        !wantTask && task != null -> "- " + task.groupValues[2]
        else -> "- " + line
    }
}

/** Wrap the selection as `[text](url)`; empty selection → `[](url)`, caret inside. */
fun insertLink(text: String, selStart: Int, selEnd: Int, url: String): TextEdit {
    val (s, e) = clampSel(selStart, selEnd, text.length)
    val sel = text.substring(s, e)
    val wrapped = if (sel.isEmpty()) "[]($url)" else "[$sel]($url)"
    val caret = if (sel.isEmpty()) s + "[](".length else s + wrapped.length
    return TextEdit(text.replaceRange(s, e, wrapped), caret)
}

/** A `#token` at [caret]: token must start with `#` after start-of-text or whitespace. */
fun tagTokenAt(text: String, caret: Int): TagToken? {
    if (caret < 0 || caret > text.length) return null
    var start = caret
    while (start > 0 && isTagChar(text[start - 1])) start--
    if (start >= text.length || text[start] != '#') return null
    if (start > 0 && !text[start - 1].isWhitespace()) return null
    var end = start + 1
    while (end < text.length && isTagChar(text[end])) end++
    return TagToken(start, end, text.substring(start, end))
}

private fun isTagChar(c: Char): Boolean = c.isLetterOrDigit() || c == '_' || c == '-' || c == '/' || c == '#'

// --- Serialization (comment-markdown subset, shared with the desktop) ---------

private val TIMESTAMP_MARKER_RE = Regex("""<!--timestamp:(\d+)-->""")
private val EDITED_MARKER_RE = Regex("""<!--edited:(\d+)-->""")

/** A `#tag` token — must start the text or follow whitespace (desktop TAG_RE rule). */
val TAG_TOKEN_RE = Regex("""(^|\s)(#[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*)""")

/**
 * Draft text → stored markdown: strip any pasted id/edited markers (the save
 * path stamps its own `<!--timestamp:N-->`) and trim. The rest of the subset
 * is written as-is — the field is plain text, and Task 08's renderer is the
 * inverse.
 */
fun serializeComment(text: String): String =
    text.replace(TIMESTAMP_MARKER_RE, "")
        .replace(EDITED_MARKER_RE, "")
        .replace(Regex("[ \t]{2,}"), " ")
        .trim()

/** The `#tags` in [text] (WITHOUT the `#` prefix, the TagIndex storage form). */
fun extractTags(text: String): List<String> =
    TAG_TOKEN_RE.findAll(text).map { it.groupValues[2].removePrefix("#") }.distinct().toList()

/**
 * The click-away / back rule: an EMPTY draft is discarded silently (the sheet
 * calls `onCancel`); a non-empty draft is kept, so the sheet must NOT dismiss
 * (the user closes it explicitly with Save/Cancel).
 */
fun shouldDiscardOnDismiss(text: String): Boolean = text.isBlank()

private const val TAG_SUGGESTION_LIMIT = 10