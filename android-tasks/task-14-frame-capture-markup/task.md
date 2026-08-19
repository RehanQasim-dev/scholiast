# Task 14 — Frame capture + MarkupView + the four comment paths

Status: DONE

## Objective
The frame feature: capture the video frame (Task 05's bridge), draw on it with S-Pen-capable tools, and save it through one of the four comment paths with OCR hook (Task 15).

## Scope — files you OWN (in `../android/app/src/main/java/com/scholiast/android/`)
- `ui/frame/FrameCaptureViewModel.kt` — capture flow state (capturing, drawing, saving), pause/resume orchestration
- `ui/frame/MarkupView.kt` — the custom `View`: frame bitmap + markup overlay layers, pencil/highlighter/eraser/colors/undo-redo
- `ui/frame/FrameDrawScreen.kt` — full-bleed draw screen + toolbar (tool, color, undo, redo, clear, Save, Discard, Comment)
- `ui/frame/FrameStore.kt` — frame JPEG file store (`filesDir/frames/<itemId>.jpg`), metadata (`frame{w,h,driveId}` in the item JSON — never bytes inline)
- `ui/frame/MarkupMath.kt` — stroke → normalized 0..1 JSON (VideoMarkup), undo stack, eraser hit-testing; + tests
- `ui/frame/FrameCaptureTest.kt` — unit tests

## References (read first)
- `../scholiast_mobile_app_plan.md`: §5.7 (capture, draw surface, the four comment paths table, storage), §2 (frame = pause on capture, resume on save/discard; OCR immediately at save), §6.3 (frame draw screen), §9 M4
- Desktop reference: `../src/utils/video/video-annotator.ts` (overlay behavior, normalized-coordinate model), `../src/utils/video/video-markup.ts` (stroke/line/text/rect/arrow JSON shape — match the shape exactly), `../src/utils/video/frame-capture.ts` + `frame-store.ts` (storage semantics)

## Requirements
- Capture: player pauses on capture; frame JPEG decoded to bitmap (downscale ≤1280px); DRM/black frame → toast "This video can't be captured" + resume playback.
- `MarkupView`: bottom = frame bitmap; top = markup layer. **Pencil** (round cap, width = f(pressure)); **Highlighter** (wide, ~35% alpha); **Eraser** (clears markup layer only); **Colors** yellow/red/green/black; **Undo/Redo** (snapshot stack, cap 50).
- **Palm rejection**: pen hover (`ACTION_HOVER_*`) suppresses finger strokes while near; `TOOL_TYPE_STYLUS/ERASER/FINGER` dispatch; `AXIS_PRESSURE` for width.
- Save: writes JPEG → FrameStore, builds `VideoMarkup` with normalized coords, creates `kind:"frame"` item via Task 02's repository, then calls Task 15's OCR hook (interface; stub until Task 15 lands). Resumes playback if it was playing.
- **Comment paths** (all four): frame+comment (original JPEG); frame+comment after drawing (edited JPEG replaces original); timestamp-only note with no frame (delegated to Task 06's "new note" — implement the path here too); transcript highlight+comment (Task 13 owns it — just route it here in the flow table, don't reimplement).
- Discard: no item, no file, resume playback.
- Delete a frame item later: FrameStore.delete + repository delete (called from Task 06's delete flow — expose the hook).

## Acceptance criteria
- Capture→draw→save round-trip: file exists, item JSON has `frame{w,h}` + `markup`, no bytes inline.
- Pencil/highlighter/eraser/undo/redo work on-device (Robolectric for hit-test math; device test for pressure).
- Palm-rejection logic unit-tested (hover event sequence → no finger stroke).
- Markup JSON matches the TS `video-markup.ts` shape (normalized 0..1) — verified by a golden JSON fixture.

## Agent notes
- The OCR hook: define `OcrHook { suspend fun run(itemId, imageFile): String? }` with a no-op stub; Task 15 implements it.
- Coordinate with Task 05 (capture command) and Task 06 (item display + delete) — you own the frame store and draw UI; they own the list display and seek chips.
- Write your log to `LOG.md` as you work.