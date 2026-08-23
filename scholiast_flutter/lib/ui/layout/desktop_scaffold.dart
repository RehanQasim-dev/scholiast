import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import 'desktop_breakpoints.dart';
import 'desktop_sidebar.dart';
import 'keyboard_shortcuts.dart';

/// Responsive desktop scaffold that adapts between a [NavigationRail]
/// (≥900px) and a bottom [NavigationBar] (<900px).
///
/// Keyboard shortcuts are wired via [DesktopShortcuts] so that
/// Ctrl+H / Ctrl+P / Space / Ctrl+Z / Ctrl+Shift+Z / Esc work
/// without each screen reimplementing them.
class DesktopScaffold extends StatelessWidget {
  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;
  final Widget child;

  /// Optional bottom sheet / secondary panel (e.g. thread sheet).
  final Widget? sidePanel;

  /// Whether to extend the rail (label + icon) on very wide windows.
  final bool extendedRail;

  // Keyboard shortcut callbacks — forwarded to [DesktopShortcuts].
  final VoidCallback? onNavigateHome;
  final VoidCallback? onNavigatePlayer;
  final VoidCallback? onTogglePlayPause;
  final VoidCallback? onUndo;
  final VoidCallback? onRedo;
  final VoidCallback? onEscape;

  final FocusNode? focusNode;

  const DesktopScaffold({
    super.key,
    required this.selectedIndex,
    required this.onDestinationSelected,
    required this.child,
    this.sidePanel,
    this.extendedRail = false,
    this.onNavigateHome,
    this.onNavigatePlayer,
    this.onTogglePlayPause,
    this.onUndo,
    this.onRedo,
    this.onEscape,
    this.focusNode,
  });

  @override
  Widget build(BuildContext context) {
    return DesktopShortcuts(
      focusNode: focusNode,
      onNavigateHome: onNavigateHome ?? () => onDestinationSelected(0),
      onNavigatePlayer: onNavigatePlayer ?? () => onDestinationSelected(2),
      onTogglePlayPause: onTogglePlayPause,
      onUndo: onUndo,
      onRedo: onRedo,
      onEscape: onEscape,
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: LayoutBuilder(
          builder: (context, constraints) {
            final useRail =
                constraints.maxWidth >= DesktopBreakpoints.medium;
            final content = _buildContent(context, constraints);

            if (useRail) {
              return Row(
                children: [
                  DesktopSidebar(
                    selectedIndex: selectedIndex,
                    onDestinationSelected: onDestinationSelected,
                    extended: extendedRail &&
                        constraints.maxWidth >= DesktopBreakpoints.expanded,
                  ),
                  const VerticalDivider(
                    width: 1,
                    thickness: 1,
                    color: AppColors.hairline,
                  ),
                  Expanded(child: content),
                ],
              );
            }

            return Column(
              children: [
                Expanded(child: content),
                DesktopBottomNav(
                  selectedIndex: selectedIndex,
                  onDestinationSelected: onDestinationSelected,
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _buildContent(BuildContext context, BoxConstraints constraints) {
    final panel = sidePanel;
    // Wide: optional side panel with guaranteed 320dp minimum.
    if (panel != null &&
        constraints.maxWidth >= DesktopBreakpoints.expanded) {
      final totalW = constraints.maxWidth;
      // Subtract rail width (~72 or ~200 extended) approximated via
      // remaining width seen by this Expanded — we compute panel share
      // from total window already, so just clamp.
      final panelW = DesktopBreakpoints.panelWidth(totalW);
      return Row(
        children: [
          Expanded(child: child),
          Container(width: 1, color: AppColors.hairline),
          SizedBox(width: panelW, child: panel),
        ],
      );
    }
    // Stack panel below content on compact/medium when present.
    if (panel != null) {
      return Column(
        children: [
          Expanded(child: child),
          Container(height: 1, color: AppColors.hairline),
          SizedBox(height: 320, child: panel),
        ],
      );
    }
    return child;
  }
}

/// A sliver-aware variant for screens that own their own Scaffold
/// (e.g. HomeScreen). Wraps just the navigation chrome, not a nested Scaffold.
class DesktopNavShell extends StatelessWidget {
  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;
  final Widget child;
  final VoidCallback? onNavigateHome;
  final VoidCallback? onNavigatePlayer;
  final VoidCallback? onTogglePlayPause;
  final VoidCallback? onUndo;
  final VoidCallback? onRedo;
  final VoidCallback? onEscape;

  const DesktopNavShell({
    super.key,
    required this.selectedIndex,
    required this.onDestinationSelected,
    required this.child,
    this.onNavigateHome,
    this.onNavigatePlayer,
    this.onTogglePlayPause,
    this.onUndo,
    this.onRedo,
    this.onEscape,
  });

  @override
  Widget build(BuildContext context) {
    return DesktopShortcuts(
      onNavigateHome: onNavigateHome ?? () => onDestinationSelected(0),
      onNavigatePlayer: onNavigatePlayer ?? () => onDestinationSelected(2),
      onTogglePlayPause: onTogglePlayPause,
      onUndo: onUndo,
      onRedo: onRedo,
      onEscape: onEscape,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final useRail =
              constraints.maxWidth >= DesktopBreakpoints.medium;
          if (useRail) {
            return Row(
              children: [
                DesktopSidebar(
                  selectedIndex: selectedIndex,
                  onDestinationSelected: onDestinationSelected,
                ),
                const VerticalDivider(
                  width: 1,
                  thickness: 1,
                  color: AppColors.hairline,
                ),
                Expanded(child: child),
              ],
            );
          }
          return Column(
            children: [
              Expanded(child: child),
              DesktopBottomNav(
                selectedIndex: selectedIndex,
                onDestinationSelected: onDestinationSelected,
              ),
            ],
          );
        },
      ),
    );
  }
}
