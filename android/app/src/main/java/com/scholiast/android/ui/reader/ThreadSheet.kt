package com.scholiast.android.ui.reader

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.outlined.Keyboard
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.scholiast.android.data.notes.parseVideoNote
import com.scholiast.android.ui.notes.editor.EditorCommand
import com.scholiast.android.ui.notes.editor.EditorField
import com.scholiast.android.ui.notes.editor.EditorFormatBar
import com.scholiast.android.ui.notes.editor.EditorVoiceSlot
import com.scholiast.android.ui.notes.editor.applyLineCommand
import com.scholiast.android.ui.notes.editor.toggleSurround
import com.scholiast.android.ui.notes.render.CommentBody
import com.scholiast.android.ui.theme.Hairline
import com.scholiast.android.ui.theme.SurfaceElevated
import com.scholiast.android.ui.theme.TextDisabled
import com.scholiast.android.ui.theme.TextSecondary

/**
 * Plan §6.5 ThreadSheet spring: dampingRatio 0.8, response ~0.3s.
 * `response ≈ 2π/√stiffness` → stiffness 400 ≈ 0.31s (compose's own
 * StiffnessMediumLow), so the constant is written literally.
 */
private const val SHEET_STIFFNESS = 400f
private val SHEET_SPRING_FADE = spring<Float>(dampingRatio = 0.8f, stiffness = SHEET_STIFFNESS)
private val SHEET_SPRING_SLIDE = spring<IntOffset>(dampingRatio = 0.8f, stiffness = SHEET_STIFFNESS)

/** Width at/below which the thread uses a modal bottom sheet instead of the docked panel. */
val THREAD_SHEET_SIDE_PANEL_MIN_WIDTH = 600.dp

/**
 * The comment-thread surface for reader highlights (Task 31, plan §5.5) —
 * adaptive and PURE (state in, callbacks out; Task 32 wires persistence):
 *
 * - **< [THREAD_SHEET_SIDE_PANEL_MIN_WIDTH]** width → Material3
 *   [ModalBottomSheet]: slide-up + scrim, exit reverses the same path,
 *   platform drag-dismiss (documented deviation — see LOG.md).
 * - **≥ [THREAD_SHEET_SIDE_PANEL_MIN_WIDTH]** → docked right panel, NO scrim
 *   (parallel surface): slides in from / exits to the right on [SHEET_SPRING].
 *
 * Content top-to-bottom: pinned quote block (color rail in the highlight hue,
 * serif quote text, TalkBack announce "yellow highlight, N comments"), the
 * reply thread rendered through the shared comment renderer, then the reply
 * box — the existing editor field (mic + opt-in keyboard icons, formatting
 * bar; diagram/image buttons don't exist here by design). Per-reply delete is
 * an always-visible trailing control; long-press opens the INLINE EDITOR for
 * that reply (plan §5.5 "edit existing comment: inline in sheet"). The
 * whole-thread delete button appears ONLY at ≥2 replies (desktop parity).
 *
 * Back-gesture unwind contract (plan §6.4): the sheet closes FIRST — the
 * docked panel registers a [BackHandler] while visible; the phone sheet's
 * back handling is ModalBottomSheet's own (both funnel into [onDismiss]).
 *
 * @param replies raw stored note strings (`text<!--timestamp:N-->…`); markers
 *   are never rendered.
 * @param draft host-owned new-reply draft (so Task 30's voice pipeline can
 *   fill it); formatting commands are applied through the editor's pure
 *   transforms and reported via [onDraftChange].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ThreadSheet(
    visible: Boolean,
    quote: String?,
    color: String?,
    replies: List<String>,
    draft: TextFieldValue,
    voice: EditorVoiceSlot?,
    onDraftChange: (TextFieldValue) -> Unit,
    onSendReply: () -> Unit,
    onEditReply: (index: Int, newText: String) -> Unit,
    onDeleteReply: (index: Int) -> Unit,
    onDeleteThread: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val screenWidth = LocalConfiguration.current.screenWidthDp.dp
    val docked = screenWidth >= THREAD_SHEET_SIDE_PANEL_MIN_WIDTH

    if (docked) {
        // Back-gesture unwind: sheet closes first (plan §6.4).
        BackHandler(enabled = visible) { onDismiss() }
        Box(modifier.fillMaxSize()) {
            AnimatedVisibility(
                visible = visible,
                enter = slideInHorizontally(SHEET_SPRING_SLIDE) { it } + fadeIn(SHEET_SPRING_FADE),
                exit = slideOutHorizontally(SHEET_SPRING_SLIDE) { it } + fadeOut(SHEET_SPRING_FADE),
                modifier = Modifier.align(Alignment.CenterEnd),
            ) {
                Surface(
                    shape = RoundedCornerShape(topStart = 16.dp, bottomStart = 16.dp),
                    color = MaterialTheme.colorScheme.surfaceContainerHigh,
                    border = BorderStroke(1.dp, Hairline),
                    modifier = Modifier
                        .fillMaxHeight()
                        .width(360.dp),
                ) {
                    ThreadPanel(
                        quote = quote,
                        color = color,
                        replies = replies,
                        draft = draft,
                        voice = voice,
                        onDraftChange = onDraftChange,
                        onSendReply = onSendReply,
                        onEditReply = onEditReply,
                        onDeleteReply = onDeleteReply,
                        onDeleteThread = onDeleteThread,
                        onDismiss = onDismiss,
                    )
                }
            }
        }
    } else {
        if (visible) {
            ModalBottomSheet(
                onDismissRequest = onDismiss,
                sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
                containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
            ) {
                ThreadPanel(
                    quote = quote,
                    color = color,
                    replies = replies,
                    draft = draft,
                    voice = voice,
                    onDraftChange = onDraftChange,
                    onSendReply = onSendReply,
                    onEditReply = onEditReply,
                    onDeleteReply = onDeleteReply,
                    onDeleteThread = onDeleteThread,
                    onDismiss = onDismiss,
                    modifier = Modifier.padding(bottom = 24.dp),
                )
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Shared panel content (both hosts render exactly this)
// ---------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ThreadPanel(
    quote: String?,
    color: String?,
    replies: List<String>,
    draft: TextFieldValue,
    voice: EditorVoiceSlot?,
    onDraftChange: (TextFieldValue) -> Unit,
    onSendReply: () -> Unit,
    onEditReply: (Int, String) -> Unit,
    onDeleteReply: (Int) -> Unit,
    onDeleteThread: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var editingIndex by remember { mutableStateOf<Int?>(null) }
    var keyboardAllowed by remember { mutableStateOf(false) }
    var linkDialogOpen by remember { mutableStateOf(false) }
    var linkUrl by remember { mutableStateOf("") }
    val keyboardController = LocalSoftwareKeyboardController.current
    val imeVisible = WindowInsets.isImeVisible
    // Reset the keyboard opt-in the moment the IME actually closes (covers
    // system-back-closes-IME while the field keeps focus).
    LaunchedEffect(imeVisible) { if (!imeVisible) keyboardAllowed = false }

    Column(modifier.fillMaxWidth()) {
        // Header: title · whole-thread delete (ONLY ≥2 replies) · close.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, end = 8.dp, top = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "Comments",
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.weight(1f),
            )
            if (replies.size >= 2) {
                IconButton(onClick = onDeleteThread, modifier = Modifier.size(44.dp)) {
                    Icon(
                        imageVector = Icons.Filled.Delete,
                        contentDescription = "Delete thread and all ${replies.size} comments",
                        tint = TextSecondary,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
            IconButton(onClick = onDismiss, modifier = Modifier.size(44.dp)) {
                Icon(
                    imageVector = Icons.Filled.Close,
                    contentDescription = "Close comments",
                    tint = TextSecondary,
                    modifier = Modifier.size(20.dp),
                )
            }
        }

        // Pinned quote block: color rail in the highlight hue + serif quote.
        QuoteBlock(quote = quote, color = color, replyCount = replies.size)

        // Thread of replies (scrollable), rendered by the shared renderer.
        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
        ) {
            if (replies.isEmpty()) {
                Text(
                    text = "No comments yet",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextDisabled,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 24.dp),
                )
            }
            replies.forEachIndexed { index, note ->
                val i = index
                if (editingIndex == i) {
                    InlineReplyEditor(
                        initialText = parseVideoNote(note).text,
                        onSave = { newText ->
                            editingIndex = null
                            onEditReply(i, newText)
                        },
                        onCancel = { editingIndex = null },
                        onDelete = {
                            editingIndex = null
                            onDeleteReply(i)
                        },
                    )
                } else {
                    ReplyRow(
                        note = note,
                        index = i,
                        onLongPress = { editingIndex = i },
                        onDelete = { onDeleteReply(i) },
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
        }

        // Reply box: formatting bar left · mic · keyboard · send right.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 8.dp, end = 8.dp, bottom = 8.dp)
                .padding(bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            EditorFormatBar(
                onCommand = { command -> applyFormat(command, draft, onDraftChange) },
                onInsertLink = { linkDialogOpen = true },
            )
            Spacer(Modifier.weight(1f))
            MicSlot(voice = voice)
            KeyboardIconButton(
                onClick = {
                    keyboardAllowed = true
                    keyboardController?.show()
                },
            )
            IconButton(
                onClick = onSendReply,
                enabled = draft.text.isNotBlank(),
                modifier = Modifier.size(48.dp),
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.Send,
                    contentDescription = "Add comment",
                    tint = if (draft.text.isNotBlank()) MaterialTheme.colorScheme.primary else TextDisabled,
                    modifier = Modifier.size(22.dp),
                )
            }
        }
        EditorField(
            value = draft,
            onValueChange = onDraftChange,
            keyboardAllowed = keyboardAllowed,
            placeholder = "Write a reply…",
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp)
                .padding(bottom = 12.dp)
                .defaultMinSize(minHeight = 56.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(MaterialTheme.colorScheme.surfaceContainerHighest)
                .padding(horizontal = 12.dp, vertical = 8.dp),
        )
    }

    if (linkDialogOpen) {
        AlertDialog(
            onDismissRequest = { linkDialogOpen = false },
            title = { Text("Insert link") },
            text = {
                OutlinedTextField(
                    value = linkUrl,
                    onValueChange = { linkUrl = it },
                    placeholder = { Text("https://…") },
                    label = { Text("URL") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val url = linkUrl.trim()
                        if (url.isNotEmpty()) {
                            applyLink(url, draft, onDraftChange)
                        }
                        linkDialogOpen = false
                        linkUrl = ""
                    },
                    enabled = linkUrl.isNotBlank(),
                ) { Text("Insert") }
            },
            dismissButton = {
                TextButton(onClick = { linkDialogOpen = false }) { Text("Cancel") }
            },
        )
    }
}

/** Toolbar command around the current selection, via the editor's pure transforms. */
private fun applyFormat(command: EditorCommand, draft: TextFieldValue, onChange: (TextFieldValue) -> Unit) {
    val edit = when (command) {
        EditorCommand.BOLD -> toggleSurround(draft.text, draft.selection.start, draft.selection.end, "**")
        EditorCommand.ITALIC -> toggleSurround(draft.text, draft.selection.start, draft.selection.end, "*")
        EditorCommand.CODE -> toggleSurround(draft.text, draft.selection.start, draft.selection.end, "`")
        EditorCommand.BULLET -> applyLineCommand(draft.text, draft.selection.start, draft.selection.end, wantTask = false)
        EditorCommand.CHECKLIST -> applyLineCommand(draft.text, draft.selection.start, draft.selection.end, wantTask = true)
    }
    onChange(draft.copy(text = edit.text, selection = TextRange(edit.caret)))
}

/** Wrap the selection as `[text](url)` (empty selection → caret inside `[](...)`). */
private fun applyLink(url: String, draft: TextFieldValue, onChange: (TextFieldValue) -> Unit) {
    val target = if (url.startsWith("http://") || url.startsWith("https://")) url else "https://$url"
    val sel = draft.selection
    val selected = draft.text.substring(sel.start, sel.end)
    val wrapped = if (selected.isEmpty()) "[]($target)" else "[$selected]($target)"
    val caret = if (selected.isEmpty()) sel.start + "[](".length else sel.start + wrapped.length
    onChange(draft.copy(text = draft.text.replaceRange(sel.start, sel.end, wrapped), selection = TextRange(caret)))
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** Pinned quote: hue rail + serif text + TalkBack announce (plan §6.4). */
@Composable
private fun QuoteBlock(quote: String?, color: String?, replyCount: Int) {
    if (quote.isNullOrEmpty()) return
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 4.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerHighest)
            .height(IntrinsicSize.Min)
            .semantics {
                contentDescription = HighlightActionsController.announceLabel(color, replyCount)
            },
    ) {
        Box(
            Modifier
                .width(4.dp)
                .fillMaxHeight()
                .background(highlightColor(color ?: "yellow")),
        )
        Text(
            text = quote,
            style = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Serif),
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier
                .padding(horizontal = 12.dp, vertical = 10.dp)
                .weight(1f),
        )
    }
}

/**
 * One reply: rendered markdown (markers stripped by the renderer) + per-reply
 * delete; long-press opens the inline editor.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ReplyRow(
    note: String,
    index: Int,
    onLongPress: () -> Unit,
    onDelete: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 8.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(SurfaceElevated)
            .combinedClickable(onClick = {}, onLongClick = onLongPress)
            .padding(start = 12.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.Top,
    ) {
        CommentBody(
            markdown = note,
            modifier = Modifier.weight(1f),
        )
        IconButton(onClick = onDelete, modifier = Modifier.size(40.dp)) {
            Icon(
                imageVector = Icons.Filled.Close,
                contentDescription = "Delete comment ${index + 1}",
                tint = TextDisabled,
                modifier = Modifier.size(16.dp),
            )
        }
    }
}

/** Inline editor for one reply (long-press): Save re-stamps `<!--edited:M-->` upstream. */
@Composable
private fun InlineReplyEditor(
    initialText: String,
    onSave: (String) -> Unit,
    onCancel: () -> Unit,
    onDelete: () -> Unit,
) {
    var text by remember { mutableStateOf(TextFieldValue(initialText)) }
    Column(
        Modifier
            .fillMaxWidth()
            .padding(top = 8.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerHighest)
            .padding(8.dp),
    ) {
        EditorField(
            value = text,
            onValueChange = { text = it },
            keyboardAllowed = true,
            placeholder = "Edit comment…",
            modifier = Modifier.fillMaxWidth(),
        )
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onDelete, modifier = Modifier.size(40.dp)) {
                Icon(Icons.Filled.Delete, contentDescription = "Delete this comment", tint = TextSecondary, modifier = Modifier.size(18.dp))
            }
            TextButton(onClick = onCancel) { Text("Cancel") }
            TextButton(onClick = { onSave(text.text) }, enabled = text.text.isNotBlank()) { Text("Save") }
        }
    }
}

// --- Copied from ui/notes/editor/CommentEditorSheet.kt (private there; read-only
// consumption was impossible for these two small pieces — noted in LOG.md). ----

/** Voice slot: Task 09's MicButton when wired; disabled glyph holds the layout otherwise. */
@Composable
private fun MicSlot(voice: EditorVoiceSlot?) {
    if (voice != null) {
        com.scholiast.android.ui.voice.MicButton(
            state = voice.state,
            onToggle = voice.onToggle,
            onCancel = voice.onCancel,
            onOpenSettings = voice.onOpenSettings,
        )
    } else {
        Box(
            modifier = Modifier
                .size(48.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surfaceContainerHighest),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Filled.Mic,
                contentDescription = "Voice input not wired",
                tint = TextDisabled,
                modifier = Modifier.size(22.dp),
            )
        }
    }
}

/** The keyboard icon that opts in to the OS keyboard (focus alone never opens it). */
@Composable
private fun KeyboardIconButton(onClick: () -> Unit) {
    IconButton(onClick = onClick, modifier = Modifier.size(48.dp)) {
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surfaceContainerHighest),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Outlined.Keyboard,
                contentDescription = "Show keyboard",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(22.dp),
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Previews (phone sheet + tablet side panel)
// ---------------------------------------------------------------------------

private const val PREVIEW_T = 1_787_346_000_000L

private val previewReplies = listOf(
    "Key claim — connects back to chapter 2<!--timestamp:$PREVIEW_T-->",
    "Disagree: the sample is tiny **and** biased #methods<!--timestamp:${PREVIEW_T + 1}--><!--edited:${PREVIEW_T + 9}-->",
)

@Preview(name = "Phone sheet", showBackground = true, backgroundColor = 0xFF000000, widthDp = 400, heightDp = 720)
@Composable
private fun PhoneThreadSheetPreview() {
    MaterialTheme(colorScheme = darkColorScheme()) {
        var draft by remember { mutableStateOf(TextFieldValue("")) }
        Box(Modifier.fillMaxSize()) {
            ThreadSheet(
                visible = true,
                quote = "The quick brown fox jumps over the lazy dog while readers skim.",
                color = "yellow",
                replies = previewReplies,
                draft = draft,
                voice = null,
                onDraftChange = { draft = it },
                onSendReply = {},
                onEditReply = { _, _ -> },
                onDeleteReply = {},
                onDeleteThread = {},
                onDismiss = {},
            )
        }
    }
}

@Preview(name = "Tablet side panel", showBackground = true, backgroundColor = 0xFF000000, widthDp = 840, heightDp = 600)
@Composable
private fun TabletSidePanelPreview() {
    MaterialTheme(colorScheme = darkColorScheme()) {
        var draft by remember { mutableStateOf(TextFieldValue("")) }
        ThreadSheet(
            visible = true,
            quote = "A grouped selection's quoted text stays pinned at the top of the panel.",
            color = "green",
            replies = previewReplies,
            draft = draft,
            voice = null,
            onDraftChange = { draft = it },
            onSendReply = {},
            onEditReply = { _, _ -> },
            onDeleteReply = {},
            onDeleteThread = {},
            onDismiss = {},
        )
    }
}
