# Task 06 — Note timeline & timestamped notes

Status: DONE

## Objective
The Notes tab: the time-ordered list of all items (frames, notes, transcript highlights) for the current video, with M:SS chips that seek the video, item cards with comment threads, and the "new note at current time" flow.

## Scope — files you OWN (in `../android/app/src/main/java/com/scholiast/android/`)
- `ui/notes/NotesTab.kt` — the tab content (list, item cards, thread display)
- `ui/notes/NotesViewModel.kt` — items state, add/delete/update operations, seek requests (via PlayerBridge interface)
- `ui/notes/NoteItemCard.kt` — card: kind icon, M:SS chip, quote/preview, thread (collapsed), color rail
- `ui/notes/NotesViewModelTest.kt` — unit tests

## References (read first)
- `../scholiast_mobile_app_plan.md`: §5.4 (Notes tab behavior), §6.3 (Player panel design), §5.7.3 (the four item kinds), §9 M1
- Types: Task 02's DTOs + `VideoItemRepository` (page items CRUD); Task 05's `PlayerBridge` (seek); Task 08's renderer interface for thread bodies (code against the interface; Task 08 builds it)

## Requirements
- Time-ordered list of all items for the video, newest-last (or video-time order? — follow §5.4: time-ordered, newest-last in the timeline; transcript highlights also appear with their range).
- Each card: kind icon (frame/note/transcript), `M:SS` chip (mono, tabular) — **tapping the chip seeks the video** via the bridge.
- Transcript items show quote + `M:SS–M:SS` range chip + color rail (yellow/red/green). Frame items show a small thumbnail (loaded from the item's frame file store — interface only if Task 14 isn't built; stub the image loader).
- Comment thread (collapsed) under each card; count badge; tapping expands (rendering via Task 08's interface).
- **"＋ New note"** button: captures `currentTime` from the bridge, opens Task 07's editor sheet (interface: `CommentEditorSheet(itemDraft, onSave, onCancel)` — implement the plumbing, sheet comes from Task 07).
- Delete item: swipe or menu → confirm dialog → repository delete (also triggers Task 14's frame-file delete hook if applicable — interface only).
- Items react live to repository changes (Flow collection).

## Acceptance criteria
- Add note at current time → appears in the list; M:SS chip seeks.
- Frame/note/transcript cards render distinctly with correct icons/chips/rails.
- Delete works with undo toast (snapshot the page items first).
- Unit tests: ordering, chip formatting (port `formatVideoTime` from `../src/utils/video/video-notes.ts`), viewModel CRUD with fake repository.

## Agent notes
- Do NOT build the editor sheet itself (Task 07 owns it) — define the interface in your files so Task 07 can implement against it, and log the interface signature.
- Thread rendering: use Task 08's `CommentRenderer` interface; if absent, define the minimal interface and log it.
- Write your log to `LOG.md` as you work.