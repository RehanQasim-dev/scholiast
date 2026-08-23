import 'package:flutter/widgets.dart';

/// Responsive breakpoints for the Scholiast desktop adaptation.
///
/// Thresholds mirror the dashboard's 736px reading column + 264px rail
/// and the existing 900px grid switch in [HomeScreen].
abstract final class DesktopBreakpoints {
  /// Below this width the layout is considered narrow / mobile.
  static const double compact = 600;

  /// Sidebar collapses to bottom-nav / drawer below this width.
  /// Matches HomeScreen's 900px grid switch and PlayerScreen's panel logic.
  static const double medium = 900;

  /// Wide desktop (two-column reading + generous chrome).
  static const double expanded = 1200;

  /// Extra-wide (optional 3-column or spacious gutters).
  static const double large = 1440;

  /// Reader's side panel / comment column never shrinks below this.
  static const double readerPanelMin = 320;

  /// Player side panel (Notes/Transcript) minimum — matches PlayerScreen 320dp.
  static const double playerPanelMin = 320;

  /// Player panel share of total width in landscape (0.38) clamped.
  static const double playerPanelShare = 0.38;
  static const double playerPanelMaxShare = 0.55;

  /// Minimum desktop window size enforced via [LinuxWindowConfig].
  static const double windowMinWidth = 960;
  static const double windowMinHeight = 640;

  /// Default Linux window size on first launch.
  static const double windowDefaultWidth = 1280;
  static const double windowDefaultHeight = 800;

  static bool isCompact(double width) => width < compact;
  static bool isMedium(double width) => width >= compact && width < medium;
  static bool isExpanded(double width) => width >= medium && width < large;
  static bool isLarge(double width) => width >= large;

  /// True when the sidebar should be visible as a rail.
  static bool showSidebarRail(double width) => width >= medium;

  /// True when bottom navigation should be used (collapsed sidebar).
  static bool showBottomNav(double width) => width < medium;

  /// Resolve the responsive column count for the Home library grid.
  static int homeGridColumns(double width) {
    if (width >= large) return 3;
    if (width >= medium) return 2;
    return 1;
  }

  /// Shared panel width calculation (Player / Reader side pane).
  /// Mirrors PlayerScreen: (totalWidth * 0.38).clamp(320, totalWidth*0.55)
  /// If the window is narrower than 582px the max would be < min; in that
  /// case the panel takes the minimum (allowing horizontal overflow to
  /// trigger a scroll rather than a violated clamp).
  static double panelWidth(double totalWidth, {double min = playerPanelMin}) {
    final max = totalWidth * playerPanelMaxShare;
    if (max < min) return min;
    final raw = totalWidth * playerPanelShare;
    return raw.clamp(min, max);
  }
}

/// Extension helpers on [BoxConstraints] / [BuildContext].
extension DesktopBreakpointContext on BuildContext {
  double get screenWidth => MediaQuery.sizeOf(this).width;
  bool get isCompact => DesktopBreakpoints.isCompact(screenWidth);
  bool get isSidebarRailVisible =>
      DesktopBreakpoints.showSidebarRail(screenWidth);
  bool get isBottomNavVisible => DesktopBreakpoints.showBottomNav(screenWidth);
}
