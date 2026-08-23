import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_colors.dart';
import '../../layout/desktop_scaffold.dart';
import '../../layout/desktop_sidebar.dart';
import '../home/home_screen.dart';
import '../player/player_screen.dart';
import '../reader/reader_screen.dart';
import '../settings/settings_screen.dart';

/// The top-level desktop shell that hosts the four primary destinations.
///
/// Route mapping (go_router):
/// - `/` or `/home` → Home
/// - `/reader?url=` → Reader (query param `url` required)
/// - `/player?videoId=` or `/player?url=` → Player
/// - `/settings` → Settings
///
/// The shell owns the selected index and delegates content via [GoRouter].
/// For embedding without go_router, use [DesktopShellView] directly.
class DesktopShell extends ConsumerStatefulWidget {
  final Widget child;
  final String location;

  const DesktopShell({
    super.key,
    required this.child,
    required this.location,
  });

  @override
  ConsumerState<DesktopShell> createState() => _DesktopShellState();
}

class _DesktopShellState extends ConsumerState<DesktopShell> {
  int _indexForLocation(String loc) {
    if (loc.startsWith('/settings')) return 3;
    if (loc.startsWith('/player')) return 2;
    if (loc.startsWith('/reader')) return 1;
    return 0;
  }

  void _onDestinationSelected(int index) {
    final dest = DesktopDestination.values[index];
    switch (dest) {
      case DesktopDestination.home:
        context.go('/home');
        break;
      case DesktopDestination.reader:
        // Reader requires a URL — if none in history, go home.
        // Callers should use context.go('/reader?url=...') directly.
        context.go('/home');
        break;
      case DesktopDestination.player:
        context.go('/home');
        break;
      case DesktopDestination.settings:
        context.go('/settings');
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    final selected = _indexForLocation(widget.location);
    return DesktopScaffold(
      selectedIndex: selected,
      onDestinationSelected: _onDestinationSelected,
      onNavigateHome: () => context.go('/home'),
      onNavigatePlayer: () {
        // No-op if no video context; real shortcut handled per-screen.
        if (selected != 2) context.go('/home');
      },
      onEscape: () {
        if (Navigator.canPop(context)) Navigator.pop(context);
      },
      child: widget.child,
    );
  }
}

/// Embeddable desktop view that switches content by index without go_router.
///
/// Useful for tests and for hosts that manage navigation themselves.
class DesktopShellView extends StatefulWidget {
  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;
  final String? readerUrl;
  final String? playerVideoId;
  final VoidCallback? onTogglePlayPause;
  final VoidCallback? onUndo;
  final VoidCallback? onRedo;
  final VoidCallback? onEscape;

  const DesktopShellView({
    super.key,
    required this.selectedIndex,
    required this.onDestinationSelected,
    this.readerUrl,
    this.playerVideoId,
    this.onTogglePlayPause,
    this.onUndo,
    this.onRedo,
    this.onEscape,
  });

  @override
  State<DesktopShellView> createState() => _DesktopShellViewState();
}

class _DesktopShellViewState extends State<DesktopShellView> {
  @override
  Widget build(BuildContext context) {
    final content = _buildContent();
    return DesktopScaffold(
      selectedIndex: widget.selectedIndex,
      onDestinationSelected: widget.onDestinationSelected,
      onTogglePlayPause: widget.onTogglePlayPause,
      onUndo: widget.onUndo,
      onRedo: widget.onRedo,
      onEscape: widget.onEscape,
      child: content,
    );
  }

  Widget _buildContent() {
    final dest = DesktopDestination.values[widget.selectedIndex.clamp(
      0,
      DesktopDestination.values.length - 1,
    )];
    switch (dest) {
      case DesktopDestination.home:
        return HomeScreen(
          onOpenSettings: () => widget.onDestinationSelected(3),
        );
      case DesktopDestination.reader:
        final url = widget.readerUrl ?? 'https://example.com/';
        return ReaderScreen(url: url, forceNativeView: true);
      case DesktopDestination.player:
        final vid = widget.playerVideoId ?? 'dQw4w9WgXcQ';
        return PlayerScreen(videoId: vid);
      case DesktopDestination.settings:
        return SettingsScreen(
          onBack: () => widget.onDestinationSelected(0),
        );
    }
  }
}

/// Linux window chrome — thin title bar shown when the OS doesn't draw one.
///
/// Uses AppColors.background (#0B0D14) and a hairline divider.
class LinuxTitleBar extends StatelessWidget implements PreferredSizeWidget {
  final String title;
  final List<Widget>? actions;
  final Widget? leading;

  const LinuxTitleBar({
    super.key,
    this.title = 'Scholiast',
    this.actions,
    this.leading,
  });

  @override
  Size get preferredSize => const Size.fromHeight(40);

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 40,
      color: AppColors.background,
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Row(
        children: [
          if (leading != null) leading! else const SizedBox(width: 8),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              title,
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (actions != null) ...actions!,
        ],
      ),
    );
  }
}
