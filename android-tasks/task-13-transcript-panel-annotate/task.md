# Task 13 — Transcript panel: live follow, selection, highlight, comment

Status: DONE

## Objective
The Transcript tab UI: live-following paragraph list, text selection → color swatch popup → transcript highlight, inline repaint of saved highlights, and opening the comment editor for a highlight.

## Scope — files you OWN (in `../android/app/src/main/java/com/scholiast/android/`)
- `ui/transcript/TranscriptTab.kt` — the tab content (paragraph list, live follow scroll, language picker)
- `ui/transcript/TranscriptViewModel.kt` — state (paragraphs, current cue, selections, saved highlights), highlight CRUD via Task 02's repository
- `ui/transcript/TranscriptSelection.kt` — selection handling (tap-to-select-cue, drag-range), swatch popup (yellow/red/green + Comment button)
- `ui/transcript/SwatchPopup.kt` — the swatch composable (44dp circular swatches, active ring) — shared style with the desktop's swatch
- `ui/transcript/TranscriptViewModelTest.kt` — unit tests

## References (read first)
- `../scholiast_mobile_app_plan.md`: §5.6.2 (live follow — active cue ~30% from top, only touch UI on cue change), §5.6.3 (selection → swatch → highlight with `anchor{startCue,startOffset,endCue,endOffset}`, `M:SS–M:SS` range, repaint on scroll/reopen), §2 (caption language picker defaults English), §6.2 (SwatchPopup), §9 M3
- Types: Task 02's `VideoItem` (`kind:"transcript"`, `quote`, `color`, `videoTime` = range start, `timeEnd`, `anchor`, `notes[]`); Task 06's item-card interface; Task 07's `CommentEditorSheet`; Task 08's renderer

## Requirements
- Paragraph list renders chunked cues; the active cue (from the 250 ms time poll via PlayerBridge) is highlighted and auto-scrolled to ~30% from the top; repaint only when the active cue changes.
- Language picker: small button in the panel header when >1 track; default English; choice is per-video-session (Task 12's `setSessionLanguage`).
- Selection: tap a paragraph = select the whole cue; drag-select a range; on selection end show the **swatch popup** near the selection.
- Pick a color → create a `kind:"transcript"` item: `quote` = selected text, `videoTime` = range start, `timeEnd` = range end, `anchor` = cue-index + char offsets, `color`. Saves via Task 02's repository.
- The **Comment** swatch button → opens Task 07's editor with the highlight attached; comment saves to `notes[]` on the item.
- Saved highlights repaint inline over the paragraph text (colored background spans); tapping an existing highlight opens its thread (Task 06 card or a mini thread) and seeks the video to the range start.
- Existing highlights load on reopen (repository → paint).

## Acceptance criteria
- Live follow scrolls correctly with the player time; only updates on cue change.
- Select → swatch → highlight → item created with the correct anchor/quote/range.
- Comment on a highlight saves to that item's notes.
- Unit tests: anchor derivation from cue ranges (verify against a fixture the TS would produce), active-cue index math, viewModel CRUD.

## Agent notes
- Coordinate the "comment on highlight" flow with Task 06's card thread rendering — you may both render threads; define which owns the editor sheet opening (log the decision).
- The `anchor` char offsets are **per-cue** offsets into that cue's text — match the TS `video-annotator.ts` convention exactly (read it before deriving).
- Write your log to `LOG.md` as you work.