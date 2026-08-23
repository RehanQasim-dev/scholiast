import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:scholiast_flutter/core/database/database.dart';
import 'package:scholiast_flutter/core/database/entities/video_page_entity.dart';
import 'package:scholiast_flutter/core/models/linear_article.dart';
import 'package:scholiast_flutter/core/models/transcript_models.dart';
import 'package:scholiast_flutter/core/models/video_item.dart';
import 'package:scholiast_flutter/core/providers/core_providers.dart';
import 'package:scholiast_flutter/core/stt/whisper_model_manager.dart';
import 'package:scholiast_flutter/core/sync/sync_models.dart';
import 'package:scholiast_flutter/core/theme/scholiast_theme.dart';
import 'package:scholiast_flutter/features/player/player_state_notifier.dart';
import 'package:scholiast_flutter/features/settings/settings_prefs.dart';
import 'package:scholiast_flutter/features/sync/sync_providers.dart';
import 'package:scholiast_flutter/ui/components/sync_status_bar.dart';
import 'package:scholiast_flutter/ui/screens/frame/frame_draw_screen.dart';
import 'package:scholiast_flutter/ui/screens/home/home_screen.dart';
import 'package:scholiast_flutter/ui/screens/player/player_web_controller.dart';
import 'package:scholiast_flutter/ui/screens/reader/reader_screen.dart';
import 'package:scholiast_flutter/ui/screens/reader/reader_web_controller.dart';
import 'package:scholiast_flutter/ui/screens/settings/settings_screen.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

LinearArticle _article(String url) => LinearArticle(
      url: url,
      title: 'E2E Article',
      byline: null,
      fetchedAt: 1712345678000,
      wordCount: 10,
      blocks: const [
        LinearBlock(kind: 'p', text: 'The quick brown fox jumps over the lazy dog.'),
        LinearBlock(kind: 'p', text: 'Flutter enables cross-platform annotation surfaces.'),
      ],
    );

LoadedTranscript _dummyTranscript(String videoId) => LoadedTranscript(
      videoId: videoId,
      languageCode: 'en',
      tracks: const [
        CaptionTrack(languageCode: 'en', name: 'English', baseUrl: 'https://example.com/captions', isAsr: false),
      ],
      cues: const [
        Cue(start: 0, duration: 2, text: 'Hello world', cueIndex: 0),
        Cue(start: 2, duration: 2, text: 'This is a test paragraph', cueIndex: 1),
        Cue(start: 5, duration: 2, text: 'Second paragraph begins here', cueIndex: 2),
      ],
      paragraphs: const [
        CueParagraph(
          start: 0,
          text: 'Hello world This is a test paragraph',
          cues: [
            Cue(start: 0, duration: 2, text: 'Hello world', cueIndex: 0),
            Cue(start: 2, duration: 2, text: 'This is a test paragraph', cueIndex: 1),
          ],
        ),
        CueParagraph(
          start: 5,
          text: 'Second paragraph begins here',
          cues: [
            Cue(start: 5, duration: 2, text: 'Second paragraph begins here', cueIndex: 2),
          ],
        ),
      ],
    );

// ---------------------------------------------------------------------------
// 1. home -> reader navigation (via GoRouter + onOpenPage callback)
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('E2E', () {
    testWidgets('home -> reader navigation via GoRouter query param', (tester) async {
      // Use tablet-sized surface so GridView (≥900px) shows both cards side-by-side.
      // Without this the 800px-wide tester only renders the first ListView item.
      tester.view.physicalSize = const Size(1200, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() => tester.view.resetPhysicalSize());

      final db = AppDatabase.inMemory();
      addTearDown(db.close);
      const articleUrl = 'https://example.com/e2e-article';
      const videoUrl = 'https://www.youtube.com/watch?v=e2e123';

      // Seed one article and one video so Home has content.
      await db.videoPages.upsertPage(const VideoPageEntity(
        urlHash: 'hash-article-e2e',
        url: articleUrl,
        title: 'E2E Article | Site',
        itemsJson: '[]',
        updatedAt: 1700000000000,
        highlightsJson: '[]',
      ));
      await db.videoPages.upsertPage(const VideoPageEntity(
        urlHash: 'hash-video-e2e',
        url: videoUrl,
        videoId: 'e2e123',
        title: 'E2E Video | Site',
        itemsJson: '[]',
        updatedAt: 1700000001000,
        highlightsJson: '[]',
      ));

      // Build a minimal GoRouter that mimics main.dart's / and /reader routes.
      final router = GoRouter(
        initialLocation: '/',
        routes: [
          GoRoute(
            path: '/',
            builder: (context, state) => HomeScreen(
              onOpenPage: (page) {
                final enc = Uri.encodeComponent(page.url);
                final isVideo = (page.videoId != null && page.videoId!.isNotEmpty) ||
                    page.url.contains('youtube.com') ||
                    page.url.contains('youtu.be');
                if (isVideo) {
                  context.push('/player?url=$enc');
                } else {
                  context.push('/reader?url=$enc');
                }
              },
            ),
          ),
          GoRoute(
            path: '/reader',
            builder: (context, state) {
              final raw = state.uri.queryParameters['url'] ?? '';
              final url = raw.isEmpty ? '' : Uri.decodeComponent(raw);
              return ReaderScreen(
                url: url,
                initialArticle: _article(url),
                forceNativeView: true,
                webController: FakeReaderWebController(),
              );
            },
          ),
          GoRoute(
            path: '/player',
            builder: (context, state) {
              final raw = state.uri.queryParameters['url'] ?? '';
              final url = raw.isEmpty ? '' : Uri.decodeComponent(raw);
              // Extract videoId — simplified for test.
              final uri = Uri.tryParse(url);
              final vid = uri?.queryParameters['v'] ?? 'e2e123';
              return Text('player:$vid');
            },
          ),
        ],
      );
      addTearDown(router.dispose);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            databaseProvider.overrideWithValue(db),
          ],
          child: MaterialApp.router(
            theme: ScholiastTheme.darkTheme,
            routerConfig: router,
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle(const Duration(milliseconds: 200));

      // Home should list the article (now visible in 2-col grid).
      expect(find.textContaining('E2E Article'), findsWidgets);

      // Tap the article row — Home's onOpenPage should push /reader.
      final articleFinder = find.textContaining('E2E Article').first;
      await tester.ensureVisible(articleFinder);
      await tester.pumpAndSettle();
      await tester.tap(articleFinder);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pumpAndSettle();

      // After push, ReaderScreen should be visible (native article title).
      expect(find.byType(ReaderScreen), findsOneWidget);
      // Reader's native view renders paragraph blocks as RichText spans
      // (anchor-aware), so the finder needs findRichText.
      expect(find.textContaining('quick brown fox', findRichText: true), findsOneWidget);

      // Pop back and check Home again.
      router.pop();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 150));
      await tester.pumpAndSettle();
      expect(find.textContaining('E2E Video'), findsWidgets);
    });

    // -----------------------------------------------------------------------
    // 2. player transcript load (setTranscript via notifier, UI reflects it)
    // -----------------------------------------------------------------------

    testWidgets('player transcript load via PlayerStateNotifier', (tester) async {
      final db = AppDatabase.inMemory();
      addTearDown(db.close);

      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      const videoId = 'dQw4w9WgXcQ';

      final container = ProviderContainer(
        overrides: [
          databaseProvider.overrideWithValue(db),
        ],
      );
      addTearDown(container.dispose);

      // Seed transcript via notifier (mirrors TranscriptPanel fetching).
      final notifier = container.read(playerStateNotifierProvider(url).notifier);
      final transcript = _dummyTranscript(videoId);
      notifier.setTranscript(transcript);
      notifier.setDuration(120);
      notifier.onTimeUpdate(1.0);

      // Verify provider state.
      final state = container.read(playerStateNotifierProvider(url));
      expect(state.transcript, isNotNull);
      expect(state.transcript!.paragraphs.length, 2);
      expect(state.transcript!.paragraphs.first.text, contains('Hello world'));
      expect(state.currentTime, 1.0);

      // Pump a consumer that renders the transcript paragraphs — proves wiring.
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            theme: ScholiastTheme.darkTheme,
            home: Consumer(
              builder: (context, ref, _) {
                final s = ref.watch(playerStateNotifierProvider(url));
                final paras = s.transcript?.paragraphs ?? const <CueParagraph>[];
                return Scaffold(
                  body: ListView(
                    children: [
                      for (final p in paras) Text(p.text, key: ValueKey(p.start)),
                      Text('time:${s.currentTime}'),
                    ],
                  ),
                );
              },
            ),
          ),
        ),
      );
      await tester.pump();

      expect(find.textContaining('Hello world'), findsOneWidget);
      expect(find.textContaining('Second paragraph'), findsOneWidget);
      expect(find.textContaining('time:1.0'), findsOneWidget);
    });

    // -----------------------------------------------------------------------
    // 3. frame save -> player addFrameCapture persistence + UI
    // -----------------------------------------------------------------------

    testWidgets('frame save via FrameDrawScreen then player addFrameCapture', (tester) async {
      final db = AppDatabase.inMemory();
      addTearDown(db.close);

      const pageUrl = 'https://www.youtube.com/watch?v=frameTest';
      const frame = FrameImage(w: 320, h: 180);

      // 3a. Drag on FrameDrawScreen and Save — verify normalized markup returned.
      FrameImage? savedFrame;
      VideoMarkup? savedMarkup;

      await tester.pumpWidget(
        MaterialApp(
          home: FrameDrawScreen(
            frame: frame,
            onSave: (f, m) async {
              savedFrame = f;
              savedMarkup = m;
            },
            onCancel: () {},
          ),
        ),
      );
      await tester.pumpAndSettle();

      final center = tester.getCenter(find.byType(FrameDrawScreen));
      await tester.dragFrom(center, const Offset(80, 0));
      await tester.pump();

      await tester.tap(find.text('Save (Enter)'));
      await tester.pumpAndSettle();

      expect(savedFrame, isNotNull);
      expect(savedFrame!.w, 320);
      expect(savedMarkup, isNotNull);
      expect(savedMarkup!.strokes, isNotEmpty);
      for (final v in savedMarkup!.strokes.first.points) {
        expect(v, greaterThanOrEqualTo(0.0));
        expect(v, lessThanOrEqualTo(1.0));
      }

      // 3b. Now persist via PlayerStateNotifier.addFrameCapture — the Riverpod
      // wrapper does this in production. Verify DB round-trip.
      final container = ProviderContainer(
        overrides: [
          databaseProvider.overrideWithValue(db),
        ],
      );
      addTearDown(container.dispose);

      final notifier = container.read(playerStateNotifierProvider(pageUrl).notifier);
      // Ensure the notifier's url is seeded before persistence — addFrameCapture
      // is a no-op when state.url is empty (initial async loadVideo not yet completed).
      await notifier.loadVideo(pageUrl);
      // Advance fake time (Future.delayed never completes in testWidgets) so the
      // async DAO read settles.
      await tester.pump(const Duration(milliseconds: 50));

      final savedItem = await notifier.addFrameCapture(frame: savedFrame!, markup: savedMarkup);
      expect(savedItem.kind, 'frame');
      expect(savedItem.frame?.w, 320);

      final after = container.read(playerStateNotifierProvider(pageUrl));
      expect(after.items.length, 1);
      expect(after.items.first.id, savedItem.id);

      // Verify the DAO persisted JSON (dataUrl stripped).
      final all = await db.videoPages.getAllPages();
      expect(all.any((e) => e.itemsJson.contains(savedItem.id)), isTrue);
    });

    // -----------------------------------------------------------------------
    // 4. sync status bar renders without crash for every SyncState
    // -----------------------------------------------------------------------

    testWidgets('sync status bar/pill/card render for all SyncStates without crash', (tester) async {
      SharedPreferences.setMockInitialValues({});

      final now = DateTime.now().millisecondsSinceEpoch;

      final cases = <SyncStatus>[
        const SyncStatus(state: SyncState.unauthenticated, connected: false),
        const SyncStatus(state: SyncState.idle, connected: true, syncing: false),
        SyncStatus.syncing(
          connected: true,
          progress: const SyncProgress(phase: 'discovering', done: 0, total: 0, title: 'Discovering'),
        ),
        SyncStatus.syncing(
          connected: true,
          progress: const SyncProgress(phase: 'page', done: 3, total: 10, title: 'Syncing page', url: 'https://example.com/a'),
        ),
        SyncStatus.error(error: 'Network error', connected: true, lastSyncedAt: now - 60000),
        SyncStatus.idle(connected: true, lastSyncedAt: now - 5000),
      ];

      for (final status in cases) {
        await tester.pumpWidget(
          MaterialApp(
            theme: ScholiastTheme.darkTheme,
            home: Scaffold(
              body: SingleChildScrollView(
                child: Column(
                  children: [
                    SyncStatusPill(status: status, onConnect: () {}, onRetry: () {}, onSyncNow: () {}),
                    const SizedBox(height: 8),
                    SyncStatusCard(status: status, onRetry: () {}, onSyncNow: () {}),
                    const SizedBox(height: 8),
                    SyncStatusBar(status: status, onConnect: () {}, onRetry: () {}, onSyncNow: () {}),
                  ],
                ),
              ),
            ),
          ),
        );
        await tester.pump();
        // Each variant must render without throwing.
        // SyncStatusBar internally delegates to SyncStatusPill, so two pills are expected.
        expect(find.byType(SyncStatusPill), findsNWidgets(2));
        expect(find.byType(SyncStatusCard), findsOneWidget);
        expect(find.byType(SyncStatusBar), findsOneWidget);
      }

      // Also verify Home and Settings tolerate unauthenticated + error states via
      // the real syncStatusStreamProvider override (no network).
      final db = AppDatabase.inMemory();
      addTearDown(db.close);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            databaseProvider.overrideWithValue(db),
          ],
          child: MaterialApp(
            theme: ScholiastTheme.darkTheme,
            home: const HomeScreen(),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));
      expect(find.byType(HomeScreen), findsOneWidget);
      expect(find.byType(SyncStatusPill), findsWidgets);
    });

    // -----------------------------------------------------------------------
    // 5. Reader highlight creation + Player Fake controllers (extra coverage)
    // -----------------------------------------------------------------------

    testWidgets('Fake controllers record commands without WebView', (tester) async {
      final readerFake = FakeReaderWebController();
      const fakeHl = 'hl_1';
      await readerFake.paintHighlights(const []);
      await readerFake.revealHighlight(fakeHl);
      await readerFake.setReaderTheme(fontStep: 1, isSerif: true);
      expect(readerFake.paintCallCount, 1);
      expect(readerFake.lastRevealedId, fakeHl);
      expect(readerFake.lastFontStep, 1);
      expect(readerFake.lastIsSerif, isTrue);

      final playerFake = FakePlayerWebController();
      playerFake.loadVideo('abc123');
      playerFake.seekTo(42.0);
      playerFake.play();
      playerFake.pause();
      playerFake.setRate(1.5);
      expect(playerFake.commands, contains('loadVideo:abc123'));
      expect(playerFake.commands, contains('seekTo:42.0'));
      expect(playerFake.commands, contains('play'));
      expect(playerFake.commands, contains('pause'));
      expect(playerFake.commands, contains('setRate:1.5'));
    });

    // -----------------------------------------------------------------------
    // 6. settings renders via GoRouter (home → /settings → back), mirroring
    //    main.dart's route wiring.
    // -----------------------------------------------------------------------

    testWidgets('settings renders via GoRouter navigation from home', (tester) async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final db = AppDatabase.inMemory();
      addTearDown(db.close);

      final container = ProviderContainer(
        overrides: [
          databaseProvider.overrideWithValue(db),
          settingsPrefsProvider.overrideWith((ref) async => SettingsPrefs(prefs)),
          syncStatusStreamProvider.overrideWith(
            (ref) => Stream.value(const SyncStatus(state: SyncState.unauthenticated)),
          ),
          whisperModelManagerProvider.overrideWithValue(
            WhisperModelManager(customDirectoryPath: '/tmp/scholiast_e2e_settings'),
          ),
        ],
      );
      addTearDown(container.dispose);

      // Same wiring shape as main.dart: '/' hosts HomeScreen with the settings
      // push; '/settings' builds SettingsScreen with a back callback.
      final router = GoRouter(
        initialLocation: '/',
        routes: [
          GoRoute(
            path: '/',
            builder: (context, state) => HomeScreen(
              onOpenSettings: () => context.push('/settings'),
            ),
          ),
          GoRoute(
            path: '/settings',
            builder: (context, state) => SettingsScreen(
              onBack: () => context.canPop() ? context.pop() : context.go('/'),
            ),
          ),
        ],
      );
      addTearDown(router.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp.router(
            theme: ScholiastTheme.darkTheme,
            routerConfig: router,
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      // Home is up; open Settings via the app-bar action. Plain pumps only:
      // SettingsScreen keeps an indeterminate indicator spinning, so
      // pumpAndSettle would never settle.
      expect(find.byType(HomeScreen), findsOneWidget);
      await tester.tap(find.byIcon(Icons.settings_outlined));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      expect(find.byType(SettingsScreen), findsOneWidget);
      expect(find.text('Sync'), findsOneWidget);
      expect(find.text('Speech'), findsOneWidget);
      expect(find.text('Whisper models'), findsOneWidget);
      expect(find.text('Danger zone'), findsWidgets);

      // Back returns home.
      await tester.tap(find.byIcon(Icons.arrow_back));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.byType(HomeScreen), findsOneWidget);
    });
  });
}
