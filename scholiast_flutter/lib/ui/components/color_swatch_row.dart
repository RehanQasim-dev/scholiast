import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';

/// Supported highlight color keys in Scholiast.
abstract final class HighlightColorNames {
  static const String yellow = 'yellow';
  static const String green = 'green';
  static const String red = 'red';

  static const List<String> all = [yellow, green, red];
}

/// A row of circular color swatches (Yellow, Green, Red) with active selection rings.
class ColorSwatchRow extends StatelessWidget {
  final String? selectedColor;
  final ValueChanged<String> onColorSelected;
  final double swatchSize;
  final double spacing;
  final List<String> colors;
  final MainAxisAlignment mainAxisAlignment;
  final MainAxisSize mainAxisSize;

  const ColorSwatchRow({
    super.key,
    required this.selectedColor,
    required this.onColorSelected,
    this.swatchSize = 26.0,
    this.spacing = 10.0,
    this.colors = HighlightColorNames.all,
    this.mainAxisAlignment = MainAxisAlignment.start,
    this.mainAxisSize = MainAxisSize.min,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: mainAxisAlignment,
      mainAxisSize: mainAxisSize,
      children: [
        for (int i = 0; i < colors.length; i++) ...[
          if (i > 0) SizedBox(width: spacing),
          _ColorSwatchItem(
            colorName: colors[i],
            isSelected: (selectedColor ?? 'yellow').toLowerCase() == colors[i].toLowerCase(),
            size: swatchSize,
            onTap: () => onColorSelected(colors[i]),
          ),
        ],
      ],
    );
  }
}

class _ColorSwatchItem extends StatelessWidget {
  final String colorName;
  final bool isSelected;
  final double size;
  final VoidCallback onTap;

  const _ColorSwatchItem({
    required this.colorName,
    required this.isSelected,
    required this.size,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final fillColor = AppColors.getHighlightColor(colorName);
    final borderColor = AppColors.getHighlightBorderColor(colorName);

    return Semantics(
      label: '$colorName highlight color',
      selected: isSelected,
      button: true,
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          curve: Curves.easeOutCubic,
          width: size,
          height: size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: fillColor,
            border: Border.all(
              color: isSelected ? borderColor : Colors.transparent,
              width: isSelected ? 2.5 : 0,
            ),
            boxShadow: isSelected
                ? [
                    BoxShadow(
                      color: borderColor.withValues(alpha: 0.4),
                      blurRadius: 6,
                      spreadRadius: 1,
                    ),
                  ]
                : null,
          ),
          child: isSelected
              ? Center(
                  child: Container(
                    width: size * 0.35,
                    height: size * 0.35,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: borderColor,
                    ),
                  ),
                )
              : null,
        ),
      ),
    );
  }
}
