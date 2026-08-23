import 'package:flutter/widgets.dart';

import 'desktop_breakpoints.dart';

/// Reusable wide-layout helpers for Reader / Player / Home.
///
/// Each helper is a pure widget with no Riverpod dependency so it is
/// trivially unit-testable and can wrap any Wave-4 screen.
class WideLayout {
  const WideLayout._();

  /// Returns whether the current width qualifies as "wide" (≥ 900px).
  static bool isWide(BuildContext context) =>
      MediaQuery.sizeOf(context).width >= DesktopBreakpoints.medium;

  /// Reader article + comments split — article flexes, panel is clamped
  /// to [DesktopBreakpoints.readerPanelMin] and [playerPanelMaxShare].
  static Widget readerSplit({
    required Widget article,
    Widget? comments,
    double minPanel = DesktopBreakpoints.readerPanelMin,
  }) {
    return ReaderWideSplit(
      article: article,
      comments: comments,
      minPanel: minPanel,
    );
  }

  /// Player video + panel split (landscape vs portrait handled by caller).
  static Widget playerSplit({
    required Widget stage,
    required Widget panel,
    required bool landscape,
  }) {
    return PlayerWideSplit(
      stage: stage,
      panel: panel,
      landscape: landscape,
    );
  }

  /// Grid columns for home — 1 below 900, 2 at 900, 3 at 1440.
  static int gridColumns(double width) =>
      DesktopBreakpoints.homeGridColumns(width);
}

class ReaderWideSplit extends StatelessWidget {
  final Widget article;
  final Widget? comments;
  final double minPanel;

  const ReaderWideSplit({
    super.key,
    required this.article,
    this.comments,
    this.minPanel = DesktopBreakpoints.readerPanelMin,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final w = constraints.maxWidth;
        final hasComments = comments != null;
        if (w < DesktopBreakpoints.medium || !hasComments) {
          return article;
        }
        final panelW = DesktopBreakpoints.panelWidth(w, min: minPanel);
        return Row(
          children: [
            Expanded(child: article),
            Container(width: 1, color: const Color(0xFF232733)),
            SizedBox(width: panelW, child: comments!),
          ],
        );
      },
    );
  }
}

class PlayerWideSplit extends StatelessWidget {
  final Widget stage;
  final Widget panel;
  final bool landscape;

  const PlayerWideSplit({
    super.key,
    required this.stage,
    required this.panel,
    required this.landscape,
  });

  @override
  Widget build(BuildContext context) {
    if (!landscape) {
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
