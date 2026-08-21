# LOG — task-30-voice-comment-flow

## [2026-08-21 18:40] ox-alpha (Task 30 agent) — final
- **What I learned:**
  - The player's chain is `SpeechDependencies.registry(ctx).forAddComment()` → `transcriber.transcribe(AudioSource.FloatSamples(samples), SpeechDependencies.settings(ctx).speechLanguage())` (`ui/voice/VoiceEditorSlot.kt:78-101`). Reused verbatim via a `readerTranscriber(context)` seam so `VoiceNoteController` stays pure JVM. Cloud-offline/unconfigured falls through to local FUTO automatically (registry's own fallback order), satisfying "offline → local STT" with no extra code.
  - `AndroidVoiceRecorder`'s usable constructor is `internal` — fine here because the whole app is one Gradle module, but worth knowing if anyone splits `ui/voice` out.
  - `Dispatchers.Unconfined` + plain synchronous controller methods = deterministic JVM tests without kotlinx-coroutines-test (PlayerViewModelTest posture). One gotcha: a StateFlow collector resumed from a bare test thread runs inline; resumed from inside another Unconfined coroutine it queues on the event loop — never relied on cross-coroutine ordering, only direct calls.
  - Reduced-motion precedent: MicButton reads `Settings.Global.ANIMATOR_DURATION_SCALE <= 0`; VoiceBubble uses the same signal as its default.
- **Decisions made:**
  - `discard()`/new `cancelCapture()` deliberately do NOT delete kept session drafts — failing or abandoning one take must never destroy an earlier draft for that highlight. Drafts leave the map only via `clearDraft` (after save) or being overwritten by a successful new transcription.
  - Pill-mic semantics: draft exists & idle → `reopenDraft` re-emits `DraftReady` (sheet reopens pre-filled = "reopening restores text"); otherwise a fresh recording starts whose success overwrites the target's draft (last recording wins). The sheet's own mic (EditorVoiceSlot → same controller) inserts into the open editor at the caret — player parity.
  - Save lives behind `appendVoiceNote(hl, text, now)` (pure, tested): notes[] append of `"text<!--timestamp:N-->"` + `updatedAt` stamp; blank text saves nothing. Integration returns false when the highlight vanished — nothing saved silently, draft kept.
  - ReaderViewModel edits are additive-only, each marked `// VOICE-WIRE`: hook 1 `onMicPressed`, hook 2 `highlightStore` (repo access) + `voiceDraftLookup`/`voiceDraftFor`. No Task-28 code restructured.
  - Rotation mid-recording cancels the take (controller scope is composition-scoped). Acceptable v1; revisit if Task 32 wants VM-scoped survival.
- **Open questions:** none blocking.
- **Progress:** All owned files written (`VoiceBubble.kt`, `VoiceNoteController.kt`, `ReaderVoiceIntegration.kt`, VOICE-WIRE hooks in `ReaderViewModel.kt`). `./gradlew assembleDevDebug` BUILD SUCCESSFUL. `./gradlew testDevDebugUnitTest --tests "*VoiceNoteControllerTest*"` → **4 run, 0 failed** (phases transition; dismiss keeps + reopen restores; timestamped-note parse check; error→retry without loss). `*ReaderViewModelTest*` still 5/5 after the additive edits. No Waydroid install per instructions.

### Manual path (for Task 32's end-to-end verification)
1. Open a Ready reader page → select text → SwatchPill appears → tap 🎤.
2. Grant mic permission if asked (bubble flow retries automatically on grant).
3. VoiceBubble appears below the pill anchor: pulsing ring + mm:ss (tabular); tap it to stop.
4. Bubble shows "Transcribing…" (the only spinner); on success the CommentEditorSheet opens PRE-FILLED ("Voice note", chip inert at 0:00).
5. Save → highlight's notes[] gains `"text<!--timestamp:N-->"`, toast "Note attached" + haptic same frame, 💬n badge count grows.
6. Dismiss (×) instead → draft kept; press 🎤 again on the SAME selection → sheet reopens with the kept text (no re-record).
7. Airplane mode with only cloud keys configured → registry falls to local engine; if everything fails → bubble Error state shows Retry (same samples retranscribed, nothing lost) / Discard.
8. Reduced motion (animations off): enter is opacity-only, ring pulse static.

### Public API for Task 31/32

```kotlin
// ui/reader/VoiceNoteController.kt  (pure JVM)
data class HighlightDraftTarget(val highlightId: String)
sealed interface VoicePhase {
    data object Idle : VoicePhase
    data class Recording(val elapsedMs: Long) : VoicePhase
    data object Transcribing : VoicePhase
    data class DraftReady(val target: HighlightDraftTarget, val text: String) : VoicePhase
    data class Error(val message: String) : VoicePhase
}
class VoiceNoteController(
    scope: CoroutineScope,
    recorder: com.scholiast.android.ui.voice.VoiceRecorder,
    transcribe: suspend (FloatArray) -> TranscriptionResult,
) {
    val phase: StateFlow<VoicePhase>
    val drafts: StateFlow<Map<String, String>>          // session drafts, survives dismissal
    val recorderState: StateFlow<RecorderState>         // pass-through for MicButton slots
    fun start(target: HighlightDraftTarget)             // no-op while Recording/Transcribing
    fun stop()                                          // capture → Transcribing → DraftReady/Error
    fun retry()                                         // rerun transcribe on retained samples
    fun discard()                                       // abandon take; kept drafts untouched
    fun cancelCapture()                                 // abort run without touching drafts either way
    fun reopenDraft(target: HighlightDraftTarget): Boolean   // false ⇒ no draft (caller records fresh)
    fun consumeDraft()                                  // after handing DraftReady to an editor → Idle
    fun clearDraft(highlightId: String)                 // post-save removal
    fun shutdown()                                      // jobs + recorder.cancel()
}
fun appendVoiceNote(hl: PageHighlight, text: String, now: Long): PageHighlight?  // pure; "text<!--timestamp:N-->"

// ui/reader/VoiceBubble.kt
@Composable fun VoiceBubble(visible: Boolean, anchorRect: Rect?, phase: VoicePhase,
    onStop: () -> Unit, onRetry: () -> Unit, onDiscard: () -> Unit,
    modifier: Modifier = Modifier, reducedMotion: Boolean = reducedMotionDefault())
// ~180×48dp, anchored BELOW anchorRect center-x, clamped to host; tap surface = stop;
// Error row = Retry/Discard; exit is fade-only even without reduced motion.

// ui/reader/ReaderVoiceIntegration.kt
class ReaderVoiceIntegration(pageUrl: String, store: PageHighlightRepository,
                             controller: VoiceNoteController, clock: () -> Long = System::currentTimeMillis) {
    val controller: VoiceNoteController
    var editorViewModel: EditorViewModel?               // sheet hands its editor back (insertText path)
    internal var micHandler: ((HighlightDraftTarget) -> Unit)?   // overlay installs (permission-aware)
    fun attach(viewModel: ReaderViewModel)              // installs the VOICE-WIRE hooks
    fun onMicPressed(target: HighlightDraftTarget)      // reopenDraft ?: start
    suspend fun save(target: HighlightDraftTarget, text: String): Boolean
}
@Composable fun rememberReaderVoiceIntegration(viewModel: ReaderViewModel): ReaderVoiceIntegration

/** Mount at ReaderScreen's SHEET-SLOT (one line). anchorRect = the live pill rect
 *  (Task 29's tracked.pillRect) so the bubble grows from the mic point; null clamps to top-center. */
@Composable fun ReaderVoiceOverlay(viewModel: ReaderViewModel, modifier: Modifier = Modifier,
                                   anchorRect: Rect? = null,
                                   integration: ReaderVoiceIntegration = rememberReaderVoiceIntegration(viewModel))

// ui/reader/ReaderViewModel.kt additions (all marked // VOICE-WIRE)
var onMicPressed: ((HighlightDraftTarget) -> Unit)?   // set by integration; call to route pill mic
val highlightStore: PageHighlightRepository           // read-only access for thread-sheet flows
fun voiceDraftFor(highlightId: String): String?       // kept session draft → pre-fill reply boxes
```

**Task 32 recipe:** in ReaderScreen's SHEET-SLOT add `ReaderVoiceOverlay(viewModel, anchorRect = pillRect)`; feed `onMicPressed` from the SwatchPill's `onMic` callback (`viewModel.onMicPressed?.invoke(HighlightDraftTarget(highlight.id))`) and use `viewModel.voiceDraftFor(id)` when opening Task 31's ThreadSheet reply box so dismissed voice drafts restore. Hide the pill while `phase !is Idle`.
