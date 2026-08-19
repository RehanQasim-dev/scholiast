# Task 07 — Comment editor sheet

Status: DONE

## Objective
The bottom-sheet comment editor used everywhere (new note, reply, frame comment): light-markdown text field, formatting buttons, `#tag` pills, timestamp chip, and the **mic + keyboard icon pair** (keyboard opens only on tap).

## Scope — files you OWN (in `../android/app/src/main/java/com/scholiast/android/`)
- `ui/notes/editor/CommentEditorSheet.kt` — the sheet composable + its state
- `ui/notes/editor/EditorViewModel.kt` — draft state, markdown insert commands, tag autocomplete state
- `ui/notes/editor/EditorViewModelTest.kt` — unit tests
- `ui/notes/editor/EditorField.kt` — the `BasicTextField` wrapper with formatting toolbar (bold/italic/bullets/checklist/link)

## References (read first)
- `../scholiast_mobile_app_plan.md`: §5.4 (editor sheet behavior — mic + keyboard icons, timestamp chip, Save/Cancel), §2 (keyboard is opt-in: **focus does NOT open the keyboard; a keyboard icon next to the mic does**), §6.2 (`EditorField` component), §6.4 (≥48dp targets, TalkBack)
- Desktop reference for the markdown subset + tag pills: `../src/utils/comment-markdown.ts` (bold/italic/links/bare URLs/`#tag`/`- item`/`- [ ] task`) — the *rendering* side is Task 08; here you only need the editing commands + serialization to that markdown subset

## Requirements
- Sheet layout: draft area on top; bottom row = formatting buttons (bullet list, checklist, bold, italic, link) left; **mic button + small keyboard icon** right; then Save/Cancel (large, purple-accented Save).
- Keyboard gating: `BasicTextField` never auto-shows the IME on focus; the **keyboard icon** calls `focusRequester.requestFocus()` + `LocalSoftwareKeyboardController.show()`. A small keyboard icon mirrors the mic button's style.
- Timestamp chip: shows the draft's `videoTime` as `M:SS`; tap → seek via PlayerBridge; baked into the saved item automatically (not into the text).
- Markdown commands apply the browser-style edits (surround selection with `**`, `*`, `- `, `- [ ] `, `[text](url)`), with undo-friendly behavior; serialization to the comment-markdown subset.
- `#tag` autocomplete: typing `#` pops a suggestion list (source: Task 02's tag index — interface `TagIndex`; stub if absent); arrows/tap insert; typed tag becomes a pill once the caret leaves it.
- Empty draft → Save disabled; click-away (outside tap/back) discards an empty draft silently, keeps it otherwise.
- On save: produce the note string in the `text<!--timestamp:N--><!--edited:M-->` format (Task 02's helpers).

## Acceptance criteria
- Type → no keyboard; tap keyboard icon → IME appears; tap mic → recorder flow starts (Task 09's `VoiceRecorder` interface — code against it, Task 09 builds it).
- Bold/italic/bullet/checklist/link insert correct markdown around selection.
- `#tag` autocomplete works; finished tags render as pills.
- Unit tests: markdown command transforms, serialization round-trip, empty-draft discard rule.

## Agent notes
- This sheet is used by Task 06 (new note), Task 13 (transcript comment), Task 14 (frame comment), Task 09/10 (voice drafts) — make its API: `CommentEditorSheet(draft: EditorDraft, timestampSeconds: Double, onSave: (String) -> Unit, onCancel: () -> Unit, seekListener: (Double) -> Unit)`.
- Voice integration: expose `micButtonState` callbacks so Task 09/10 can wire the recorder + transcriber into the sheet without editing your files (interface only — log the contract).
- Write your log to `LOG.md` as you work.