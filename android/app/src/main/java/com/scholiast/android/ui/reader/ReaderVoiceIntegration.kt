package com.scholiast.android.ui.reader

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.view.HapticFeedbackConstants
import android.view.View
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.scholiast.android.data.notes.PageHighlightRepository
import com.scholiast.android.domain.transcribe.AudioSource
import com.scholiast.android.domain.transcribe.SpeechDependencies
import com.scholiast.android.domain.transcribe.TranscriberSource
import com.scholiast.android.domain.transcribe.TranscriptionResult
import com.scholiast.android.domain.transcribe.notConfigured
import com.scholiast.android.ui.notes.EditorDraft
import com.scholiast.android.ui.notes.editor.CommentEditorSheet
import com.scholiast.android.ui.notes.editor.EditorVoiceSlot
import com.scholiast.android.ui.voice.AndroidVoiceRecorder
import com.scholiast.android.ui.voice.RecorderState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * The wiring between the Reader's events, [VoiceNoteController] and persistence
 * (Task 30 / plan §5.6). The controller owns phases and session drafts; this
 * class owns everything Android/persistence-shaped around it:
 *
 * - pill mic pressed → restore a kept draft ([VoiceNoteController.reopenDraft])
 *   or start a fresh recording;
 * - DraftReady handled by the overlay → [CommentEditorSheet] opens PRE-FILLED;
 * - Save → `PageHighlightRepository.upsert` with note `"text<!--timestamp:N-->"`;
 * - Dismiss → the draft simply stays in the controller's session map;
 * - save success → "Note attached" toast + haptic in the same frame.
 */
class ReaderVoiceIntegration(
    /** The NORMALIZED page url — the repository/sync key. */
    val pageUrl: String,
    private val store: PageHighlightRepository,
    val controller: VoiceNoteController,
    private val clock: () -> Long = System::currentTimeMillis,
) {

    /** Handed back by the comment sheet; transcripts insert through it. */
    var editorViewModel: com.scholiast.android.ui.notes.editor.EditorViewModel? = null

    /** Permission-aware mic entry, installed by [ReaderVoiceOverlay]. */
    internal var micHandler: ((HighlightDraftTarget) -> Unit)? = null

    /** Installs the ViewModel hooks. Idempotent; call once on mount. */
    fun attach(viewModel: ReaderViewModel) {
        viewModel.onMicPressed = { target -> micHandler?.invoke(target) }
        viewModel.voiceDraftLookup = { id -> controller.drafts.value[id] }
    }

    /**
     * Pill mic pressed: a kept session draft wins (reopening restores the text
     * into the editor box), otherwise a new recording starts over it.
     */
    fun onMicPressed(target: HighlightDraftTarget) {
        if (!controller.reopenDraft(target)) controller.start(target)
    }

    /**
     * Persist the confirmed transcript onto [target]'s highlight: notes[] gets
     * `"text<!--timestamp:N-->"` appended and `updatedAt` is stamped (sync).
     * False when the highlight vanished meanwhile or the text is blank —
     * nothing is saved silently, the caller keeps the draft.
     */
    suspend fun save(target: HighlightDraftTarget, text: String): Boolean {
        val hl = store.highlights(pageUrl).firstOrNull { it.id == target.highlightId }
            ?: return false
        val updated = appendVoiceNote(hl, text, clock()) ?: return false
        store.upsert(pageUrl, updated)
        controller.clearDraft(target.highlightId)
        return true
    }
}

/**
 * Production transcriber seam: the SAME chain the player's comment flow uses —
 * `SpeechDependencies.registry(...).forAddComment()` (settings preference →
 * Gemini-prompt → Groq → local FUTO; cloud-offline/unconfigured falls through
 * to the local engine automatically), fed the recorder's raw float samples.
 */
internal fun readerTranscriber(appContext: Context): suspend (FloatArray) -> TranscriptionResult {
    return { samples ->
        val transcriber = SpeechDependencies.registry(appContext).forAddComment()
        if (transcriber == null) {
            notConfigured(
                TranscriberSource.LOCAL,
                "Set up speech in Settings to use voice notes.",
            )
        } else {
            val language = SpeechDependencies.settings(appContext).speechLanguage()
            transcriber.transcribe(AudioSource.FloatSamples(samples), language)
        }
    }
}

/**
 * Creates the reader's voice integration: one recorder + controller per Reader
 * destination, torn down (mic released, jobs cancelled) when composition leaves.
 * A rotation mid-recording therefore stops the take — acceptable v1 posture,
 * noted in the task LOG.
 */
@Composable
fun rememberReaderVoiceIntegration(viewModel: ReaderViewModel): ReaderVoiceIntegration {
    val context = LocalContext.current
    val appContext = context.applicationContext

    val recorder = remember { AndroidVoiceRecorder(appContext) }
    val scope = remember { CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate) }
    val controller = remember(recorder) {
        VoiceNoteController(scope, recorder, readerTranscriber(appContext))
    }
    val integration = remember(viewModel, controller) {
        ReaderVoiceIntegration(
            pageUrl = viewModel.url,
            store = viewModel.highlightStore,
            controller = controller,
        )
    }

    LaunchedEffect(integration) { integration.attach(viewModel) }
    DisposableEffect(controller, scope) {
        onDispose {
            controller.shutdown()
            recorder.release()
            scope.cancel()
        }
    }
    return integration
}

/**
 * The whole reader voice flow as ONE mountable overlay — drop this at
 * ReaderScreen's SHEET-SLOT (Task 32):
 *
 * ```
 * ReaderVoiceOverlay(viewModel, anchorRect = trackedPillRect)
 * ```
 *
 * Renders [VoiceBubble] while Recording/Transcribing/Error, opens the existing
 * [CommentEditorSheet] pre-filled when transcription lands (or a kept draft is
 * restored), routes Save/Dismiss, and fires the "Note attached" toast + haptic.
 * Handles the RECORD_AUDIO permission dance for both mic entry points.
 */
@Composable
fun ReaderVoiceOverlay(
    viewModel: ReaderViewModel,
    modifier: Modifier = Modifier,
    anchorRect: Rect? = null,
    integration: ReaderVoiceIntegration = rememberReaderVoiceIntegration(viewModel),
) {
    val context = LocalContext.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()

    val phase by integration.controller.phase.collectAsStateWithLifecycle()
    val recorderState by integration.controller.recorderState.collectAsStateWithLifecycle()

    // Open-sheet state: target non-null ⇒ sheet visible with [sheetText].
    var sheetTarget by remember { mutableStateOf<HighlightDraftTarget?>(null) }
    var sheetText by remember { mutableStateOf("") }

    var pendingPermissionTarget by remember { mutableStateOf<HighlightDraftTarget?>(null) }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        val pending = pendingPermissionTarget
        pendingPermissionTarget = null
        when {
            granted && pending != null -> integration.onMicPressed(pending)
            !granted -> Toast.makeText(context, "Microphone permission was denied.", Toast.LENGTH_SHORT).show()
        }
    }

    fun micPress(target: HighlightDraftTarget) {
        val granted = ContextCompat.checkSelfPermission(
            context, Manifest.permission.RECORD_AUDIO,
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) integration.onMicPressed(target) else {
            pendingPermissionTarget = target
            permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }
    integration.micHandler = ::micPress

    // DraftReady → open the sheet pre-filled; if it's already open (mic inside
    // the editor) insert the text at the caret instead — same frame either way.
    LaunchedEffect(phase) {
        val p = phase
        if (p is VoicePhase.DraftReady) {
            val openEditor = integration.editorViewModel
            if (sheetTarget != null && openEditor != null) {
                openEditor.insertText(p.text)
            } else {
                sheetText = p.text
                sheetTarget = p.target
            }
            integration.controller.consumeDraft()
        }
    }

    fun closeSheet() {
        sheetTarget = null
        sheetText = ""
        integration.editorViewModel = null
    }

    VoiceBubble(
        visible = sheetTarget == null &&
            (phase is VoicePhase.Recording || phase is VoicePhase.Transcribing || phase is VoicePhase.Error),
        anchorRect = anchorRect,
        phase = phase,
        onStop = integration.controller::stop,
        onRetry = integration.controller::retry,
        onDiscard = integration.controller::discard,
        modifier = modifier,
    )

    sheetTarget?.let { target ->
        CommentEditorSheet(
            draft = EditorDraft(itemId = null, videoTime = 0.0, text = sheetText),
            timestampSeconds = 0.0,
            seekListener = { /* no video timeline in the reader */ },
            title = "Voice note",
            onSave = { text ->
                scope.launch {
                    val saved = integration.save(target, text)
                    if (saved) {
                        // Same frame: persist → toast → haptic, nothing between.
                        Toast.makeText(context, "Note attached", Toast.LENGTH_SHORT).show()
                        view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
                    }
                    closeSheet()
                }
            },
            onCancel = {
                // Dismiss keeps the draft (plan §5.6); only close.
                closeSheet()
            },
            voice = editorVoiceSlot(recorderState) { micPress(target) },
            onEditorViewModel = { integration.editorViewModel = it },
        )
    }
}

/** The sheet's own mic slot: records into the open editor (player parity). */
@Composable
private fun editorVoiceSlot(
    state: RecorderState,
    onMicToggle: () -> Unit,
): EditorVoiceSlot = EditorVoiceSlot(
    state = state,
    onToggle = onMicToggle,
    onCancel = {},
)
