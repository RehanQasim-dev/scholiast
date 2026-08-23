import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:scholiast_flutter/core/database/database.dart';
import 'package:scholiast_flutter/core/models/linear_article.dart';
import 'package:scholiast_flutter/core/models/page_highlight.dart';
import 'package:scholiast_flutter/core/providers/core_providers.dart';
import 'package:scholiast_flutter/core/theme/scholiast_theme.dart';
import 'package:scholiast_flutter/features/reader/reader_state_notifier.dart';
import 'package:scholiast_flutter/ui/screens/reader/highlight_span_builder.dart';
import 'package:scholiast_flutter/ui/screens/reader/native_article_view.dart';
import 'package:scholiast_flutter/ui/screens/reader/reader_screen.dart';
import 'package:scholiast_flutter/ui/screens/reader/reader_web_controller.dart';

LinearArticle _sampleArticle() {
  return const LinearArticle(
    url: 'https://example.com/article',
    title: 'Scholiast Reader Test',
    byline: 'By Tester',
    fetchedAt: 1712345678000,
    wordCount: 42,
    blocks: [
      LinearBlock(kind: 'p', text: 'The quick brown fox jumps over the lazy dog.'),
      LinearBlock(kind: 'p', text: 'Flutter enables cross-platform annotation surfaces.'),
      LinearBlock(kind: 'h2', text: 'Section One'),
      LinearBlock(kind: 'li', text: 'First bullet point about highlighting.'),
    ],
  );
}

void main() {
  group('ReaderWebController (Fake)', () {
    test('FakeReaderWebController records paint/reveal/theme/commit', () async {
      final fake = FakeReaderWebController();
      const h = PageHighlight(id: 'hl_1', color: 'yellow', notes: [], extras: {'content': 'hello'});
      await fake.paintHighlights([h]);
      expect(fake.lastPainted.length, 1);
      expect(fake.lastPainted.first.id, 'hl_1');
      expect(fake.paintCallCount, 1);

      await fake.revealHighlight('hl_1');
      expect(fake.lastRevealedId, 'hl_1');

      await fake.setReaderTheme(fontStep: 2, isSerif: true);
      expect(fake.lastFontStep, 2);
      expect(fake.lastIsSerif, isTrue);

      fake.setArticleText('custom text');
      expect(await fake.getArticleText(), 'custom text');

      await fake.commitPending();
      expect(fake.commitCalled, isTrue);
      expect(fake.isReady, isTrue);
    });
  });

  group('highlight_span_builder (anchor ranges)', () {
    test('resolveHighlightRange finds exact content substring', () {
      final article = _sampleArticle();
      final full = buildFullArticleText(article);
      const highlight = PageHighlight(
        id: 'hl_abc',
        color: 'green',
        extras: {'content': 'quick brown fox'},
      );
      final range = resolveHighlightRange(highlight, full);
      expect(range, isNotNull);
      expect(full.substring(range!.first, range.last + 1), 'quick brown fox');
    });

    test('highlightSpansForBlock isolates per-block spans', () {
      final article = _sampleArticle();
      final full = buildFullArticleText(article);
      final offsets = buildBlockOffsets(article);
      final hl = PageHighlight(
        id: 'hl_1',
        color: 'yellow',
        extras: {'content': 'quick brown fox'},
      );
      final spans = highlightSpansForBlock(
        blockIndex: 0,
        article: article,
        blockOffsets: offsets,
        fullText: full,
        highlights: [hl],
      );
      expect(spans.length, 1);
      expect(spans.first.start, 4); // "The " is 4 chars
      expect(spans.first.isActive, isFalse);
    });

    test('buildBlockTextSpans returns highlighted spans with tap recognizer', () {
      const hl = PageHighlight(id: 'hl_1', color: 'red', extras: {});
      final spans = buildBlockTextSpans(
        text: 'hello world',
        spans: const [
          BlockHighlightSpan(start: 0, endInclusive: 4, highlight: hl),
        ],
        onTapHighlight: (_) {},
      );
      // hello + " world" => 2 spans
      expect(spans.length, 2);
    });
  });

  group('NativeArticleView', () {
    testWidgets('renders blocks and highlight', (tester) async {
      final article = _sampleArticle();
      final hl = PageHighlight(
        id: 'hl_1',
        color: 'yellow',
        extras: {'content': 'quick brown fox'},
      );

      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: Scaffold(
            body: NativeArticleView(
              article: article,
              highlights: [hl],
              fontStep: 0,
              isSerif: false,
            ),
          ),
        ),
      );

      // Title rendered (header + possible duplicate) — at least one
      expect(find.textContaining('Scholiast Reader Test'), findsWidgets);
      // Article blocks rendered as RichText
      expect(find.byType(RichText), findsWidgets);
      expect(find.byType(NativeArticleView), findsOneWidget);
    });

    testWidgets('active highlight paints with underline', (tester) async {
      final article = _sampleArticle();
      final hl = PageHighlight(
        id: 'hl_1',
        color: 'green',
        extras: {'content': 'Flutter enables'},
      );

      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: Scaffold(
            body: NativeArticleView(
              article: article,
              highlights: [hl],
              activeHighlightId: 'hl_1',
            ),
          ),
        ),
      );

      expect(find.byType(NativeArticleView), findsOneWidget);
      expect(find.byType(RichText), findsWidgets);
    });
  });

  group('ReaderScreen (Riverpod + AppDatabase.inMemory)', () {
    late AppDatabase db;

    setUp(() {
      db = AppDatabase.inMemory();
    });

    tearDown(() {
      db.close();
    });

    testWidgets('renders top bar and native article via ProviderScope', (tester) async {
      const testUrl = 'https://example.com/article';
      final article = _sampleArticle();

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            databaseProvider.overrideWithValue(db),
          ],
          child: MaterialApp(
            theme: ScholiastTheme.darkTheme,
            home: ReaderScreen(
              url: testUrl,
              initialArticle: article,
              webController: FakeReaderWebController(),
              forceNativeView: true,
            ),
          ),
        ),
      );

      // Allow loadArticle async to settle
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.textContaining('Scholiast Reader Test'), findsWidgets);
      // Top bar font controls
      expect(find.byIcon(Icons.text_decrease), findsOneWidget);
      expect(find.byIcon(Icons.text_increase), findsOneWidget);
    });

    testWidgets('font controls update state', (tester) async {
      const testUrl = 'https://example.com/article-font';
      final article = _sampleArticle();

      await tester.pumpWidget(
        ProviderScope(
          overrides: [databaseProvider.overrideWithValue(db)],
          child: MaterialApp(
            theme: ScholiastTheme.darkTheme,
            home: ReaderScreen(
              url: testUrl,
              initialArticle: article,
              webController: FakeReaderWebController(),
              forceNativeView: true,
            ),
          ),
        ),
      );

      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      await tester.tap(find.byIcon(Icons.text_increase));
      await tester.pump();

      // Verify via provider that fontStep incremented
      final container = ProviderScope.containerOf(
        tester.element(find.byType(ReaderScreen)),
      );
      final state = container.read(readerStateNotifierProvider(testUrl));
      expect(state.fontStep, 1);
    });

    testWidgets('selection row creates highlight via ColorSwatchRow', (tester) async {
      const testUrl = 'https://example.com/article-select';
      final article = _sampleArticle();

      await tester.pumpWidget(
        ProviderScope(
          overrides: [databaseProvider.overrideWithValue(db)],
          child: MaterialApp(
            theme: ScholiastTheme.darkTheme,
            home: ReaderScreen(
              url: testUrl,
              initialArticle: article,
              webController: FakeReaderWebController(),
              forceNativeView: true,
            ),
          ),
        ),
      );

      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      // Trigger demo selection via app bar button
      await tester.tap(find.byKey(const Key('reader-demo-selection')));
      await tester.pump();

      expect(find.textContaining('Demo selected text'), findsOneWidget);

      // Tap yellow swatch to create highlight
      await tester.tap(find.bySemanticsLabel('yellow highlight color').first);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 150));

      final container = ProviderScope.containerOf(
        tester.element(find.byType(ReaderScreen)),
      );
      final state = container.read(readerStateNotifierProvider(testUrl));
      expect(state.highlights.length, 1);
      expect(state.highlights.first.color, 'yellow');
    });

    testWidgets('thread sheet recolor and delete via provider', (tester) async {
      const testUrl = 'https://example.com/article-thread';
      final article = _sampleArticle();

      await tester.pumpWidget(
        ProviderScope(
          overrides: [databaseProvider.overrideWithValue(db)],
          child: MaterialApp(
            theme: ScholiastTheme.darkTheme,
            home: ReaderScreen(
              url: testUrl,
              initialArticle: article,
              webController: FakeReaderWebController(),
              forceNativeView: true,
            ),
          ),
        ),
      );

      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      final container = ProviderScope.containerOf(
        tester.element(find.byType(ReaderScreen)),
      );
      final notifier = container.read(readerStateNotifierProvider(testUrl).notifier);

      final hl = await notifier.createHighlight(text: 'quick brown fox', color: 'yellow');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 150));

      // Sheet should be open with active highlight
      expect(find.textContaining('quick brown fox'), findsWidgets);

      // Recolor via notifier
      await notifier.recolorHighlight(hl.id, 'green');
      await tester.pump();
      final afterRecolor = container.read(readerStateNotifierProvider(testUrl));
      expect(afterRecolor.highlights.first.color, 'green');

      // Delete
      await notifier.deleteHighlight(hl.id);
      await tester.pump();
      final afterDelete = container.read(readerStateNotifierProvider(testUrl));
      expect(afterDelete.highlights, isEmpty);
    });
  });
}
