# Task 14 — Frame Markup Canvas

Status: DONE
Wave: 4
Depends on: task-02-core-domain-models, task-11-state-notifiers-riverpod

## Objective
Video frame screenshot markup canvas: GestureDetector drawing → normalized VideoMarkup (0..1 of W×H), tools pen/highlighter/line/rect/arrow/text/eraser, color picker (yellow/red/green/black), undo/redo + Ctrl+Z, Esc cancel, Enter save, text label TextField, export via PictureRecorder, Riverpod wrapper via playerStateNotifierProvider.addFrameCapture. Dark #0b0d14, accent #8B7CF6.

## Files Owned
- `scholiast_flutter/lib/ui/screens/frame/markup_math.dart` (432 lines, FrameColor enum, MarkupMath normalize/denormalize, MarkupSession undo/redo cap 50, eraser hit-testing, weight mapping)
- `scholiast_flutter/lib/ui/screens/frame/markup_painter.dart` (253 lines, MarkupPainter CustomPainter + drawMarkupToCanvas, strokePath smoothing, rect/arrow/text drawing, renderMarkupToJpeg via PictureRecorder)
- `scholiast_flutter/lib/ui/screens/frame/frame_draw_screen.dart` (FrameDrawScreen + FrameDrawScreenRiverpod)
- `scholiast_flutter/test/ui/frame_markup_test.dart` (19 tests: MarkupMath unit, painter smoke, drag→stroke, undo, save callback normalized JSON, AppDatabase.inMemory + ProviderScope)

## Verification
- `flutter analyze` — owned files: 0 errors (23 infos/warnings pre-existing, not owned: prefer_initializing_formals etc.)
- `flutter test test/ui/frame_markup_test.dart` — 19/19 passed

## Deviations
- Fixed `markup_math.dart` import path `../../core/models/video_item.dart` → `../../../core/models/video_item.dart` (wrong depth caused analyzer error; matches `lib/ui/screens/player/transcript_panel.dart` pattern). Fixed `markup_painter.dart` Rect collision via `as vm` prefix and `ui.Rect.fromLTWH`. Added explicit lambda types in `markup_math.dart` eraseStrokes to satisfy inference_failure_on_untyped_parameter.

## References
- android/app/src/main/java/com/scholiast/android/ui/frame/FrameDrawScreen.kt (363)
- android/app/src/main/java/com/scholiast/android/ui/frame/MarkupView.kt (532)
- android/app/src/main/java/com/scholiast/android/ui/frame/MarkupMath.kt (370)
- android/app/src/main/java/com/scholiast/android/ui/frame/FrameCaptureViewModel.kt (215)
- scholiast_flutter/lib/core/models/video_item.dart (VideoMarkup/Stroke/Line/Rect/Arrow/TextLabel fields)
- scholiast_flutter/lib/features/player/player_state_notifier.dart (playerStateNotifierProvider.addFrameCapture)
- scholiast_flutter/lib/core/theme/app_colors.dart (#0b0d14 background, #8B7CF6 accent)
