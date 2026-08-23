import 'package:scholiast_flutter/core/models/page_highlight.dart';

/// Bridge contract between Dart and the WebView JS runtime.
///
/// Dart -> JS: [paintHighlights], [revealHighlight], [setReaderTheme],
/// [getArticleText], [commitPending].
///
/// JS -> Dart handlers are wired via `addJavaScriptHandler` in
/// [ReaderWebViewHost] and listed here for discoverability:
/// `onReady`, `onHighlightCreated`, `onHighlightUpdated`, `onHighlightDeleted`,
/// `onLinkTap`, `onScrollPct`, `onSelectionState`.
abstract class ReaderWebController {
  /// Paint (or repaint) all highlights in the WebView.
  Future<void> paintHighlights(List<PageHighlight> highlights);

  /// Scroll the highlight with [highlightId] into view and flash it.
  Future<void> revealHighlight(String highlightId);

  /// Apply reader typography.
  Future<void> setReaderTheme({required int fontStep, required bool isSerif});

  /// Return the visible article text as extracted by the JS runtime.
  Future<String> getArticleText();

  /// Commit any pending highlight selection (e.g. user tapped Save).
  Future<void> commitPending();

  /// Whether the JS bridge has reported readiness.
  bool get isReady;
}

/// In-memory fake for widget tests and Linux host.
///
/// Records the last arguments for assertions; never throws.
class FakeReaderWebController implements ReaderWebController {
  List<PageHighlight> lastPainted = const [];
  String? lastRevealedId;
  int lastFontStep = 0;
  bool lastIsSerif = false;
  String articleText = 'fake article text';
  bool commitCalled = false;
  int paintCallCount = 0;
  int revealCallCount = 0;
  int themeCallCount = 0;
  bool _ready = true;

  /// Override article text returned by [getArticleText] in tests.
  void setArticleText(String text) {
    articleText = text;
  }

  void setReady(bool ready) {
    _ready = ready;
  }

  @override
  bool get isReady => _ready;

  @override
  Future<void> paintHighlights(List<PageHighlight> highlights) async {
    lastPainted = List.unmodifiable(highlights);
    paintCallCount++;
  }

  @override
  Future<void> revealHighlight(String highlightId) async {
    lastRevealedId = highlightId;
    revealCallCount++;
  }

  @override
  Future<void> setReaderTheme({
    required int fontStep,
    required bool isSerif,
  }) async {
    lastFontStep = fontStep;
    lastIsSerif = isSerif;
    themeCallCount++;
  }

  @override
  Future<String> getArticleText() async => articleText;

  @override
  Future<void> commitPending() async {
    commitCalled = true;
  }

  void reset() {
    lastPainted = const [];
    lastRevealedId = null;
    lastFontStep = 0;
    lastIsSerif = false;
    commitCalled = false;
    paintCallCount = 0;
    revealCallCount = 0;
    themeCallCount = 0;
  }
}
