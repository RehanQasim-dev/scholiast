import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:scholiast_flutter/core/database/database.dart';
import 'package:scholiast_flutter/core/providers/core_providers.dart';
import 'package:scholiast_flutter/core/theme/scholiast_theme.dart';
import 'package:scholiast_flutter/features/player/player_state_notifier.dart';
import 'package:scholiast_flutter/ui/screens/player/player_chrome.dart';
import 'package:scholiast_flutter/ui/screens/player/player_screen.dart';
import 'package:scholiast_flutter/ui/screens/player/player_web_controller.dart';

void main() {
  late AppDatabase db;

  setUp(() {
    db = AppDatabase.inMemory();
  });

  tearDown(() {
    db.close();
  });

  Widget wrap(Widget child, {PlayerWebController? fake}) {
    return ProviderScope(
      overrides: [
        databaseProvider.overrideWithValue(db),
      ],
      child: MaterialApp(
        theme: ScholiastTheme.darkTheme,
        home: child,
      ),
    );
  }

  group('PlayerScreen', () {
    testWidgets('renders with videoId and shows Notes/Transcript tabs',
        (tester) async {
      final fake = FakePlayerWebController();
      await tester.pumpWidget(wrap(
        PlayerScreen(videoId: 'dQw4w9WgXcQ', controllerOverride: fake),
      ));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.text('Notes'), findsOneWidget);
      expect(find.text('Transcript'), findsOneWidget);
    });

    testWidgets('PlayerChrome shows M:SS and play/pause', (tester) async {
      const state = PlayerState(
        videoId: 'abc123',
        currentTime: 65,
        duration: 120,
        isPlaying: true,
      );
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: ScholiastTheme.darkTheme,
            home: Scaffold(
              body: PlayerChrome(state: state, controller: FakePlayerWebController()),
            ),
          ),
        ),
      );
      await tester.pump();

      expect(find.text('1:05'), findsOneWidget);
      expect(find.text('2:00'), findsOneWidget);
      expect(find.byIcon(Icons.pause), findsOneWidget);
    });

    testWidgets('FakePlayerWebController records commands', (tester) async {
      final fake = FakePlayerWebController();
      fake.loadVideo('test123');
      fake.seekTo(42.5);
      fake.play();
      fake.pause();
      fake.setRate(1.5);
      fake.setCaptions(true);

      expect(fake.commands, contains('loadVideo:test123'));
      expect(fake.commands, contains('seekTo:42.5'));
      expect(fake.commands, contains('play'));
      expect(fake.commands, contains('pause'));
      expect(fake.commands, contains('setRate:1.5'));
      expect(fake.commands, contains('setCaptions:true'));
    });

    test('formatMss formats correctly', () {
      expect(formatMss(0), '0:00');
      expect(formatMss(65), '1:05');
      expect(formatMss(3661), '1:01:01');
      expect(formatMss(3600), '1:00:00');
    });
  });

  group('PlayerStateNotifier via ProviderScope', () {
    test('loadVideo and onTimeUpdate via container', () async {
      final container = ProviderContainer(
        overrides: [
          databaseProvider.overrideWithValue(db),
        ],
      );
      addTearDown(container.dispose);

      const url = 'https://www.youtube.com/watch?v=xyz987';
      final notifier = container.read(playerStateNotifierProvider(url).notifier);
      // Initially empty.
      expect(container.read(playerStateNotifierProvider(url)).videoId, '');

      notifier.setDuration(100);
      notifier.onTimeUpdate(42.0);

      final state = container.read(playerStateNotifierProvider(url));
      expect(state.duration, 100);
      expect(state.currentTime, 42.0);

      notifier.setPlaying(true);
      expect(container.read(playerStateNotifierProvider(url)).isPlaying, isTrue);

      notifier.seekTo(10);
      expect(container.read(playerStateNotifierProvider(url)).currentTime, 10);
    });
  });
}
