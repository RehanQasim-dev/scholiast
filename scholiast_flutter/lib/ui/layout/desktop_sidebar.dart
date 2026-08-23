import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';

/// Desktop navigation destinations. Order is stable and maps 1:1 to
/// NavigationRail indices and bottom-nav indices.
enum DesktopDestination {
  home('Home', Icons.home_outlined, Icons.home),
  reader('Reader', Icons.article_outlined, Icons.article),
  player('Player', Icons.play_circle_outline, Icons.play_circle),
  settings('Settings', Icons.settings_outlined, Icons.settings);

  final String label;
  final IconData icon;
  final IconData selectedIcon;
  const DesktopDestination(this.label, this.icon, this.selectedIcon);
}

/// Material 3 NavigationRail for desktop widths ≥ 900px.
///
/// Colors: selected icon/text in AppColors.accentPurple, background
/// AppColors.background, indicator AppColors.accentPurpleWeak.
class DesktopSidebar extends StatelessWidget {
  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;
  final bool extended;

  const DesktopSidebar({
    super.key,
    required this.selectedIndex,
    required this.onDestinationSelected,
    this.extended = false,
  });

  @override
  Widget build(BuildContext context) {
    return NavigationRail(
      selectedIndex: selectedIndex,
      onDestinationSelected: onDestinationSelected,
      extended: extended,
      backgroundColor: AppColors.background,
      indicatorColor: AppColors.accentPurpleWeak,
      selectedIconTheme: const IconThemeData(color: AppColors.accentPurple),
      unselectedIconTheme: const IconThemeData(color: AppColors.textTertiary),
      selectedLabelTextStyle: const TextStyle(
        color: AppColors.accentPurple,
        fontWeight: FontWeight.w600,
        fontSize: 12,
      ),
      unselectedLabelTextStyle: const TextStyle(
        color: AppColors.textTertiary,
        fontSize: 12,
      ),
      labelType: extended ? NavigationRailLabelType.none : NavigationRailLabelType.all,
      leading: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Column(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: AppColors.accentPurple,
                borderRadius: BorderRadius.circular(8),
              ),
              alignment: Alignment.center,
              child: const Text(
                'S',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                  fontSize: 18,
                ),
              ),
            ),
            if (!extended) const SizedBox(height: 8),
            if (!extended)
              const Text(
                'Scholiast',
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.4,
                ),
              ),
          ],
        ),
      ),
      destinations: [
        for (final d in DesktopDestination.values)
          NavigationRailDestination(
            icon: Icon(d.icon),
            selectedIcon: Icon(d.selectedIcon),
            label: Text(d.label),
            padding: const EdgeInsets.symmetric(vertical: 4),
          ),
      ],
    );
  }
}

/// Bottom navigation used below 900px (collapsed sidebar).
class DesktopBottomNav extends StatelessWidget {
  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;

  const DesktopBottomNav({
    super.key,
    required this.selectedIndex,
    required this.onDestinationSelected,
  });

  @override
  Widget build(BuildContext context) {
    return NavigationBar(
      selectedIndex: selectedIndex,
      onDestinationSelected: onDestinationSelected,
      backgroundColor: AppColors.surfaceElevated,
      indicatorColor: AppColors.accentPurpleWeak,
      destinations: [
        for (final d in DesktopDestination.values)
          NavigationDestination(
            icon: Icon(d.icon, color: AppColors.textTertiary),
            selectedIcon: Icon(d.selectedIcon, color: AppColors.accentPurple),
            label: d.label,
          ),
      ],
    );
  }
}

/// Adaptive navigation shell that switches between rail and bottom bar
/// at the 900px breakpoint.
class AdaptiveNavigation extends StatelessWidget {
  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;
  final Widget child;
  final bool railExtended;

  const AdaptiveNavigation({
    super.key,
    required this.selectedIndex,
    required this.onDestinationSelected,
    required this.child,
    this.railExtended = false,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final useRail = constraints.maxWidth >= 900;
        if (useRail) {
          return Row(
            children: [
              DesktopSidebar(
                selectedIndex: selectedIndex,
                onDestinationSelected: onDestinationSelected,
                extended: railExtended,
              ),
              const VerticalDivider(width: 1, color: AppColors.hairline),
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
    );
  }
}
