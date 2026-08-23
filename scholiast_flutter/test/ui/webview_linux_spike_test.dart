import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:scholiast_flutter/core/database/database.dart';
import 'package:scholiast_flutter/core/providers/core_providers.dart';
import 'package:scholiast_flutter/core/theme/scholiast_theme.dart';
import 'package:scholiast_flutter/ui/screens/player/player_screen.dart';
import 'package:scholiast_flutter/ui/screens/player/player_web_controller.dart';
import 'package:scholiast_flutter/ui/screens/reader/reader_web_controller.dart';
import 'package:scholiast_flutter/ui/screens/reader/reader_web_view_host.dart';

/// Spike verification for Option A: flutter_inappwebview 6.2.x-beta +
/// flutter_inappwebview_linux (WPE WebKit) serving Android + Linux from ONE
/// codebase.
///
/// A real WPE view cannot run inside `flutter test` (no GTK main loop, no
/// DMA-BUF textures), so these tests verify:
///   1. The bridge CONTRACT stays intact on 6.2: every `callHandler(...)`
///      name emitted by the JS assets is registered on the Dart side.
///   2. Both hosts degrade GRACEFULLY on the Linux target: no crash, the
///      fake-controller placeholder path is used.
/// Native-side feature parity of flutter_inappwebview_linux 0.1.0-beta.1 is
/// reported separately (pub-cache source inspection) in
/// flutter-tasks/task-16-desktop-linux-adaptation/LOG.md.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final repoRoot = Directory.current.path;

  /// Extract literal callHandler names from a JS/HTML source string.
  Set<String> extractedHandlerNames(String source) {
    final names = <String>{};
    final callPattern = RegExp(r"""callHandler\(\s*['"]([\w]+)['"]""");
    for (final m in callPattern.allMatches(source)) {
      // Skip the local helper definition site(s): `callHandler(name` etc.
      names.add(m.group(1)!);
    }
    return names;
  }

  group('bridge contract on 6.2.x-beta', () {
    test('player.html emits exactly the handlers PlayerWebView registers',
        () async {
      final html =
          await File('$repoRoot/assets/player.html').readAsString();
      final emitted = extractedHandlerNames(html);

      const registered = <String>{
        'onPlayerReady',
        'onStateChange',
        'onError',
        'onTimeUpdate',
        'onDuration',
        'onTitle',
        'onCaptionsAvailable',
        'onCaptureResult',
      };

      expect(
        emitted.difference(registered),
        isEmpty,
        reason:
            'player.html calls a handler PlayerWebView does not register — '
            'the JS→Dart bridge would silently drop events.',
      );
      expect(
        registered.difference(emitted),
        isEmpty,
        reason: 'Registered handler never emitted by player.html.',
      );
    });

    test('android-reader.js handlers ⊆ ReaderWebViewHost registrations',
        () async {
      final js = await File(
              '$repoRoot/assets/wwwreader/android-reader.js')
          .readAsString();
      final emitted = extractedHandlerNames(js);

      const registered = <String>{
        'onReady',
        'onHighlightCreated',
        'onHighlightUpdated',
        'onHighlightDeleted',
        'onLinkTap',
        'onScrollPct',
        'onSelectionState',
      };

      expect(emitted.difference(registered), isEmpty,
          reason: 'Reader JS emits an unregistered handler name.');
    });

    test('assets still use window.flutter_inappwebview.callHandler', () async {
      final html =
          await File('$repoRoot/assets/player.html').readAsString();
      final js = await File(
              '$repoRoot/assets/wwwreader/android-reader.js')
          .readAsString();
      expect(html.contains('window.flutter_inappwebview'), isTrue);
      expect(js.contains('window.flutter_inappwebview'), isTrue);
    });
  });

  group('graceful degradation on Linux target (headless)', () {
    testWidgets('ReaderWebViewHost + FakeReaderWebController renders '
        'placeholder instead of launching a WPE view', (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.linux;
      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: Scaffold(
            body: ReaderWebViewHost(
              url: 'https://example.com/article',
              controller: FakeReaderWebController(),
            ),
          ),
        ),
      );
      await tester.pump();
      debugDefaultTargetPlatformOverride = null;

      expect(tester.takeException(), isNull);
      expect(find.text('WebView preview unavailable on Linux'),
          findsOneWidget);
      expect(find.byType(ReaderWebViewHost), findsOneWidget);
    });

    testWidgets('PlayerScreen with controllerOverride never builds a '
        'real WebView under Linux target', (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.linux;

      late AppDatabase db;
      db = AppDatabase.inMemory();
      addTearDown(db.close);

      final fake = FakePlayerWebController();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [databaseProvider.overrideWithValue(db)],
          child: MaterialApp(
            theme: ScholiastTheme.darkTheme,
            home: PlayerScreen(
              videoId: 'dQw4w9WgXcQ',
              controllerOverride: fake,
            ),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      debugDefaultTargetPlatformOverride = null;

      expect(tester.takeException(), isNull);
      // Chrome rendered through the non-WebView path.
      expect(find.text('Notes'), findsOneWidget);
      expect(find.text('Transcript'), findsOneWidget);
    });
  });
}
