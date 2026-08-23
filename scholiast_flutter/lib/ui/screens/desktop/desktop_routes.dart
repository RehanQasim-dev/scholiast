import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../screens/home/home_screen.dart';
import '../../screens/player/player_screen.dart';
import '../../screens/reader/reader_screen.dart';
import '../../screens/settings/settings_screen.dart';
import 'desktop_shell.dart';

/// GoRouter configuration for the desktop shell.
///
/// **Router wiring needed (main.dart is still default template — do NOT edit):**
///
/// Replace `lib/main.dart` with:
///
/// ```dart
/// import 'package:flutter/material.dart';
/// import 'package:flutter_riverpod/flutter_riverpod.dart';
/// import 'core/database/database.dart';
/// import 'core/providers/core_providers.dart';
/// import 'core/theme/scholiast_theme.dart';
/// import 'ui/screens/desktop/desktop_routes.dart';
///
/// Future<void> main() async {
///   WidgetsFlutterBinding.ensureInitialized();
///   final db = await AppDatabase.openDefault();
///   runApp(ProviderScope(
///     overrides: [databaseProvider.overrideWithValue(db)],
///     child: const ScholiastApp(),
///   ));
/// }
///
/// class ScholiastApp extends StatelessWidget {
///   const ScholiastApp({super.key});
///   @override
///   Widget build(BuildContext context) {
///     return MaterialApp.router(
///       title: 'Scholiast',
///       theme: ScholiastTheme.darkTheme,
///       routerConfig: desktopRouter,
///     );
///   }
/// }
/// ```
///
/// Or to keep the current `MyApp` for tests, add a flavor flag.
GoRouter buildDesktopRouter({String initialLocation = '/home'}) {
  return GoRouter(
    initialLocation: initialLocation,
    routes: [
      ShellRoute(
        builder: (context, state, child) => DesktopShell(
          location: state.uri.toString(),
          child: child,
        ),
        routes: [
          GoRoute(
            path: '/home',
            pageBuilder: (context, state) => const NoTransitionPage(
              child: HomeScreen(),
            ),
          ),
          GoRoute(
            path: '/',
            redirect: (_, _) => '/home',
          ),
          GoRoute(
            path: '/reader',
            pageBuilder: (context, state) {
              final url = state.uri.queryParameters['url'] ?? '';
              return NoTransitionPage(child: ReaderScreen(url: url));
            },
          ),
          GoRoute(
            path: '/player',
            pageBuilder: (context, state) {
              final qp = state.uri.queryParameters;
              final videoId = qp['videoId'] ??
                  qp['v'] ??
                  _extractVideoId(qp['url'] ?? '') ??
                  '';
              return NoTransitionPage(child: PlayerScreen(videoId: videoId));
            },
          ),
          GoRoute(
            path: '/settings',
            pageBuilder: (context, state) => const NoTransitionPage(
              child: SettingsScreen(),
            ),
          ),
        ],
      ),
    ],
    errorBuilder: (context, state) => Scaffold(
      backgroundColor: const Color(0xFF0B0D14),
      body: Center(
        child: Text(
          'Route not found: ${state.uri}',
          style: const TextStyle(color: Color(0xFF9AA0A6)),
        ),
      ),
    ),
  );
}

/// Default singleton router (tests can build their own via [buildDesktopRouter]).
final GoRouter desktopRouter = buildDesktopRouter();

String? _extractVideoId(String url) {
  if (url.isEmpty) return null;
  try {
    final uri = Uri.parse(url);
    if (uri.queryParameters.containsKey('v')) return uri.queryParameters['v'];
    if (uri.host.contains('youtu.be') && uri.pathSegments.isNotEmpty) {
      return uri.pathSegments.first;
    }
  } catch (_) {}
  return null;
}
