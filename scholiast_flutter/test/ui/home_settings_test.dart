import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:scholiast_flutter/core/database/database.dart';
import 'package:scholiast_flutter/core/database/entities/video_page_entity.dart';
import 'package:scholiast_flutter/core/providers/core_providers.dart';
import 'package:scholiast_flutter/core/stt/stt_models.dart';
import 'package:scholiast_flutter/core/stt/whisper_model_manager.dart';
import 'package:scholiast_flutter/core/sync/sync_models.dart';
import 'package:scholiast_flutter/core/theme/scholiast_theme.dart';
import 'package:scholiast_flutter/features/home/home_providers.dart';
import 'package:scholiast_flutter/features/settings/settings_prefs.dart';
import 'package:scholiast_flutter/features/sync/sync_providers.dart';
import 'package:scholiast_flutter/ui/screens/home/home_screen.dart';
import 'package:scholiast_flutter/ui/screens/settings/settings_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('SettingsPrefs round-trip with SharedPreferences mock', () {
    test('fontStep, serifDefault, speechLanguage, transcriber persist', () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final sp = SettingsPrefs(prefs);

      expect(sp.fontStep, 1);
      expect(sp.serifDefault, false);
      expect(sp.speechLanguage, isNull);
      expect(sp.activeWhisperModelId, isNull);

      await sp.setFontStep(3);
      await sp.setSerifDefault(true);
      await sp.setSpeechLanguage('ja');
      await sp.setPreferredTranscriber(SttProvider.groq);

      expect(sp.fontStep, 3);
      expect(sp.serifDefault, true);
      expect(sp.speechLanguage, 'ja');
      expect(sp.preferredTranscriber, SttProvider.groq);

      // Clamping
      await sp.setFontStep(99);
      expect(sp.fontStep, 4);
      await sp.setFontStep(-5);
      expect(sp.fontStep, 0);
    });

    test('settingsPrefsProvider resolves via mock injection', () async {
      SharedPreferences.setMockInitialValues({
        'font_step': 2,
        'serif': true,
        'speech_language': 'fr',
      });
      final prefs = await SharedPreferences.getInstance();
      final sp = SettingsPrefs(prefs);
      expect(sp.fontStep, 2);
      expect(sp.serifDefault, true);
      expect(sp.speechLanguage, 'fr');
    });
  });

  group('HomeScreen filter chips & navigation', () {
    late AppDatabase db;

    setUp(() {
      db = AppDatabase.inMemory();
    });

    tearDown(() {
      db.close();
    });

    Future<void> seedPages() async {
      const now = 1700000000000;
      await db.videoPages.upsertPage(const VideoPageEntity(
        urlHash: 'hash-video',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        videoId: 'dQw4w9WgXcQ',
        title: 'My Video | Site',
        itemsJson: '[]',
        updatedAt: now,
        highlightsJson: '[]',
      ));
      await db.videoPages.upsertPage(const VideoPageEntity(
        urlHash: 'hash-article',
        url: 'https://example.com/article',
        title: 'My Article | Site',
        itemsJson: '[]',
        updatedAt: now - 1000,
        highlightsJson: '[{"id":"hl1"}]',
      ));
    }

    testWidgets('filter chip behavior updates homeFilterProvider', (tester) async {
      await seedPages();

      final container = ProviderContainer(
        overrides: [
          databaseProvider.overrideWithValue(db),
          syncStatusStreamProvider.overrideWith(
            (ref) => Stream.value(const SyncStatus(state: SyncState.unauthenticated)),
          ),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            theme: ScholiastTheme.darkTheme,
            home: const HomeScreen(),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.text('All'), findsOneWidget);
      expect(find.text('Videos'), findsOneWidget);

      await tester.tap(find.text('Videos'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(container.read(homeFilterProvider), HomeFilter.videos);

      await tester.tap(find.text('Articles'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(container.read(homeFilterProvider), HomeFilter.articles);
    });

    testWidgets('search field bound to homeSearchQueryProvider', (tester) async {
      await seedPages();

      final container = ProviderContainer(
        overrides: [
          databaseProvider.overrideWithValue(db),
          syncStatusStreamProvider.overrideWith(
            (ref) => Stream.value(const SyncStatus(state: SyncState.unauthenticated)),
          ),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            theme: ScholiastTheme.darkTheme,
            home: const HomeScreen(),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      final field = find.byType(TextField);
      expect(field, findsOneWidget);

      await tester.enterText(field, 'youtube');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(container.read(homeSearchQueryProvider), 'youtube');
    });

    testWidgets('cleanTitle drops trailing Site tail', (tester) async {
      expect(cleanTitle('My Page | Site'), 'My Page');
      expect(cleanTitle('No Tail'), 'No Tail');
      expect(cleanTitle(null), isNull);
    });
  });

  group('SettingsScreen renders sync section', () {
    testWidgets('renders Sync, Speech, Whisper, Danger zone sections', (tester) async {
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
            // Use temp dir to avoid path_provider in tests.
            WhisperModelManager(customDirectoryPath: '/tmp/scholiast_test_${db.hashCode}'),
          ),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            theme: ScholiastTheme.darkTheme,
            home: const SettingsScreen(),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.text('Sync'), findsOneWidget);
      expect(find.text('Speech'), findsOneWidget);
      expect(find.text('Whisper models'), findsOneWidget);
      expect(find.text('Danger zone'), findsWidgets);
      expect(find.textContaining('Google Drive'), findsWidgets);
      expect(find.text('Delete local data…'), findsOneWidget);
      expect(find.text('Delete all data on Google Drive…'), findsOneWidget);
    });
  });
}
