import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/algorithms/normalize.dart';
import 'core/database/database.dart';
import 'core/models/video_item.dart';
import 'core/providers/core_providers.dart';
import 'core/theme/scholiast_theme.dart';
import 'ui/screens/desktop/desktop_shell.dart';
import 'ui/screens/frame/frame_draw_screen.dart';
import 'ui/screens/home/home_screen.dart';
import 'ui/screens/player/player_screen.dart';
import 'ui/screens/reader/reader_screen.dart';
import 'ui/screens/settings/settings_screen.dart';

/// Async entry — opens the persisted SQLite database and injects it via
/// [databaseProvider] so every notifier/DAO in the provider graph resolves.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final db = await AppDatabase.open();
  runApp(
    ProviderScope(
      overrides: [
        databaseProvider.overrideWithValue(db),
      ],
      child: ScholiastApp(db: db),
    ),
  );
}

/// Root widget — owns the [GoRouter] and applies the dark [ScholiastTheme].
class ScholiastApp extends ConsumerStatefulWidget {
  final AppDatabase db;

  const ScholiastApp({super.key, required this.db});

  @override
  ConsumerState<ScholiastApp> createState() => _ScholiastAppState();
}

class _ScholiastAppState extends ConsumerState<ScholiastApp> {
  late final GoRouter _router;

  @override
  void initState() {
    super.initState();
    _router = _buildRouter();
  }

  GoRouter _buildRouter() {
    return GoRouter(
      initialLocation: '/',
      routes: [
        ShellRoute(
          builder: (context, state, child) => DesktopShell(
            location: state.uri.toString(),
            child: child,
          ),
          routes: [
            GoRoute(
              path: '/',
              name: 'home',
              builder: (context, state) => HomeScreen(
                onOpenPage: (page) {
                  final encoded = Uri.encodeComponent(page.url);
                  final isVideo = (page.videoId != null && page.videoId!.isNotEmpty) ||
                      page.url.contains('youtube.com') ||
                      page.url.contains('youtu.be');
                  if (isVideo) {
                    context.push('/player?url=$encoded');
                  } else {
                    context.push('/reader?url=$encoded');
                  }
                },
                onOpenSettings: () => context.push('/settings'),
              ),
            ),
            GoRoute(
              path: '/home',
              redirect: (context, state) => '/',
            ),
            GoRoute(
              path: '/reader',
              name: 'reader',
              builder: (context, state) {
                final raw = state.uri.queryParameters['url'];
                final url = raw == null || raw.isEmpty ? '' : Uri.decodeComponent(raw);
                if (url.isEmpty) {
                  return _MissingParamScaffold(
                    title: 'Reader',
                    message: 'Missing ?url= query parameter.',
                    onBack: () => context.go('/'),
                  );
                }
                return ReaderScreen(url: url);
              },
            ),
            GoRoute(
              path: '/player',
              name: 'player',
              builder: (context, state) {
                final rawUrl = state.uri.queryParameters['url'];
                final rawVideoId = state.uri.queryParameters['videoId'];
                String videoId = '';
                String? title;

                if (rawVideoId != null && rawVideoId.isNotEmpty) {
                  videoId = rawVideoId;
                } else if (rawUrl != null && rawUrl.isNotEmpty) {
                  final url = Uri.decodeComponent(rawUrl);
                  videoId = extractVideoId(url) ?? _extractVideoId(url) ?? '';
                  title = state.uri.queryParameters['title'];
                  if (videoId.isEmpty) {
                    return _MissingParamScaffold(
                      title: 'Player',
                      message: 'Could not extract videoId from url: $url',
                      onBack: () => context.go('/'),
                    );
                  }
                } else {
                  return _MissingParamScaffold(
                    title: 'Player',
                    message: 'Missing ?url= or ?videoId= query parameter.',
                    onBack: () => context.go('/'),
                  );
                }

                return PlayerScreen(
                  videoId: videoId,
                  title: title,
                  onBack: () => context.pop(),
                );
              },
            ),
            GoRoute(
              path: '/frame',
              name: 'frame',
              builder: (context, state) {
                final rawUrl = state.uri.queryParameters['url'];
                final id = state.uri.queryParameters['id'];
                final url = rawUrl == null || rawUrl.isEmpty ? '' : Uri.decodeComponent(rawUrl);
                if (url.isEmpty) {
                  return _MissingParamScaffold(
                    title: 'Frame',
                    message: 'Missing ?url= query parameter.',
                    onBack: () => context.go('/'),
                  );
                }
                const defaultFrame = FrameImage(w: 1280, h: 720);
                if (id != null && id.isNotEmpty) {
                  // id present — Riverpod wrapper will resolve existing markup via DAO.
                }
                return Scaffold(
                  body: FrameDrawScreenRiverpod(
                    pageUrl: url,
                    frame: defaultFrame,
                    onDone: () {
                      if (context.canPop()) {
                        context.pop();
                      } else {
                        context.go('/');
                      }
                    },
                  ),
                );
              },
            ),
            GoRoute(
              path: '/settings',
              name: 'settings',
              builder: (context, state) => SettingsScreen(
                onBack: () => context.canPop() ? context.pop() : context.go('/'),
              ),
            ),
          ],
        ),
      ],
      errorBuilder: (context, state) => _MissingParamScaffold(
        title: 'Not found',
        message: 'No route for ${state.uri}',
        onBack: () => context.go('/'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Scholiast',
      theme: ScholiastTheme.darkTheme,
      routerConfig: _router,
      debugShowCheckedModeBanner: false,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

String? _extractVideoId(String url) {
  try {
    final uri = Uri.parse(url);
    if (uri.queryParameters.containsKey('v')) {
      return uri.queryParameters['v'];
    }
    if (uri.host.contains('youtu.be')) {
      final seg = uri.pathSegments;
      if (seg.isNotEmpty) return seg.first;
    }
    final segments = uri.pathSegments;
    for (var i = 0; i < segments.length; i++) {
      if (segments[i] == 'shorts' || segments[i] == 'embed' || segments[i] == 'live') {
        if (i + 1 < segments.length) return segments[i + 1];
      }
    }
  } catch (_) {}
  return null;
}

class _MissingParamScaffold extends StatelessWidget {
  final String title;
  final String message;
  final VoidCallback onBack;

  const _MissingParamScaffold({
    required this.title,
    required this.message,
    required this.onBack,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: onBack,
        ),
        title: Text(title),
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.link_off, size: 40, color: Colors.grey),
              const SizedBox(height: 12),
              Text(message, textAlign: TextAlign.center),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: onBack,
                child: const Text('Go home'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
