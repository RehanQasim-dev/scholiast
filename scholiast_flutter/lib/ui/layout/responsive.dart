import 'package:flutter/widgets.dart';

import 'desktop_breakpoints.dart';

/// A builder that exposes the current responsive tier to its child.
///
/// Useful for wide-layout adaptations (reader split, player landscape split,
/// home grid) without sprinkling MediaQuery throughout screens.
class ResponsiveBuilder extends StatelessWidget {
  final Widget Function(BuildContext context, ResponsiveTier tier) builder;

  const ResponsiveBuilder({super.key, required this.builder});

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final tier = ResponsiveTier.fromWidth(width);
    return builder(context, tier);
  }
}

enum ResponsiveTier {
  compact,
  medium,
  expanded,
  large;

  static ResponsiveTier fromWidth(double width) {
    if (width >= DesktopBreakpoints.large) return ResponsiveTier.large;
    if (width >= DesktopBreakpoints.medium) return ResponsiveTier.expanded;
    if (width >= DesktopBreakpoints.compact) return ResponsiveTier.medium;
    return ResponsiveTier.compact;
  }

  bool get isCompact => this == ResponsiveTier.compact;
  bool get isMedium => this == ResponsiveTier.medium;
  bool get isExpanded => this == ResponsiveTier.expanded;
  bool get isLarge => this == ResponsiveTier.large;
  bool get showSidebarRail =>
      this == ResponsiveTier.expanded || this == ResponsiveTier.large;
  bool get showBottomNav => this == ResponsiveTier.compact || this == ResponsiveTier.medium;
}

/// Responsive grid thresholds for the Home library and other card grids.
///
/// Single-column below medium, 2 columns at medium, 3 at large.
class ResponsiveGrid extends StatelessWidget {
  final List<Widget> children;
  final double maxColumnWidth;
  final double spacing;
  final double runSpacing;
  final EdgeInsetsGeometry padding;

  const ResponsiveGrid({
    super.key,
    required this.children,
    this.maxColumnWidth = 560,
    this.spacing = 12,
    this.runSpacing = 12,
    this.padding = const EdgeInsets.fromLTRB(24, 4, 24, 24),
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final columns = DesktopBreakpoints.homeGridColumns(width);
        if (columns == 1) {
          return ListView.separated(
            padding: padding,
            itemCount: children.length,
            separatorBuilder: (_, _) => SizedBox(height: spacing),
            itemBuilder: (_, i) => children[i],
          );
        }
        return GridView.builder(
          padding: padding,
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: columns,
            mainAxisSpacing: runSpacing,
            crossAxisSpacing: spacing,
            childAspectRatio: columns == 3 ? 1.4 : 1.6,
          ),
          itemCount: children.length,
          itemBuilder: (_, i) => children[i],
        );
      },
    );
  }
}

/// Wide-layout split for the Reader: article on the left, optional thread/
/// comments panel on the right with a guaranteed 320dp minimum.
///
/// On compact widths the panel stacks below the article.
class ReaderSplit extends StatelessWidget {
  final Widget article;
  final Widget? sidePanel;
  final double panelMinWidth;

  const ReaderSplit({
    super.key,
    required this.article,
    this.sidePanel,
    this.panelMinWidth = DesktopBreakpoints.readerPanelMin,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final panel = sidePanel;
        final hasPanel = panel != null;
        // Compact: stack vertically. Otherwise row with clamped share.
        if (width < DesktopBreakpoints.medium || !hasPanel) {
          return Column(
            children: [
              Expanded(child: article),
              if (hasPanel) ...[
                Container(height: 1, color: const Color(0xFF232733)),
                SizedBox(height: 320, child: panel),
              ],
            ],
          );
        }
        final panelW = DesktopBreakpoints.panelWidth(width, min: panelMinWidth);
        return Row(
          children: [
            Expanded(child: article),
            Container(width: 1, color: const Color(0xFF232733)),
            SizedBox(width: panelW, child: panel),
          ],
        );
      },
    );
  }
}

/// Landscape-aware split for Player: video stage + Notes/Transcript panel.
///
/// Mirrors PlayerScreen's Row with 0.38 share clamped 320..0.55*W.
/// This widget is an extracted reusable version for desktop.
class PlayerLandscapeSplit extends StatelessWidget {
  final Widget stage;
  final Widget panel;
  final bool isLandscape;

  const PlayerLandscapeSplit({
    super.key,
    required this.stage,
    required this.panel,
    required this.isLandscape,
  });

  @override
  Widget build(BuildContext context) {
    if (!isLandscape) {
      return Column(
        children: [
          AspectRatio(aspectRatio: 16 / 9, child: stage),
          Expanded(child: panel),
        ],
      );
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        final w = constraints.maxWidth;
        final panelW = DesktopBreakpoints.panelWidth(w);
        return Row(
          children: [
            Expanded(child: stage),
            Container(width: 1, color: const Color(0x1FFFFFFF)),
            SizedBox(width: panelW, child: panel),
          ],
        );
      },
    );
  }
}
