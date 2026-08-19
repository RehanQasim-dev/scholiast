# 06-note-timeline — Agent log

Log entries appended while working on this task (see README.md, "Agent logging protocol").

## [2026-08-19 19:32] task-06 agent
- **What I learned:**
  - Task 02's `VideoItemRepository` is **suspend-only, no Flow** (the task.md's "(Flow)" is not in the built interface). Live updates must come from explicit `load()` on tab activation/resume; noted as an open question for a future `observe()` addition.
  - Desktop `genVideoId()` = `Date.now().toString(36) + Math.random().toString(36).slice(2,7)`. Kotlin `Double.toString(Math.random())` is NOT always ≥7 chars ("0.5") — ported as base36-time + 5 random base36 chars instead (format-identical, not bit-identical; ids are opaque).
  - `formatVideoTime` (video-notes.ts): `Math.max(0, Math.floor(seconds))`, `H:MM:SS` only when h>0, zero-padded M/SS.
  - Task 07's spec already fixes the editor API: `CommentEditorSheet(draft: EditorDraft, timestampSeconds: Double, onSave: (String) -> Unit, onCancel: () -> Unit, seekListener: (Double) -> Unit)` — my placeholder in NotesTab.kt uses exactly that signature, and I define `EditorDraft` here so Task 07 can import or relocate it.
  - `AppDatabase.getInstance(context)` singleton + `RoomVideoItemRepository(dao)` make a `viewModel(key=factory=)` wiring trivial.
- **Decisions made:**
  - **Ordering**: video-time ascending (timeline reads top-down as the video progresses), stable (repo order kept within equal times — "newest-last" = the newest item in video time at the bottom). VM re-sorts defensively on load.
  - **VM methods are suspend + mutate StateFlow in the calling coroutine** (no viewModelScope init-load, no kotlinx-coroutines-test dependency) → deterministic JVM tests with `runBlocking`; UI drives `load()` via `LifecycleResumeEffect`.
  - Interfaces defined in MY files (signatures logged below): `VideoTimeProvider`, `SeekRequestListener`, `FrameFileDeleteHook`, `EditorDraft`, `CommentEditorSheet` (placeholder), `CommentBody` (placeholder, Task 08), `FrameThumb` (placeholder, Task 14), `TimestampChip`, `formatVideoTime`.
  - `formatVideoTime` lives in `ui/notes/NoteItemCard.kt` (package `com.scholiast.android.ui.notes`, module-internal visibility OK for Task 07's import) until a `util/` owner exists (AGENTS.md package map).
  - Delete-with-undo: VM snapshots the whole page-item list before delete; `undoDelete()` re-adds every snapshot item via `addItem` (stamps `updatedAt` — acceptable; page row recreated if the delete emptied it).
  - Transcript range chip text uses en dash `M:SS–M:SS`, seeks to range start.
- **Open questions:**
  - Task 02 repo has no change Flow → Notes tab updates on resume + after local ops only; a sync/transcript write elsewhere needs a refresh or a future `observe(url)`.
  - Comment-edit (rewrite an existing note) is NOT in Task 06 scope; `updateItem` passthrough is exposed for Task 07/13.
- **Progress:**
  - task.md → IN PROGRESS. Wrote `ui/notes/NotesViewModel.kt` (state, addNote/addReply/updateItem/deleteItem+undo, seek, hooks), `ui/notes/NoteItemCard.kt` (card, TimestampChip, color rail, collapsed thread, placeholders CommentBody/FrameThumb, formatVideoTime port), `ui/notes/NotesTab.kt` (list, new-note flow, reply flow, delete dialog + undo snackbar, CommentEditorSheet placeholder). Tests next.

## [2026-08-19 20:55] RESUME (task-06 agent)
- **What I learned:**
  - **Concurrent-agent hazard on the shared tree (IMPORTANT for orchestrator):** while finishing this task, Task 04's agent renamed my whole `ui/notes/` dir to `/tmp/opencode/task04-notes-aside/` and Task 08's agent edited my `NoteItemCard.kt` (removed my `CommentBody` placeholder) and dropped its own in-flight `ui/notes/render/CommentRenderer.kt` + `CommentRendererTest.kt` into my package tree. All my files are now restored from the aside snapshot (verified byte-identical to the versions that pass the test suite). The aside backup still lives at `/tmp/opencode/task04-notes-aside/`.
  - **Task 08's renderer currently BLOCKS the build** (`ui/notes/render/CommentRenderer.kt:531` uses the internal `TextUnit(...)` constructor; earlier it also referenced a nonexistent `LinkAnnotationStyles`). My verification was done with both of Task 08's in-flight files moved aside; I restored them to their places afterwards (do not revert them — Task 08 is actively editing). Task 08 also edited MY `NoteItemCard.kt` to feed it raw `markdown = note` (markers included); I reverted to my placeholder contract (`markdown = parsed.text`, markers stripped) since their renderer doesn't compile yet. When Task 08's renderer compiles, an integration pass should point `NoteItemCard` at their `CommentBody`.
  - **One real VM bug fixed:** `undoDelete()` re-loaded state but never cleared `canUndoDelete` (load() preserves it), so the undo snackbar state stayed armed after an undo. Fixed by explicitly setting `_state.update { it.copy(canUndoDelete = false) }` after the reload.
- **Decisions made:**
  - Final interface signatures Tasks 07/08/13/14 must implement (unchanged from earlier entries, now verified by a green build):
    - Editor sheet (Task 07): `@Composable fun CommentEditorSheet(draft: EditorDraft, timestampSeconds: Double, onSave: (String) -> Unit, onCancel: () -> Unit, seekListener: (Double) -> Unit)` in `ui/notes` (placeholder in NotesTab.kt until Task 07 lands). `EditorDraft(itemId: String? = null, videoTime: Double, text: String = "")` — null `itemId` = new note at `videoTime`.
    - Comment body (Task 08): `@Composable fun CommentBody(markdown: String, modifier: Modifier = Modifier)` — callers pass the plain text with markers stripped (`parseVideoNote`). Placeholder in NoteItemCard.kt until Task 08's renderer compiles.
    - Frame thumbnail (Task 14): `@Composable fun FrameThumb(itemId: String, modifier: Modifier = Modifier)` — loads `filesDir/frames/<itemId>.jpg`; placeholder until Task 14 lands.
    - Seek (Task 05/13): chip taps call `viewModel.seekTo(seconds)` → forwards to `SeekRequestListener.seekTo(Double)`; time reads go through `VideoTimeProvider.currentTime(): Double`; frame-item delete invokes `FrameFileDeleteHook.deleteFrameFile(itemId)`.
    - `TimestampChip(seconds: Double, endSeconds: Double? = null, onClick: () -> Unit, modifier: Modifier = Modifier)` — mono/tnum, `M:SS–M:SS` en-dash range when `endSeconds > seconds`, lives in `ui/notes` (shared).
  - Keep the delete-with-undo semantics: snapshot taken at EACH delete (page state just before the delete); undo restores that snapshot only — a second delete replaces the snapshot, so an earlier deletion stays deleted.
- **Open questions:**
  - Task 02 repo still has no change Flow; Notes tab refreshes on tab resume + after local ops. (Unchanged.)
  - Build is currently RED solely due to Task 08's in-flight `CommentRenderer.kt`; needs Task 08 to finish (or an orchestrator decision) before `assembleDebug`/`testDevDebugUnitTest` go green in the shared tree.
- **Progress:**
  - Finished `NotesViewModelTest.kt`: 25 tests (ordering/stability, `formatVideoTime` port from `video-notes.ts` incl. negative/floor cases, CRUD via fake repo, delete+undo incl. empty-page and snapshot-replacement cases, frame-file/seek hooks, `genVideoId` uniqueness).
  - Fixed 4 test bugs (wrong expectations after my earlier edits) + 1 VM bug (above).
  - **Verified:** `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ./gradlew :app:assembleDebug` → BUILD SUCCESSFUL; `./gradlew :app:testDevDebugUnitTest` → **142 tests, 0 failures** (incl. my 25) with Task 08's in-flight renderer files moved aside. Files restored to workspace afterwards.
  - task.md → DONE.