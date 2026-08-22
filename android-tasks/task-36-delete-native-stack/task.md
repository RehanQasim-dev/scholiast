# Task 36 — Delete the native-selection stack + regression + docs

Status: DONE

## Objective
The native reader implementation is replaced by the WebView path (tasks 34–35). Remove the dead
code cleanly, keep everything the app still needs, run the full regression, update docs.

Plan: `../scholiast_web_annot_app_plan.md` Revision B ("Native reader code → DELETE").

## Scope — files you OWN (deletions + their compile fallout)
DELETE:
- `ui/reader/ReaderAnnotationMount.kt` (ReaderSelectionState, ReaderBlockText, snapToWords, TextWithGestures)
- `ui/reader/SelectionTracker.kt`
- `ui/reader/HighlightController.kt`, `ui/reader/HighlightPainter.kt`, `ui/reader/BadgeChip.kt`,
  `ui/reader/SwatchPill.kt`, `ui/reader/ReaderHighlightPreview.kt`
- `ui/reader/NativeReader.kt` (+ ReaderTypography if unused elsewhere)
- `domain/reader/Linearizer.kt` (+ LinearizerTest) — render path gone; KEEP `domain/reader/AnchorKt.kt`
  + its test (cross-surface reference), `domain/reader/Extractor.kt`? NO — fetch now feeds raw html
  to webview; Extractor/readability4j/RY grabber become UNUSED by reader: delete
  Extractor.kt + RYArticleGrabberExtended.kt + ExtractorTest + fixtures ONLY IF nothing else
  imports them (verify with grep; log what you found).
- Their tests: HighlightControllerTest, SnapToWordsTest.
KEEP: DeepLink.kt if still referenced; ThreadSheet/HighlightActionsController/ReaderToast;
VoiceBubble/VoiceNoteController/ReaderVoiceIntegration; AnchorKt.

Fix all compile fallout in remaining files (imports, unused params on ReaderScreen/TopBar).

## Regression pass
1. `./gradlew assembleDevDebug` green.
2. Targeted suites: ui.reader.* + sync + home + notes editor — all green.
3. `waydroid app install app/build/outputs/apk/dev/debug/app-dev-debug.apk`.
4. Manual checklist via Waydroid launch: share article → read → highlight → voice note → badge;
   recolor/delete-undo from sheet; dark toggle; copy article; kill/reopen restore. Record results.

## Docs
- Update `../android-tasks/README.md`: mark tasks 26/28/29/33 rows as superseded-by-Revision-B
  (keep history, add a one-line pivot note at the table top).
- Append final LOG.md entry here with deletions list, kept-list rationale, checklist results.

Report progress EVERY response even mid-work — never return empty. Final message MUST include:
deleted files list, build outcome, test counts, Waydroid status.
