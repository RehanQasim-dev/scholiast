package com.scholiast.android.ui.notes.editor

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.outlined.Keyboard
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import com.scholiast.android.data.db.AppDatabase
import com.scholiast.android.data.notes.RoomTagIndex
import com.scholiast.android.ui.notes.EditorDraft
import com.scholiast.android.ui.notes.TimestampChip
import com.scholiast.android.ui.theme.AccentPurple
import com.scholiast.android.ui.theme.Hairline
import com.scholiast.android.ui.theme.OnAccent
import com.scholiast.android.ui.theme.TextDisabled
import kotlinx.coroutines.launch
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/**
 * The bottom-sheet comment editor (plan §5.4, task 07): the draft field with
 * its formatting toolbar, the `#tag` autocomplete, the timestamp chip (tap to
 * seek), and the **mic + keyboard icon pair** — the keyboard is strictly opt-in
 * and only opens via the keyboard icon, never on focus (§2 / §6.4).
 *
 * Consumed by Task 06's `NotesTab` (new note + reply) and Tasks 13/14 (transcript
 * / frame comments). The signature is the agreed contract:
 *
 * ```
 * CommentEditorSheet(draft: EditorDraft, timestampSeconds: Double,
 *                    onSave: (String) -> Unit, onCancel: () -> Unit,
 *                    seekListener: (Double) -> Unit)
 * ```
 *
 * [draft] is Task 06's [EditorDraft] (null `itemId` = new note at `videoTime`);
 * [timestampSeconds] is the seekable chip value; [onSave] receives the stored
 * comment-markdown text (the consumer stamps its own `<!--timestamp:N-->`).
 *
 * **Click-away / back rule:** an EMPTY draft is discarded silently (`onCancel`);
 * a non-empty draft is KEPT — the sheet does not dismiss, so nothing the user
 * typed is ever lost to an accidental outside tap. Save/Cancel are the only
 * exits for a non-empty draft (Save is disabled while the draft is empty).
 *
 * **Voice slot ([voice]):** Task 09's recorder lives in the hosting screen's
 * `VoiceRecorderViewModel` (so it survives rotation); the sheet only renders
 * Task 09's [MicButton] from the injected [EditorVoiceSlot] state and forwards
 * its gestures. When null, a disabled mic glyph holds the layout position.
 * Task 10's transcriber inserts transcribed text through the same [EditorViewModel]
 * the sheet drives (a `onFieldChanged(TextFieldValue)` call) — no sheet edit
 * needed.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun CommentEditorSheet(
    draft: EditorDraft,
    timestampSeconds: Double,
    onSave: (String) -> Unit,
    onCancel: () -> Unit,
    seekListener: (Double) -> Unit,
    modifier: Modifier = Modifier,
    voice: EditorVoiceSlot? = null,
    title: String? = null,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val tagIndex = remember(context) {
        RoomTagIndex(AppDatabase.getInstance(context.applicationContext).syncMetaDao())
    }
    // Fresh instance per sheet opening: `remember { }` (no key) — a data-class
    // EditorDraft would be `equals` across identical drafts and wrongly reuse
    // a keyed VM with stale text.
    val viewModel = remember { EditorViewModel(tagIndex, initialText = draft.text) }
    val state by viewModel.state.collectAsStateWithLifecycle()

    val focusRequester = remember { FocusRequester() }
    val keyboardController = LocalSoftwareKeyboardController.current
    var keyboardAllowed by remember { mutableStateOf(false) }
    val imeVisible = WindowInsets.isImeVisible
    // Reset the opt-in flag the moment the IME actually closes (covers the
    // system-back-closes-IME case, where the field keeps focus).
    LaunchedEffect(imeVisible) { if (!imeVisible) keyboardAllowed = false }
    // Position the caret without ever opening the IME (keyboard-less first).
    LaunchedEffect(Unit) { focusRequester.requestFocus() }

    var linkDialogOpen by remember { mutableStateOf(false) }
    var linkUrl by remember { mutableStateOf("") }

    ModalBottomSheet(
        onDismissRequest = {
            // Click-away discards only empty drafts; a non-empty draft keeps the
            // sheet open so the user's words are never lost to an outside tap.
            if (shouldDiscardOnDismiss(state.text)) onCancel()
        },
        containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = modifier,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 20.dp),
        ) {
            // Header: title + seekable timestamp chip.
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = title ?: if (draft.itemId == null) "New note" else "Reply",
                    style = MaterialTheme.typography.titleMedium,
                )
                Spacer(Modifier.weight(1f))
                TimestampChip(
                    seconds = timestampSeconds,
                    onClick = { seekListener(timestampSeconds) },
                )
            }

            Spacer(Modifier.height(12.dp))

            // Draft area with the #tag autocomplete above the field.
            Column {
                if (state.showTagSuggestions) {
                    TagSuggestions(
                        suggestions = state.tagSuggestions,
                        onPick = { viewModel.insertTag(it) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(bottom = 4.dp),
                    )
                }
                EditorField(
                    value = state.field,
                    onValueChange = { value -> scope.launch { viewModel.onFieldChanged(value) } },
                    focusRequester = focusRequester,
                    keyboardAllowed = keyboardAllowed,
                    modifier = Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = 96.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(MaterialTheme.colorScheme.surfaceContainerHighest)
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                )
            }

            Spacer(Modifier.height(8.dp))

            // Bottom row: formatting buttons left; mic + small keyboard icon right.
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                EditorFormatBar(
                    onCommand = { viewModel.applyCommand(it) },
                    onInsertLink = { linkDialogOpen = true },
                )
                Spacer(Modifier.weight(1f))
                MicSlot(voice = voice)
                Spacer(Modifier.width(8.dp))
                KeyboardIconButton(
                    onClick = {
                        keyboardAllowed = true
                        focusRequester.requestFocus()
                        keyboardController?.show()
                    },
                )
            }

            Spacer(Modifier.height(16.dp))

            // Save / Cancel (≥48dp; Save purple-accented, disabled while empty).
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(
                    onClick = onCancel,
                    modifier = Modifier.height(48.dp).defaultMinSize(minWidth = 72.dp),
                ) { Text("Cancel") }
                Spacer(Modifier.width(8.dp))
                Button(
                    onClick = {
                        scope.launch {
                            viewModel.feedTags()
                            onSave(viewModel.serialize())
                        }
                    },
                    enabled = !state.isEmpty,
                    modifier = Modifier.height(48.dp).defaultMinSize(minWidth = 96.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = AccentPurple,
                        contentColor = OnAccent,
                    ),
                ) { Text("Save") }
            }
        }
    }

    if (linkDialogOpen) {
        val confirmed = {
            val url = linkUrl.trim()
            if (url.isNotEmpty()) viewModel.applyLink(url)
            linkDialogOpen = false
            linkUrl = ""
        }
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
                )
            },
            confirmButton = {
                TextButton(onClick = confirmed, enabled = linkUrl.isNotBlank()) {
                    Text("Insert")
                }
            },
            dismissButton = {
                TextButton(onClick = { linkDialogOpen = false }) { Text("Cancel") }
            },
        )
    }
}

/**
 * The voice-recorder wiring slot (Task 09/10 contract, logged in LOG.md).
 * The hosting screen owns the `VoiceRecorderViewModel` and passes its
 * [RecorderState] plus gesture callbacks; null renders a disabled glyph.
 */
data class EditorVoiceSlot(
    val state: com.scholiast.android.ui.voice.RecorderState,
    val onToggle: () -> Unit,
    val onCancel: () -> Unit = {},
    val onOpenSettings: () -> Unit = {},
)

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
        // Disabled placeholder mirrors the mic button's circular look so the
        // layout holds while no recorder is wired.
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

/** The small keyboard icon that opens the OS keyboard (plan §6.2 `KeyboardButton`). */
@Composable
private fun KeyboardIconButton(onClick: () -> Unit) {
    IconButton(
        onClick = onClick,
        modifier = Modifier.size(48.dp),
    ) {
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

@Composable
private fun TagSuggestions(
    suggestions: List<String>,
    onPick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHighest,
        border = BorderStroke(1.dp, Hairline),
    ) {
        Column(Modifier.padding(vertical = 4.dp)) {
            suggestions.forEach { tag ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onPick(tag) }
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "#$tag",
                        style = MaterialTheme.typography.bodyMedium,
                        color = AccentPurple,
                    )
                }
            }
        }
    }
}