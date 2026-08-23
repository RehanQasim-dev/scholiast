import 'package:flutter/material.dart';

/// Semantic and core color tokens for Scholiast.
///
/// Matches color definitions across the Web Dashboard (_dashboard.scss)
/// and Android Jetpack Compose (Color.kt, Theme.kt).
abstract final class AppColors {
  // --- Canvas & Surfaces ---
  /// Pure dark canvas / background (#0B0D14)
  static const Color background = Color(0xFF0B0D14);
  static const Color backgroundDark = Color(0xFF000000);

  /// Elevated card & surface layers
  static const Color surface = Color(0xFF0B0D14);
  static const Color surfaceElevated = Color(0xFF151822); // Card surface
  static const Color surfaceElevatedAlt = Color(0xFF151824);
  static const Color surfaceContainer = Color(0xFF1C2030); // Higher elevation / chips / dialogs
  static const Color surfaceContainerHighest = Color(0xFF252B3D); // Hover / active borders / popovers

  // --- Borders & Hairlines ---
  static const Color hairline = Color(0xFF232733);
  static const Color hairlineLight = Color(0x1FFFFFFF); // rgba(255, 255, 255, 0.12)
  static const Color line = Color(0x12FFFFFF); // rgba(255, 255, 255, 0.07)
  static const Color lineSubtle = Color(0x0FFFFFFF);

  // --- Typography & Content ---
  static const Color textPrimary = Color(0xFFFFFFFF);
  static const Color textSecondary = Color(0xFF9AA0A6);
  static const Color textTertiary = Color(0xFF6E6E78);
  static const Color textDisabled = Color(0xFF4A4F59);

  // --- Brand & Accent ---
  static const Color accentPurple = Color(0xFF8B7CF6); // #8b7cf6
  static const Color accentPurpleHover = Color(0xFF7C3AED); // #7c3aed
  static const Color accentPurpleLight = Color(0xFFA78BFA);
  static const Color accentPurpleWeak = Color(0x268B7CF6); // rgba(140, 115, 250, 0.15)
  static const Color onAccent = Color(0xFF171028);

  // --- Highlight Colors ---
  // Yellow (#fef08a / #eab308)
  static const Color highlightYellow = Color(0xFFFEF08A);
  static const Color highlightYellowBorder = Color(0xFFEAB308);
  static const Color highlightYellowCompose = Color(0xFFF9E64D);
  static const Color highlightYellowTint = Color(0x20FEF08A);
  static const Color highlightYellowDark = Color(0xFFD29600);

  // Green (#bbf7d0 / #22c55e)
  static const Color highlightGreen = Color(0xFFBBF7D0);
  static const Color highlightGreenBorder = Color(0xFF22C55E);
  static const Color highlightGreenCompose = Color(0xFF5FE3A0);
  static const Color highlightGreenTint = Color(0x20BBF7D0);
  static const Color highlightGreenDark = Color(0xFF2DA05F);

  // Red (#fecaca / #ef4444)
  static const Color highlightRed = Color(0xFFFECACA);
  static const Color highlightRedBorder = Color(0xFFEF4444);
  static const Color highlightRedCompose = Color(0xFFFF5A5A);
  static const Color highlightRedTint = Color(0x20FECACA);
  static const Color highlightRedDark = Color(0xFFDC3C5A);

  // --- Feedback & Status ---
  static const Color success = Color(0xFF22C55E);
  static const Color successAlt = Color(0xFF5FE3A0);
  static const Color danger = Color(0xFFEF4444);
  static const Color dangerAlt = Color(0xFFFF5A5A);
  static const Color dangerWeak = Color(0x24EF4444);
  static const Color warning = Color(0xFFEAB308);

  /// Map highlight color name strings ('yellow', 'green', 'red') to their primary display fill color.
  static Color getHighlightColor(String? name) {
    return switch (name?.toLowerCase().trim()) {
      'yellow' => highlightYellow,
      'green' => highlightGreen,
      'red' => highlightRed,
      _ => highlightYellow,
    };
  }

  /// Map highlight color name strings to their active border / stroke color.
  static Color getHighlightBorderColor(String? name) {
    return switch (name?.toLowerCase().trim()) {
      'yellow' => highlightYellowBorder,
      'green' => highlightGreenBorder,
      'red' => highlightRedBorder,
      _ => highlightYellowBorder,
    };
  }

  /// Map highlight color name strings to their subtle background tint.
  static Color getHighlightTintColor(String? name) {
    return switch (name?.toLowerCase().trim()) {
      'yellow' => highlightYellowTint,
      'green' => highlightGreenTint,
      'red' => highlightRedTint,
      _ => highlightYellowTint,
    };
  }
}
