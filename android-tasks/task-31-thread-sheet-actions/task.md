# Task 31 — Thread sheet & highlight actions (standalone)

Status: DONE

## Objective
The comment-thread surface and highlight management actions as a self-contained, preview-driven
module: quoted text pinned on top (color-railed), replies with per-reply delete,
whole-thread delete only at 2+ replies, recolor/delete-with-undo — adaptive bottom sheet
(phone) / docked side panel (tablet landscape ≥600dp). Mounting into ReaderScreen happens in
Task 32; you deliver the component + its controller.

Plan: `../scholiast_web_annot_app_plan.md` §5.5, §6.2, §6.4, §6.5 (ThreadSheet rows).

## Scope — files you OWN (in `../android/`)
- `ui/reader/ThreadSheet.kt` — the adaptive surface:
  - <600dp width → `ModalBottomSheet` (spring dampingRatio 0.8 / response ~0.3s per §6.5;
    drag 1:1 with grab offset, velocity-handoff release, rubber-band at bound, flick-dismiss
    ~0.11 px/ms if using a custom wrapper; else platform sheet defaults + documented deviation).
  - ≥600dp landscape → docked right panel, NO scrim (parallel surface), slide from/exits right.
  - Content: pinned quote block (color rail = highlight hue, serif quote style), thread of
    replies rendered via the app's existing comment renderer subset, reply box =
    existing CommentEditorSheet editor field (mic+keyboard icons, formatting bar; diagram/image
    buttons hidden), per-reply delete on hover/long-press, thread-delete button appears only
    when notes.size ≥ 2.
- `ui/reader/HighlightActionsController.kt` — JVM-testable logic over `PageHighlight` lists:
  addReply(note text → timestamp format), editReply(index, newText with `<!--edited:M-->`),
  deleteReply(index), deleteThread (returns tombstone-ready list), recolor(group,color),
  deleteWithUndo payload (snapshot for snackbar undo). Newest-wins `updatedAt` stamping parity
  with Task 27's repository rules.
- `ui/reader/ReaderToast.kt` — bottom-center toast: rise+fade 200ms, timer pauses while touched,
  carries an optional Undo action (used by delete/recolor).
- Tests: `HighlightActionsControllerTest` — reply add/edit/delete formats (`<!--timestamp:N-->`,
  `<!--edited:M-->`), thread-delete gating, recolor propagates across groupId pieces,
  undo payload round-trip. Compose previews for both layouts.

## Requirements
- Back-gesture unwind contract: sheet closes first (document via `onBack` handling hook).
- TalkBack labels on every control; highlight announce string "yellow highlight, N comments".
- No ViewModel/Room/network access — state in, callbacks out (Task 32 wires).

## Acceptance criteria
- Controller tests pass (`…HighlightActionsControllerTest`). Previews compile for phone/tablet.
- LOG.md documents the exact public API for Task 32 mounting.

## Agent notes
- You do NOT touch ReaderScreen/NativeReader/pill/painter files. Existing shared components
  (CommentEditorSheet internals) are consumed read-only; copy small composables rather than
  editing shared files if adaptation is needed — note any copies in LOG.md.
