# Task 12: Reader WebView Surface

Status: DONE
Wave: 4
Depends on: task-03-anchoring-fuzzy-matcher, task-11-state-notifiers-riverpod

## Scope & Owned Files
- `scholiast_flutter/lib/ui/screens/reader/**` (ReaderWebController, NativeArticleView, ReaderWebViewHost, ReaderScreen, ReaderThreadSheet, highlight_span_builder)
- `scholiast_flutter/assets/wwwreader/android-reader.js` (WebView bridge JS)
- `scholiast_flutter/assets/wwwreader/android-reader.css` (WebView highlight styles)
- `scholiast_flutter/test/ui/reader_screen_test.dart`

## Acceptance Criteria
- ReaderWebController abstract interface + FakeReaderWebController for tests
- NativeArticleView renders LinearArticle blocks with SelectionArea + anchor.dart ranges (Linux-testable)
- ReaderWebViewHost loads live URL via flutter_inappwebview, injects android-reader.js implementing window.ReaderAndroid bridge + 7 JS→Dart handlers
- ReaderScreen ConsumerStatefulWidget with top bar (font +/-, serif toggle), selection ColorSwatchRow, thread sheet (quote header + notes + CommentEditorField + recolor/delete) wired through readerStateNotifierProvider.family
- `flutter analyze` 0 errors/warnings on owned files, `flutter test test/ui/reader_screen_test.dart` green
