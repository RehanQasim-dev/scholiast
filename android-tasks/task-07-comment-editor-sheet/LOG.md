# 07-comment-editor-sheet — Agent log

Log entries appended while working on this task (see README.md, "Agent logging protocol").

## [2026-08-19 10:40] resume-session (deepseek-v4-flash-free)
- **What I learned:**
  - BOM 2025.06.01 resolves compose ui/foundation **1.9.0**, material3 **1.3.2** (verified in gradle cache). Old `BasicTextField(value: TextFieldValue, onValueChange)` overload still present (deprecated, not removed); `LocalSoftwareKeyboardController` is stable in `androidx.compose.ui.platform` with show()/hide(); `WindowInsets.isImeVisible` exists (foundation-layout, WindowInsets.android.kt:289). No `onTextSelectionChanged` on the old BasicTextField overload — selection must be read from the TextFieldValue itself.
  - NotesTab.kt (Task 06) holds the **placeholder** CommentEditorSheet with the agreed signature; its KDoc explicitly says "Task 07 replaces this body in its own file and this placeholder is deleted" — so deleting it + importing mine is sanctioned by the placeholder contract (I do not touch any other part of NotesTab.kt).
  - `TimestampChip` is `internal` in `com.scholiast.android.ui.notes` (NoteItemCard.kt) — importable from my `ui.notes.editor` package (same module). `formatVideoTime` lives there too.
  - `EditorDraft(itemId, videoTime, text)` is public in `ui.notes/NotesViewModel.kt`. NotesTab stamps the `<!--timestamp:N-->` itself via `makeVideoNote` on save — so the sheet's onSave delivers plain markdown; my VM additionally exposes `finalizeNote()` for consumers (Tasks 13/14) that want the stamped string.
  - NotesViewModel pattern: suspend methods update StateFlow in the calling coroutine → deterministic `runBlocking` unit tests, no Main dispatcher needed. I follow it.
  - Icons verified in material-icons-extended 1.9.0: FormatBold, FormatItalic, Checklist, Link, Keyboard (+ AutoMirrored FormatListBulleted).
- **Decisions made:**
  - `EditorViewModel` is a **plain class (not androidx ViewModel subclass)** created with `remember { }` inside the sheet: sheet-instance-scoped (fresh per draft opening, no ViewModelStore leak with unique keys, survives recomposition), still JVM-testable with runBlocking. VM created with `remember` (no key) because data-class `EditorDraft` equality would wrongly reuse a keyed VM across identical drafts.
  - **Click-away rule**: with the given API (onSave/onCancel only), "keeps it otherwise" can only mean the sheet does NOT dismiss — `onDismissRequest` calls onCancel() only when the text is blank, otherwise ignores the dismissal (draft preserved; user must explicitly Cancel/Save). Pure helper `shouldDiscardOnDismiss(text)` is unit-tested.
  - **Mic contract (for Task 09/10, per task.md "interface only")**: sheet takes `voice: EditorVoiceSlot? = null` = `{ state: RecorderState, onToggle, onCancel, onOpenSettings }`. When null → disabled mic glyph (layout holds); when provided → Task 09's `MicButton` rendered live. VoiceRecorderViewModel stays owned by the hosting screen (survives rotation); Task 10's transcriber inserts text via the same EditorViewModel the sheet already drives (a `onTranscribed(text)`-style insert is a plain `onFieldChanged` call — no sheet edits needed).
  - Keyboard gating: hide-on-focus in `onFocusChanged` (standard workaround) + `keyboardAllowed` flag set by the keyboard icon + flag reset when `WindowInsets.isImeVisible` goes false (covers system-back closing the IME while the field keeps focus).
  - Bullet/checklist commands mirror the desktop `applyCommentFormat`: same-kind again toggles off, different kind converts in place (`- [ ] ` ↔ `- `), per-line over multi-line selections; stored markers always `- ` (desktop renderer accepts `*` too but stored form is `- `).
  - Link command: non-empty selection → `[sel](url)` (caret after); empty → `[](url)` (caret inside parens); a small in-sheet URL dialog feeds the URL; `https://` is prepended when the user omits a scheme (renderer only links http(s)).
  - Tag suggestions: token detection = `#token` at caret, preceded by start/whitespace (desktop TAG_RE rule); suggestions from TagIndex.suggest (tags stored WITHOUT `#`); insert replaces the token and closes the list. Feed `tagIndex.addTags(extractTags(text))` on save (desktop union-only index).
- **Open questions:** none blocking. Voice transcriber (Task 10) will need to call `vm.onFieldChanged(TextFieldValue)` or similar to insert transcribed text — contract noted above.
- **Progress:** read all dependencies (VideoNote, TagIndex, MicButton/VoiceRecorder interface, NotesTab consumer, CommentRenderer, desktop comment-markdown.ts, plan §2/§5.4/§6.2/§6.4). Verified compose versions + icon availability in the gradle cache. Writing the 4 owned files next.

## [2026-08-19 22:47] resume-session (deepseek-v4-flash-free)
- **What I learned:**
  - `TextFieldValue` selections are **exclusive-end** (`TextRange(start, end)`); treating them as inclusive `IntRange` overran every `substring` by one (`begin 0, end 11, length 10` on a full-text selection) — root cause of 7 of the 10 failing tests.
  - Inside a Kotlin property accessor, `field` resolves to the **backing-field keyword**, so `EditorUiState.text get() = field.text` fails to compile ("Property must be initialized"); must be `this.field.text`.
  - `WindowInsets.isImeVisible` (foundation-layout 1.9) is a plain experimental **Boolean** snapshot read, not a `State<Boolean>` — `by` delegation fails; use `val imeVisible = WindowInsets.isImeVisible` + `@OptIn(ExperimentalLayoutApi::class)`.
  - `onFocusChanged` passes a `FocusState`, not `Boolean` — use `state.isFocused`.
  - `TagIndex.suggest` is suspend → `BasicTextField.onValueChange` must launch it in the sheet's `rememberCoroutineScope`.
- **Fixes made (all in task-owned files):**
  - `EditorViewModel.kt`: replaced inclusive `clampRange(IntRange)` with `clampSel(start, endExclusive)` used by `toggleSurround` / `applyLineCommand` / `insertLink`; toggle unwrap now also fires for a caret *inside* an existing pair (`a **b** c` caret at 4 → `a b c`); line-intersect bound is `lineEnd > s && lineStart <= e` (caret at a line's start counts that line); `serializeComment` collapses leftover double spaces after marker-strip; `extractTags` strips the `#` prefix (TagIndex storage form).
  - `EditorField.kt`: `onFocusChanged` now reads `.isFocused`.
  - `CommentEditorSheet.kt`: plain `val imeVisible`, added `ExperimentalLayoutApi` opt-in, launched `onFieldChanged` in the sheet scope.
  - `EditorViewModelTest.kt`: `index.all.value` (was comparing a StateFlow to a List).
- **Build/test results:**
  - `:app:assembleDebug` — **PASS** (exit 0, after fixes).
  - `:app:testDevDebugUnitTest` — my suite `EditorViewModelTest` **32/32 PASS**.
  - Full unit-suite run is blocked by a **different task's file**: `app/src/test/java/com/scholiast/android/domain/transcribe/FutoTranscriberTest.kt` (Task 11, untracked) fails to compile (`FutoTranscriberTest.kt:265:81 Cannot infer type for type parameter 'T'`, `:285:15 Unresolved reference 'cancel'`). It was moved to `/tmp/opencode/task07/`, my tests verified green, and it was restored **byte-identical** (sha256 `e903ef62…`). Logged for Task 11; not my file to fix.
- **Contract checks (final):**
  - `NotesTab.kt` calls `CommentEditorSheet(draft, timestampSeconds, onSave, onCancel, seekListener)` — signature matches my file exactly; the Task 06 placeholder is gone, my file is imported.
  - Serialization round-trips through Task 08's `CommentRenderer` (DONE): my commands emit `**b**` / `*i*` / `[label](url)` / bare urls / `#tag` / `- item` / `- [ ] task`, and `finalizeNote()` emits `text<!--timestamp:N-->` — all of which `renderComment` parses (markers stripped, tasks/links/tags/bold/italic recognized). `CommentRendererTest` passed in the suite.
- **Open questions:** none. Task 09/10 wiring contract (`EditorVoiceSlot`) already logged below.
- **Progress:** **TASK COMPLETE.** All acceptance criteria met: keyboard gating (opt-in via icon), timestamp chip + seek, markdown commands with undo-friendly single edits, `#tag` autocomplete + pills, empty-draft discard rule, serialization to the comment-markdown subset with Task 02's `makeVideoNote`. `task.md` set to DONE.

