# LOG — task-31-thread-sheet-actions

## [2026-08-21 23:40] ox-alpha (Task 31 agent) — final

- **What I learned:**
  - M3's non-clickable `Surface` overload has NO `interactionSource` parameter (checked the
    material3 1.3 classes.jar byte-for-byte via javap) — to drive `collectIsPressedAsState`
    on a toast you must use the **clickable** Surface overload (`onClick = {}` no-op), which
    also usefully swallows taps that would otherwise fall through.
  - `slideInHorizontally`/`slideOutHorizontally` take `FiniteAnimationSpec<IntOffset>`, not
    `SpringSpec<Float>` — one spring per type is needed (fade=Float, slide=IntOffset).
  - Plan §6.5's "response ~0.3s" maps to stiffness ≈ 400 (`response ≈ 2π/√k`) — compose's own
    `StiffnessMediumLow`; written as a literal constant so the intent stays visible.
  - `EditorField` + `EditorFormatBar` are pure composables and consumed read-only; but their
    state holder `EditorViewModel` needs a Room-backed `TagIndex`, so ThreadSheet does NOT use
    it — formatting commands run through the editor module's pure top-level transforms
    (`toggleSurround`, `applyLineCommand`) directly on the host-owned draft.
- **Decisions made:**
  - **Copied small pieces from `CommentEditorSheet.kt`** (private there, shared file untouched):
    `MicSlot` (disabled-glyph placeholder) and `KeyboardIconButton`, plus the link-insert
    AlertDialog pattern. All copies live at the bottom of `ThreadSheet.kt`.
  - **Phone sheet motion deviation (allowed by task.md):** platform `ModalBottomSheet`
    (skipPartiallyExpanded) with its built-in drag-dismiss instead of a custom wrapper with
    1:1 drag / velocity-handoff / rubber-band / flick-dismiss. Exit reverses the same path;
    the docked panel uses the exact §6.5 spring (dampingRatio 0.8 / stiffness 400).
  - Adaptive breakpoint is purely width-based: `<600dp` → bottom sheet, `≥600dp` → docked
    right panel (360dp wide, no scrim). Landscape phones/tablets get the panel; portrait
    phones get the sheet — matches task.md's "≥600dp landscape" reading.
  - Per-reply delete is an always-visible trailing × (≥40dp target, TalkBack-labeled);
    long-press opens the INLINE editor for that reply (Save → `onEditReply(index, newText)`),
    covering plan §5.5 "edit existing comment: inline in sheet".
  - Recolor has NO UI in the sheet (task.md lists sheet content without it); the controller
    exposes `recolor()` for Task 32 to wire wherever (e.g. swatch pill on an existing
    highlight). Quote block carries the TalkBack announce string ("yellow highlight,
    N comments") via `HighlightActionsController.announceLabel`.
  - Undo snapshot = WHOLE pre-delete list (desktop dashboard parity: page record snapshotted
    before optimistic delete); `restore` rewinds exactly.
  - New-reply draft is HOST-owned state (`draft`/`onDraftChange`) so Task 30's voice pipeline
    can fill it; inline-edit text is internal ephemeral state.
- **Verification:** `./gradlew assembleDevDebug` BUILD SUCCESSFUL;
  `./gradlew testDevDebugUnitTest --tests "*HighlightActionsControllerTest*"` → **4 tests,
  0 failures, 0 errors, 0 skipped**. No Waydroid install per instructions.

### Exact public API as landed (for Task 32 mounting)

```kotlin
// ui/reader/HighlightActionsController.kt  (pure JVM over List<PageHighlight>)
object HighlightActionsController {
    enum class DeleteBlockReason { NOT_FOUND, TOO_FEW_REPLIES }
    sealed interface ThreadDeleteResult {
        data class Deleted(val highlights: List<PageHighlight>) : ThreadDeleteResult
        data class Blocked(val reason: DeleteBlockReason, val highlights: List<PageHighlight>) : ThreadDeleteResult
    }                                     // Blocked.highlights == input list UNCHANGED
    data class DeleteUndo(val highlightsBefore: List<PageHighlight>)

    fun piecesOf(highlights, key: String): List<PageHighlight>   // key = groupId OR highlight id
    fun ownerOf(highlights, key): PageHighlight?                 // representative holding notes[]
    fun replyCount(owner: PageHighlight?): Int
    fun canDeleteThread(highlights, key): Boolean                // notes.size >= 2
    fun announceLabel(color: String?, replyCount: Int): String   // "yellow highlight, N comments"

    fun addReply(highlights, key, text, now: () -> Long = System::currentTimeMillis): List<PageHighlight>
    //   appends "text<!--timestamp:N-->" to owner.notes[], stamps updatedAt; blank text = no-op
    fun editReply(highlights, key, index: Int, newText, now): List<PageHighlight>
    //   keeps original <!--timestamp:N--> id, stamps <!--edited:M-->; blank/bad index = no-op
    fun deleteReply(highlights, key, index: Int, now): List<PageHighlight>   // empty thread → notes=null

    fun deleteThread(highlights, key): ThreadDeleteResult        // gated ≥2 replies else Blocked
    fun snapshotForUndo(highlights, key): DeleteUndo?            // null when thread doesn't exist
    fun restore(undo: DeleteUndo): List<PageHighlight>           // exact rewind
    fun recolor(highlights, key, color, now): List<PageHighlight> // ALL groupId pieces, restamped
    fun noteStableId(note: String): String                        // re-export of noteId/noteVersion
    fun noteEditedVersion(note: String): Long
}

// ui/reader/ThreadSheet.kt  (pure composable; adaptive <600dp sheet / ≥600dp right panel)
val THREAD_SHEET_SIDE_PANEL_MIN_WIDTH = 600.dp
@Composable fun ThreadSheet(
    visible: Boolean,
    quote: String?,                              // HighlightController.contentOf(piece)
    color: String?,                              // "yellow" | "red" | "green"
    replies: List<String>,                       // raw stored notes (markers included)
    draft: TextFieldValue,                       // HOST-owned new-reply draft
    voice: EditorVoiceSlot?,                     // null → disabled mic glyph
    onDraftChange: (TextFieldValue) -> Unit,
    onSendReply: () -> Unit,                     // host calls controller.addReply
    onEditReply: (index: Int, newText: String) -> Unit,
    onDeleteReply: (index: Int) -> Unit,
    onDeleteThread: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,               // panel host: give height+placement (sheet ignores)
)
// Back-gesture unwind: docked panel registers BackHandler(visible)→onDismiss;
// phone sheet dismisses back via ModalBottomSheet's own handling (both → onDismiss).

// ui/reader/ReaderToast.kt
@Composable fun ReaderToast(
    message: String?,                            // null → hidden; new message restarts timer
    modifier: Modifier = Modifier,               // fillMaxWidth box, content bottom-center
    actionLabel: String? = null,                 // e.g. "Undo"
    onAction: (() -> Unit)? = null,
    durationMs: Long = 4000L,                    // pauses while touched
    onDismiss: () -> Unit = {},
)

// Suggested Task 32 wiring:
//   val key = hit.groupId ?: hit.highlightId
//   val owner = HighlightActionsController.ownerOf(highlights, key)
//   ThreadSheet(visible, quote = HighlightController.contentOf(owner), color = owner?.color,
//               replies = owner?.notes.orEmpty(), draft = draft, ...)
//   onSendReply = {
//       highlights = HighlightActionsController.addReply(highlights, key, draft.text)  // then persist
//   }
//   onDeleteThread = {
//       val undo = HighlightActionsController.snapshotForUndo(highlights, key)
//       when (val r = HighlightActionsController.deleteThread(highlights, key)) {
//           is HighlightActionsController.ThreadDeleteResult.Deleted -> {
//               highlights = r.highlights                                              // then persist
//               showReaderToast("Thread deleted", "Undo") { highlights = HighlightActionsController.restore(undo!!) }
//           }
//           is HighlightActionsController.ThreadDeleteResult.Blocked -> {}             // button hidden anyway
//       }
//   }
```
