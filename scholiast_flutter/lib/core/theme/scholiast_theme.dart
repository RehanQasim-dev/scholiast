import 'package:flutter/material.dart';
import 'app_colors.dart';

/// Custom theme extension for Scholiast-specific design tokens.
@immutable
class ScholiastCustomColors extends ThemeExtension<ScholiastCustomColors> {
  final Color background;
  final Color surfaceElevated;
  final Color surfaceContainer;
  final Color surfaceContainerHighest;
  final Color hairline;
  final Color line;
  final Color accentPurple;
  final Color accentPurpleHover;
  final Color accentPurpleWeak;
  final Color highlightYellow;
  final Color highlightYellowBorder;
  final Color highlightYellowTint;
  final Color highlightGreen;
  final Color highlightGreenBorder;
  final Color highlightGreenTint;
  final Color highlightRed;
  final Color highlightRedBorder;
  final Color highlightRedTint;
  final Color success;
  final Color danger;
  final Color warning;

  const ScholiastCustomColors({
    required this.background,
    required this.surfaceElevated,
    required this.surfaceContainer,
    required this.surfaceContainerHighest,
    required this.hairline,
    required this.line,
    required this.accentPurple,
    required this.accentPurpleHover,
    required this.accentPurpleWeak,
    required this.highlightYellow,
    required this.highlightYellowBorder,
    required this.highlightYellowTint,
    required this.highlightGreen,
    required this.highlightGreenBorder,
    required this.highlightGreenTint,
    required this.highlightRed,
    required this.highlightRedBorder,
    required this.highlightRedTint,
    required this.success,
    required this.danger,
    required this.warning,
  });

  /// Default dark theme instance.
  static const dark = ScholiastCustomColors(
    background: AppColors.background,
    surfaceElevated: AppColors.surfaceElevated,
    surfaceContainer: AppColors.surfaceContainer,
    surfaceContainerHighest: AppColors.surfaceContainerHighest,
    hairline: AppColors.hairline,
    line: AppColors.line,
    accentPurple: AppColors.accentPurple,
    accentPurpleHover: AppColors.accentPurpleHover,
    accentPurpleWeak: AppColors.accentPurpleWeak,
    highlightYellow: AppColors.highlightYellow,
    highlightYellowBorder: AppColors.highlightYellowBorder,
    highlightYellowTint: AppColors.highlightYellowTint,
    highlightGreen: AppColors.highlightGreen,
    highlightGreenBorder: AppColors.highlightGreenBorder,
    highlightGreenTint: AppColors.highlightGreenTint,
    highlightRed: AppColors.highlightRed,
    highlightRedBorder: AppColors.highlightRedBorder,
    highlightRedTint: AppColors.highlightRedTint,
    success: AppColors.success,
    danger: AppColors.danger,
    warning: AppColors.warning,
  );

  @override
  ScholiastCustomColors copyWith({
    Color? background,
    Color? surfaceElevated,
    Color? surfaceContainer,
    Color? surfaceContainerHighest,
    Color? hairline,
    Color? line,
    Color? accentPurple,
    Color? accentPurpleHover,
    Color? accentPurpleWeak,
    Color? highlightYellow,
    Color? highlightYellowBorder,
    Color? highlightYellowTint,
    Color? highlightGreen,
    Color? highlightGreenBorder,
    Color? highlightGreenTint,
    Color? highlightRed,
    Color? highlightRedBorder,
    Color? highlightRedTint,
    Color? success,
    Color? danger,
    Color? warning,
  }) {
    return ScholiastCustomColors(
      background: background ?? this.background,
      surfaceElevated: surfaceElevated ?? this.surfaceElevated,
      surfaceContainer: surfaceContainer ?? this.surfaceContainer,
      surfaceContainerHighest: surfaceContainerHighest ?? this.surfaceContainerHighest,
      hairline: hairline ?? this.hairline,
      line: line ?? this.line,
      accentPurple: accentPurple ?? this.accentPurple,
      accentPurpleHover: accentPurpleHover ?? this.accentPurpleHover,
      accentPurpleWeak: accentPurpleWeak ?? this.accentPurpleWeak,
      highlightYellow: highlightYellow ?? this.highlightYellow,
      highlightYellowBorder: highlightYellowBorder ?? this.highlightYellowBorder,
      highlightYellowTint: highlightYellowTint ?? this.highlightYellowTint,
      highlightGreen: highlightGreen ?? this.highlightGreen,
      highlightGreenBorder: highlightGreenBorder ?? this.highlightGreenBorder,
      highlightGreenTint: highlightGreenTint ?? this.highlightGreenTint,
      highlightRed: highlightRed ?? this.highlightRed,
      highlightRedBorder: highlightRedBorder ?? this.highlightRedBorder,
      highlightRedTint: highlightRedTint ?? this.highlightRedTint,
      success: success ?? this.success,
      danger: danger ?? this.danger,
      warning: warning ?? this.warning,
    );
  }

  @override
  ScholiastCustomColors lerp(ThemeExtension<ScholiastCustomColors>? other, double t) {
    if (other is! ScholiastCustomColors) return this;
    return ScholiastCustomColors(
      background: Color.lerp(background, other.background, t) ?? background,
      surfaceElevated: Color.lerp(surfaceElevated, other.surfaceElevated, t) ?? surfaceElevated,
      surfaceContainer: Color.lerp(surfaceContainer, other.surfaceContainer, t) ?? surfaceContainer,
      surfaceContainerHighest: Color.lerp(surfaceContainerHighest, other.surfaceContainerHighest, t) ?? surfaceContainerHighest,
      hairline: Color.lerp(hairline, other.hairline, t) ?? hairline,
      line: Color.lerp(line, other.line, t) ?? line,
      accentPurple: Color.lerp(accentPurple, other.accentPurple, t) ?? accentPurple,
      accentPurpleHover: Color.lerp(accentPurpleHover, other.accentPurpleHover, t) ?? accentPurpleHover,
      accentPurpleWeak: Color.lerp(accentPurpleWeak, other.accentPurpleWeak, t) ?? accentPurpleWeak,
      highlightYellow: Color.lerp(highlightYellow, other.highlightYellow, t) ?? highlightYellow,
      highlightYellowBorder: Color.lerp(highlightYellowBorder, other.highlightYellowBorder, t) ?? highlightYellowBorder,
      highlightYellowTint: Color.lerp(highlightYellowTint, other.highlightYellowTint, t) ?? highlightYellowTint,
      highlightGreen: Color.lerp(highlightGreen, other.highlightGreen, t) ?? highlightGreen,
      highlightGreenBorder: Color.lerp(highlightGreenBorder, other.highlightGreenBorder, t) ?? highlightGreenBorder,
      highlightGreenTint: Color.lerp(highlightGreenTint, other.highlightGreenTint, t) ?? highlightGreenTint,
      highlightRed: Color.lerp(highlightRed, other.highlightRed, t) ?? highlightRed,
      highlightRedBorder: Color.lerp(highlightRedBorder, other.highlightRedBorder, t) ?? highlightRedBorder,
      highlightRedTint: Color.lerp(highlightRedTint, other.highlightRedTint, t) ?? highlightRedTint,
      success: Color.lerp(success, other.success, t) ?? success,
      danger: Color.lerp(danger, other.danger, t) ?? danger,
      warning: Color.lerp(warning, other.warning, t) ?? warning,
    );
  }
}

/// The centralized Material 3 Dark theme for the Scholiast client.
abstract final class ScholiastTheme {
  /// Dark Material 3 ColorScheme with exact parity with Android Compose & Web dashboard.
  static const ColorScheme darkColorScheme = ColorScheme(
    brightness: Brightness.dark,
    primary: AppColors.accentPurple,
    onPrimary: AppColors.onAccent,
    primaryContainer: AppColors.surfaceContainer,
    onPrimaryContainer: AppColors.textPrimary,
    secondary: AppColors.accentPurpleLight,
    onSecondary: AppColors.onAccent,
    secondaryContainer: AppColors.surfaceElevated,
    onSecondaryContainer: AppColors.textPrimary,
    tertiary: AppColors.accentPurpleHover,
    onTertiary: AppColors.onAccent,
    tertiaryContainer: AppColors.surfaceElevatedAlt,
    onTertiaryContainer: AppColors.textPrimary,
    error: AppColors.danger,
    onError: AppColors.textPrimary,
    errorContainer: AppColors.dangerWeak,
    onErrorContainer: AppColors.danger,
    surface: AppColors.surfaceElevated,
    onSurface: AppColors.textPrimary,
    surfaceContainerLowest: AppColors.backgroundDark,
    surfaceContainerLow: AppColors.background,
    surfaceContainer: AppColors.surfaceContainer,
    surfaceContainerHigh: AppColors.surfaceContainerHighest,
    surfaceContainerHighest: AppColors.surfaceContainerHighest,
    surfaceDim: AppColors.background,
    surfaceBright: AppColors.surfaceElevated,
    onSurfaceVariant: AppColors.textSecondary,
    outline: AppColors.hairline,
    outlineVariant: AppColors.line,
    shadow: Colors.black,
    scrim: Colors.black,
    surfaceTint: AppColors.accentPurple,
  );

  /// Clean, high-contrast typography hierarchy matching Material 3 & Geist/Inter.
  static const TextTheme darkTextTheme = TextTheme(
    displayLarge: TextStyle(
      fontSize: 57,
      fontWeight: FontWeight.w700,
      letterSpacing: -0.25,
      height: 1.12,
      color: AppColors.textPrimary,
    ),
    displayMedium: TextStyle(
      fontSize: 45,
      fontWeight: FontWeight.w700,
      letterSpacing: 0,
      height: 1.16,
      color: AppColors.textPrimary,
    ),
    displaySmall: TextStyle(
      fontSize: 36,
      fontWeight: FontWeight.w600,
      letterSpacing: 0,
      height: 1.22,
      color: AppColors.textPrimary,
    ),
    headlineLarge: TextStyle(
      fontSize: 32,
      fontWeight: FontWeight.w600,
      letterSpacing: 0,
      height: 1.25,
      color: AppColors.textPrimary,
    ),
    headlineMedium: TextStyle(
      fontSize: 28,
      fontWeight: FontWeight.w600,
      letterSpacing: 0,
      height: 1.29,
      color: AppColors.textPrimary,
    ),
    headlineSmall: TextStyle(
      fontSize: 24,
      fontWeight: FontWeight.w600,
      letterSpacing: 0,
      height: 1.33,
      color: AppColors.textPrimary,
    ),
    titleLarge: TextStyle(
      fontSize: 20,
      fontWeight: FontWeight.w600,
      letterSpacing: 0,
      height: 1.4,
      color: AppColors.textPrimary,
    ),
    titleMedium: TextStyle(
      fontSize: 16,
      fontWeight: FontWeight.w600,
      letterSpacing: 0.15,
      height: 1.45,
      color: AppColors.textPrimary,
    ),
    titleSmall: TextStyle(
      fontSize: 14,
      fontWeight: FontWeight.w600,
      letterSpacing: 0.1,
      height: 1.43,
      color: AppColors.textPrimary,
    ),
    bodyLarge: TextStyle(
      fontSize: 16,
      fontWeight: FontWeight.w400,
      letterSpacing: 0.2,
      height: 1.5,
      color: AppColors.textPrimary,
    ),
    bodyMedium: TextStyle(
      fontSize: 14,
      fontWeight: FontWeight.w400,
      letterSpacing: 0.2,
      height: 1.5,
      color: AppColors.textSecondary,
    ),
    bodySmall: TextStyle(
      fontSize: 12,
      fontWeight: FontWeight.w400,
      letterSpacing: 0.3,
      height: 1.5,
      color: AppColors.textSecondary,
    ),
    labelLarge: TextStyle(
      fontSize: 14,
      fontWeight: FontWeight.w600,
      letterSpacing: 0.1,
      height: 1.43,
      color: AppColors.textPrimary,
    ),
    labelMedium: TextStyle(
      fontSize: 12,
      fontWeight: FontWeight.w500,
      letterSpacing: 0.4,
      height: 1.33,
      color: AppColors.textSecondary,
    ),
    labelSmall: TextStyle(
      fontSize: 11,
      fontWeight: FontWeight.w500,
      letterSpacing: 0.4,
      height: 1.45,
      color: AppColors.textTertiary,
    ),
  );

  /// Builds the complete dark [ThemeData].
  static ThemeData get darkTheme {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      scaffoldBackgroundColor: AppColors.background,
      colorScheme: darkColorScheme,
      textTheme: darkTextTheme,
      canvasColor: AppColors.background,
      cardColor: AppColors.surfaceElevated,
      dividerColor: AppColors.hairline,
      splashColor: AppColors.accentPurpleWeak,
      highlightColor: Colors.transparent,
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.background,
        elevation: 0,
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
        centerTitle: false,
        iconTheme: IconThemeData(color: AppColors.textPrimary),
        titleTextStyle: TextStyle(
          fontSize: 18,
          fontWeight: FontWeight.w600,
          color: AppColors.textPrimary,
          letterSpacing: -0.2,
        ),
      ),
      cardTheme: CardThemeData(
        color: AppColors.surfaceElevated,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: const BorderSide(color: AppColors.hairline, width: 1),
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: AppColors.surfaceContainer,
        surfaceTintColor: Colors.transparent,
        elevation: 6,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: AppColors.hairline, width: 1),
        ),
        titleTextStyle: const TextStyle(
          fontSize: 18,
          fontWeight: FontWeight.w600,
          color: AppColors.textPrimary,
        ),
        contentTextStyle: const TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w400,
          color: AppColors.textSecondary,
        ),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: AppColors.surfaceElevated,
        surfaceTintColor: Colors.transparent,
        elevation: 8,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
          side: BorderSide(color: AppColors.hairline, width: 1),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surfaceContainer,
        hintStyle: const TextStyle(
          color: AppColors.textDisabled,
          fontSize: 14,
        ),
        labelStyle: const TextStyle(
          color: AppColors.textSecondary,
          fontSize: 14,
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: AppColors.hairline, width: 1),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: AppColors.hairline, width: 1),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: AppColors.accentPurple, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: AppColors.danger, width: 1),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.accentPurple,
          foregroundColor: AppColors.onAccent,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
          textStyle: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.textPrimary,
          side: const BorderSide(color: AppColors.hairline, width: 1),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppColors.accentPurple,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(6),
          ),
        ),
      ),
      iconTheme: const IconThemeData(
        color: AppColors.textSecondary,
        size: 20,
      ),
      dividerTheme: const DividerThemeData(
        color: AppColors.hairline,
        thickness: 1,
        space: 1,
      ),
      tooltipTheme: TooltipThemeData(
        decoration: BoxDecoration(
          color: AppColors.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: AppColors.hairline, width: 1),
        ),
        textStyle: const TextStyle(
          color: AppColors.textPrimary,
          fontSize: 12,
        ),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      ),
      extensions: const <ThemeExtension<dynamic>>[
        ScholiastCustomColors.dark,
      ],
    );
  }

  /// Alias for [darkTheme].
  static ThemeData get theme => darkTheme;
}

/// Convenience extension on [BuildContext] to access design tokens and typography.
extension ScholiastThemeContextExtensions on BuildContext {
  /// The [ScholiastCustomColors] extension tokens.
  ScholiastCustomColors get scholiastColors =>
      Theme.of(this).extension<ScholiastCustomColors>() ?? ScholiastCustomColors.dark;

  /// The active [ColorScheme].
  ColorScheme get colorScheme => Theme.of(this).colorScheme;

  /// The active [TextTheme].
  TextTheme get textTheme => Theme.of(this).textTheme;
}
