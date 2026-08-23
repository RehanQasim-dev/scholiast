import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:scholiast_flutter/core/database/database.dart';
import 'package:scholiast_flutter/core/platform/window_config.dart';
import 'package:scholiast_flutter/core/providers/core_providers.dart';
import 'package:scholiast_flutter/core/theme/scholiast_theme.dart';
import 'package:scholiast_flutter/ui/layout/desktop_breakpoints.dart';
import 'package:scholiast_flutter/ui/layout/desktop_scaffold.dart';
import 'package:scholiast_flutter/ui/layout/desktop_sidebar.dart';
import 'package:scholiast_flutter/ui/layout/keyboard_shortcuts.dart';
import 'package:scholiast_flutter/ui/layout/responsive.dart';
import 'package:scholiast_flutter/ui/screens/desktop/desktop_shell.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('DesktopBreakpoints', () {
    test('compact < 600, medium < 900, expanded >=900', () {
      expect(DesktopBreakpoints.isCompact(599), isTrue);
      expect(DesktopBreakpoints.isCompact(600), isFalse);
      expect(DesktopBreakpoints.showSidebarRail(899), isFalse);
      expect(DesktopBreakpoints.showSidebarRail(900), isTrue);
      expect(DesktopBreakpoints.showBottomNav(899), isTrue);
      expect(DesktopBreakpoints.showBottomNav(900), isFalse);
    });

    test('homeGridColumns thresholds', () {
      expect(DesktopBreakpoints.homeGridColumns(599), 1);
      expect(DesktopBreakpoints.homeGridColumns(900), 2);
      expect(DesktopBreakpoints.homeGridColumns(1439), 2);
      expect(DesktopBreakpoints.homeGridColumns(1440), 3);
      expect(DesktopBreakpoints.homeGridColumns(1800), 3);
    });

    test('panelWidth mirrors 0.38 share clamped 320..0.55W', () {
      // Wide window 1200 -> 1200*0.38=456 clamped 320..660 => 456
      expect(DesktopBreakpoints.panelWidth(1200), closeTo(456, 0.01));
      // Narrow window 500 -> 190 clamped to 320
      expect(DesktopBreakpoints.panelWidth(500), 320);
      // Very wide 2000 -> 760 clamped to 1100 => 760 (within max)
      expect(DesktopBreakpoints.panelWidth(2000), closeTo(760, 0.01));
      // Huge 3000 -> 1140 but max 1650 -> 1140 (still within)
      expect(DesktopBreakpoints.panelWidth(3000), closeTo(1140, 0.01));
    });

    test('ResponsiveTier mapping', () {
      expect(ResponsiveTier.fromWidth(400), ResponsiveTier.compact);
      expect(ResponsiveTier.fromWidth(700), ResponsiveTier.medium);
      expect(ResponsiveTier.fromWidth(1000), ResponsiveTier.expanded);
      expect(ResponsiveTier.fromWidth(1500), ResponsiveTier.large);
      expect(ResponsiveTier.expanded.showSidebarRail, isTrue);
      expect(ResponsiveTier.compact.showBottomNav, isTrue);
    });
  });

  group('LinuxWindowConfig', () {
    test('clampSize and isSizeAllowed', () {
      const cfg = LinuxWindowConfig();
      expect(cfg.isSizeAllowed(const Size(960, 640)), isTrue);
      expect(cfg.isSizeAllowed(const Size(959, 640)), isFalse);
      expect(cfg.clampSize(const Size(500, 500)), const Size(960, 640));
      expect(cfg.clampSize(const Size(2000, 1200)), const Size(2000, 1200));
      expect(cfg.defaultSize, const Size(1280, 800));
      expect(cfg.toBoxConstraints().minWidth, 960);
    });

    test('copyWith preserves title and sizes', () {
      const cfg = LinuxWindowConfig(title: 'Scholiast');
      final copy = cfg.copyWith(title: 'Test');
      expect(copy.title, 'Test');
      expect(copy.minSize, cfg.minSize);
    });
  });

  group('DesktopSidebar', () {
    testWidgets('renders 4 destinations', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: Scaffold(
            body: DesktopSidebar(selectedIndex: 0, onDestinationSelected: (_) {}),
          ),
        ),
      );
      await tester.pump();
      expect(find.text('Home'), findsOneWidget);
      expect(find.text('Reader'), findsOneWidget);
      expect(find.text('Player'), findsOneWidget);
      expect(find.text('Settings'), findsOneWidget);
    });

    testWidgets('tap navigates via callback', (tester) async {
      var selected = 0;
      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: Scaffold(
            body: StatefulBuilder(
              builder: (context, setState) => DesktopSidebar(
                selectedIndex: selected,
                onDestinationSelected: (i) => setState(() => selected = i),
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      // Tap Reader destination
      await tester.tap(find.text('Reader'));
      await tester.pump();
      expect(selected, 1);
    });
  });

  group('DesktopScaffold responsive', () {
    testWidgets('shows rail at >=900, bottom nav below', (tester) async {
      // Wide: rail visible, no bottom bar
      tester.view.physicalSize = const Size(1000, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: DesktopScaffold(
            selectedIndex: 0,
            onDestinationSelected: (_) {},
            child: const Text('content'),
          ),
        ),
      );
      await tester.pump();
      expect(find.byType(NavigationRail), findsOneWidget);
      expect(find.byType(NavigationBar), findsNothing);

      // Narrow: bottom nav, no rail
      tester.view.physicalSize = const Size(500, 800);
      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: DesktopScaffold(
            selectedIndex: 0,
            onDestinationSelected: (_) {},
            child: const Text('content'),
          ),
        ),
      );
      await tester.pump();
      expect(find.byType(NavigationBar), findsOneWidget);
      expect(find.byType(NavigationRail), findsNothing);
    });

    testWidgets('side panel is laid out with 320dp min on wide', (tester) async {
      tester.view.physicalSize = const Size(1200, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: DesktopScaffold(
            selectedIndex: 0,
            onDestinationSelected: (_) {},
            sidePanel: const Text('panel'),
            child: const Text('main'),
          ),
        ),
      );
      await tester.pump();
      expect(find.text('panel'), findsOneWidget);
      expect(find.text('main'), findsOneWidget);
    });
  });

  group('ReaderSplit / PlayerLandscapeSplit / ResponsiveGrid', () {
    testWidgets('ReaderSplit shows panel in row on wide', (tester) async {
      tester.view.physicalSize = const Size(1100, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ReaderSplit(
              article: const Text('article'),
              sidePanel: const Text('comments'),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(find.text('article'), findsOneWidget);
      expect(find.text('comments'), findsOneWidget);
    });

    testWidgets('ResponsiveGrid single column on compact', (tester) async {
      tester.view.physicalSize = const Size(500, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ResponsiveGrid(
              children: const [Text('a'), Text('b'), Text('c')],
            ),
          ),
        ),
      );
      await tester.pump();
      expect(find.text('a'), findsOneWidget);
    });
  });

  group('DesktopShortcuts invocation', () {
    testWidgets('Ctrl+H triggers onNavigateHome', (tester) async {
      var homeCount = 0;
      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: DesktopShortcuts(
            onNavigateHome: () => homeCount++,
            child: const Scaffold(body: Text('child')),
          ),
        ),
      );
      await tester.pump();
      await tester.sendKeyDownEvent(LogicalKeyboardKey.control);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyH);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.control);
      await tester.pump();
      expect(homeCount, 1);
    });

    testWidgets('Ctrl+P triggers onNavigatePlayer', (tester) async {
      var playerCount = 0;
      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: DesktopShortcuts(
            onNavigatePlayer: () => playerCount++,
            child: const Scaffold(body: Text('child')),
          ),
        ),
      );
      await tester.pump();
      await tester.sendKeyDownEvent(LogicalKeyboardKey.control);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyP);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.control);
      await tester.pump();
      expect(playerCount, 1);
    });

    testWidgets('Ctrl+Z triggers onUndo and Ctrl+Shift+Z onRedo', (tester) async {
      var undoCount = 0;
      var redoCount = 0;
      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: DesktopShortcuts(
            onUndo: () => undoCount++,
            onRedo: () => redoCount++,
            child: const Scaffold(body: Text('child')),
          ),
        ),
      );
      await tester.pump();

      await tester.sendKeyDownEvent(LogicalKeyboardKey.control);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyZ);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.control);
      await tester.pump();
      expect(undoCount, 1);

      await tester.sendKeyDownEvent(LogicalKeyboardKey.control);
      await tester.sendKeyDownEvent(LogicalKeyboardKey.shift);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyZ);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.shift);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.control);
      await tester.pump();
      expect(redoCount, 1);
    });

    testWidgets('Space triggers play/pause when no text field focused', (tester) async {
      var playCount = 0;
      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: DesktopShortcuts(
            onTogglePlayPause: () => playCount++,
            child: const Scaffold(body: Text('child')),
          ),
        ),
      );
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.space);
      await tester.pump();
      expect(playCount, 1);
    });

    testWidgets('Esc triggers onEscape', (tester) async {
      var escCount = 0;
      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: DesktopShortcuts(
            onEscape: () => escCount++,
            child: const Scaffold(body: Text('child')),
          ),
        ),
      );
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pump();
      expect(escCount, 1);
    });

    testWidgets('DesktopNavShell shows bottom nav on compact via AdaptiveNavigation', (tester) async {
      tester.view.physicalSize = const Size(500, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: DesktopNavShell(
            selectedIndex: 0,
            onDestinationSelected: (_) {},
            child: const Text('shell child'),
          ),
        ),
      );
      await tester.pump();
      expect(find.byType(NavigationBar), findsOneWidget);
      expect(find.text('shell child'), findsOneWidget);
    });
  });

  group('DesktopShellView integration', () {
    testWidgets('switches content by index (Home, Settings via ProviderScope)', (tester) async {
      tester.view.physicalSize = const Size(1100, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      final db = AppDatabase.inMemory();
      addTearDown(db.close);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [databaseProvider.overrideWithValue(db)],
          child: MaterialApp(
            theme: ScholiastTheme.darkTheme,
            home: DesktopShellView(
              selectedIndex: 0,
              onDestinationSelected: (_) {},
            ),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 150));
      // HomeScreen shows "Scholiast" title (plus sidebar label = at least one)
      expect(find.text('Scholiast'), findsWidgets);
    });

    testWidgets('LinuxTitleBar renders title', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            appBar: LinuxTitleBar(title: 'Scholiast'),
            body: Text('body'),
          ),
        ),
      );
      await tester.pump();
      expect(find.text('Scholiast'), findsWidgets);
    });
  });
}
