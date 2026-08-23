import 'package:flutter/widgets.dart';

import '../../ui/layout/desktop_breakpoints.dart';

/// Linux window configuration — pure Dart, no native plugin required.
///
/// The real `window_manager` plugin is optional on Linux; this class
/// provides the constraints and title-bar contract that both the tests
/// and the production shell consume. When `window_manager` is available
/// the shell can delegate via [applyToWindowManager] (optional import
/// via conditional import — not required for tests).
class LinuxWindowConfig {
  final String title;
  final Size defaultSize;
  final Size minSize;
  final Size? maxSize;
  final bool centerOnLaunch;
  final bool resizable;

  const LinuxWindowConfig({
    this.title = 'Scholiast',
    this.defaultSize = const Size(
      DesktopBreakpoints.windowDefaultWidth,
      DesktopBreakpoints.windowDefaultHeight,
    ),
    this.minSize = const Size(
      DesktopBreakpoints.windowMinWidth,
      DesktopBreakpoints.windowMinHeight,
    ),
    this.maxSize,
    this.centerOnLaunch = true,
    this.resizable = true,
  });

  /// The canonical Linux config for Scholiast.
  static const scholiast = LinuxWindowConfig();

  /// Clamp a proposed window size to the allowed range.
  Size clampSize(Size proposed) {
    final w = proposed.width.clamp(minSize.width, maxSize?.width ?? double.infinity);
    final h = proposed.height.clamp(minSize.height, maxSize?.height ?? double.infinity);
    return Size(w, h);
  }

  /// Whether a given [Size] satisfies the minimum constraints.
  bool isSizeAllowed(Size size) =>
      size.width >= minSize.width && size.height >= minSize.height;

  /// Apply constraints to a [BoxConstraints] — useful for layout tests
  /// that simulate the window chrome.
  BoxConstraints toBoxConstraints() => BoxConstraints(
        minWidth: minSize.width,
        minHeight: minSize.height,
        maxWidth: maxSize?.width ?? double.infinity,
        maxHeight: maxSize?.height ?? double.infinity,
      );

  /// Title-bar fallback for Linux (no native decoration assumptions).
  /// Returns a simple [AppBar]-like widget for in-content title bars
  /// when the OS chrome is not drawn (e.g. in tests).
  Widget buildFallbackTitleBar({
    Widget? leading,
    Widget? trailing,
    double height = 40,
  }) {
    return Container(
      height: height,
      color: const Color(0xFF0B0D14),
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Row(
        children: [
          if (leading != null) leading,
          const Expanded(
            child: Text(
              'Scholiast',
              style: TextStyle(
                color: Color(0xFFFFFFFF),
                fontSize: 13,
                fontWeight: FontWeight.w600,
                letterSpacing: -0.2,
              ),
            ),
          ),
          if (trailing != null) trailing,
        ],
      ),
    );
  }

  LinuxWindowConfig copyWith({
    String? title,
    Size? defaultSize,
    Size? minSize,
    Size? maxSize,
    bool? centerOnLaunch,
    bool? resizable,
  }) {
    return LinuxWindowConfig(
      title: title ?? this.title,
      defaultSize: defaultSize ?? this.defaultSize,
      minSize: minSize ?? this.minSize,
      maxSize: maxSize ?? this.maxSize,
      centerOnLaunch: centerOnLaunch ?? this.centerOnLaunch,
      resizable: resizable ?? this.resizable,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is LinuxWindowConfig &&
      title == other.title &&
      defaultSize == other.defaultSize &&
      minSize == other.minSize &&
      maxSize == other.maxSize &&
      centerOnLaunch == other.centerOnLaunch &&
      resizable == other.resizable;

  @override
  int get hashCode => Object.hash(
        title,
        defaultSize,
        minSize,
        maxSize,
        centerOnLaunch,
        resizable,
      );

  @override
  String toString() =>
      'LinuxWindowConfig(title:$title default:$defaultSize min:$minSize)';
}
