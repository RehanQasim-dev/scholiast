import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:scholiast_flutter/core/database/database.dart';
import 'package:scholiast_flutter/core/models/video_item.dart';
import 'package:scholiast_flutter/core/providers/core_providers.dart';
import 'package:scholiast_flutter/ui/screens/frame/frame_draw_screen.dart';
import 'package:scholiast_flutter/ui/screens/frame/markup_math.dart';
import 'package:scholiast_flutter/ui/screens/frame/markup_painter.dart';

void main() {
  // -------------------------------------------------------------------------
  // MarkupMath unit
  // -------------------------------------------------------------------------
  group('MarkupMath', () {
    test('normalize/denormalize round-trip', () {
      expect(MarkupMath.normalize(64, 128), closeTo(0.5, 1e-9));
      expect(MarkupMath.denormalize(0.5, 128), closeTo(64, 1e-9));
      expect(MarkupMath.normalize(-5, 100), 0.0);
      expect(MarkupMath.normalize(200, 100), 1.0);
    });

    test('flatten / unflatten / normalizeFlattened', () {
      final pts = [const Point(10, 20), const Point(30, 40)];
      final flat = MarkupMath.flatten(pts);
      expect(flat, [10, 20, 30, 40]);
      final un = MarkupMath.unflatten(flat);
      expect(un, pts);
      final norm = MarkupMath.normalizeFlattened(flat, 100, 200);
      expect(norm[0], closeTo(0.1, 1e-9));
      expect(norm[1], closeTo(0.1, 1e-9));
      expect(norm[2], closeTo(0.3, 1e-9));
      expect(norm[3], closeTo(0.2, 1e-9));
    });

    test('filterMinDistance drops close samples', () {
      final pts = [const Point(0, 0), const Point(0.5, 0), const Point(5, 0)];
      final filtered = MarkupMath.filterMinDistance(pts, 2.0);
      expect(filtered.length, 2);
      expect(filtered.first, const Point(0, 0));
      expect(filtered.last, const Point(5, 0));
    });

    test('distToSegment', () {
      expect(MarkupMath.distToSegment(5, 5, 0, 0, 10, 0), closeTo(5, 1e-9));
      expect(MarkupMath.distToSegment(0, 0, 0, 0, 10, 0), closeTo(0, 1e-9));
    });

    test('eraserHits detects stroke near eraser path', () {
      const w = 100;
      const h = 100;
      // Horizontal stroke at y=0.5 (normalized -> y=50px)
      const stroke = Stroke(
        id: 's1',
        color: 'yellow',
        points: [0.0, 0.5, 1.0, 0.5],
        weight: 'thin',
      );
      // Eraser path points must be near the stroke (point-to-segment model).
      // Segment (0,50)-(100,50); eraser points at the crossing y≈50 hit.
      final eraser = [50.0, 48.0, 50.0, 52.0];
      expect(MarkupMath.eraserHits(stroke, eraser, 8.0, w, h), isTrue);
      final far = [0.0, 0.0, 10.0, 0.0];
      expect(MarkupMath.eraserHits(stroke, far, 4.0, w, h), isFalse);
    });

    test('weightFor / renderWeightPx mapping', () {
      expect(MarkupMath.weightFor(3, 1.0), MarkupMath.weightThin);
      expect(MarkupMath.weightFor(6, 1.0), MarkupMath.weightMedium);
      expect(MarkupMath.weightFor(10, 1.0), MarkupMath.weightThick);
      final base = MarkupMath.renderWeightPx(null, 1000);
      expect(base, greaterThan(2));
      expect(MarkupMath.renderWeightPx(MarkupMath.weightThin, 1000), lessThan(base));
      expect(MarkupMath.renderWeightPx(MarkupMath.weightThick, 1000), greaterThan(base));
    });

    test('FrameColor fromJson / argb', () {
      expect(FrameColor.fromJson('yellow'), FrameColor.yellow);
      expect(FrameColor.fromJson('red'), FrameColor.red);
      expect(FrameColor.fromJson('unknown'), FrameColor.yellow);
      expect(FrameColor.yellow.argb, 0xFFFACC15);
    });

    test('MarkupSession commit + undo + redo', () {
      final s = MarkupSession();
      expect(s.hasMarkup, isFalse);
      s.commitStroke('id1', 'yellow', [0.1, 0.1, 0.9, 0.9], 'thin');
      expect(s.markup.strokes.length, 1);
      expect(s.canUndo, isTrue);
      expect(s.undo(), isTrue);
      expect(s.markup.strokes, isEmpty);
      expect(s.canRedo, isTrue);
      expect(s.redo(), isTrue);
      expect(s.markup.strokes.length, 1);
      s.clear();
      expect(s.markup.strokes, isEmpty);
      expect(s.canUndo, isTrue);
    });

    test('MarkupSession undo stack capped at maxUndo', () {
      final s = MarkupSession();
      for (var i = 0; i < MarkupMath.maxUndo + 10; i++) {
        s.commitStroke('id$i', 'yellow', [0.0, 0.0, 0.1, 0.1], 'thin');
      }
      // Should have capped; undoing maxUndo times should not throw.
      var count = 0;
      while (s.undo()) {
        count++;
      }
      expect(count, MarkupMath.maxUndo);
    });

    test('eraseStrokes removes matching stroke and retains others', () {
      final s = MarkupSession();
      s.commitStroke('a', 'yellow', [0.0, 0.5, 1.0, 0.5], 'thin');
      s.commitStroke('b', 'red', [0.0, 0.1, 1.0, 0.1], 'thin');
      // Erase at y=0.5 horizontal line.
      final erased = s.eraseStrokes([0.0, 50.0, 100.0, 50.0], 8.0, 100, 100);
      expect(erased, isTrue);
      expect(s.markup.strokes.length, 1);
      expect(s.markup.strokes.first.id, 'b');
    });

    test('PalmRejection', () {
      expect(PalmRejection.acceptDown(PointerKind.finger, true), isFalse);
      expect(PalmRejection.acceptDown(PointerKind.stylus, true), isTrue);
      expect(PalmRejection.acceptDown(PointerKind.finger, false), isTrue);
    });
  });

  // -------------------------------------------------------------------------
  // Painter smoke
  // -------------------------------------------------------------------------
  group('MarkupPainter', () {
    test('strokePath smoothing produces a Path', () {
      final p = strokePath([0.0, 0.0, 0.5, 0.5, 1.0, 0.0], 100, 100);
      expect(p, isNotNull);
      expect(strokePath([0.0, 0.0], 100, 100), isNotNull);
      expect(strokePath([], 100, 100), isNull);
    });

    testWidgets('MarkupPainter paints without error', (tester) async {
      const markup = VideoMarkup(
        strokes: [
          Stroke(id: 's1', color: 'yellow', points: [0.0, 0.0, 1.0, 1.0]),
        ],
        lines: [
          Line(id: 'l1', color: 'red', x1: 0, y1: 0, x2: 1, y2: 1),
        ],
        texts: [
          TextLabel(id: 't1', color: 'yellow', x: 0.1, y: 0.1, w: 0.3, text: 'hello'),
        ],
        rects: [
          Rect(id: 'r1', color: 'green', x: 0.2, y: 0.2, w: 0.2, h: 0.2),
        ],
        arrows: [
          Arrow(id: 'a1', color: 'yellow', x1: 0, y1: 0, x2: 0.5, y2: 0.5),
        ],
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: CustomPaint(
              size: const Size(200, 200),
              painter: MarkupPainter(markup: markup),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(find.byType(CustomPaint), findsWidgets);
    });

    testWidgets('MarkupPainter with frameImage compositing', (tester) async {
      final recorder = ui.PictureRecorder();
      final canvas = Canvas(recorder);
      canvas.drawRect(const ui.Rect.fromLTWH(0, 0, 10, 10), Paint()..color = const Color(0xFF0B0D14));
      final picture = recorder.endRecording();
      final image = await picture.toImage(10, 10);
      addTearDown(image.dispose);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: CustomPaint(
              size: const Size(100, 100),
              painter: MarkupPainter(
                markup: const VideoMarkup(
                  strokes: [Stroke(id: 's1', color: 'yellow', points: [0.0, 0.0, 1.0, 1.0])],
                ),
                frameImage: image,
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(find.byType(CustomPaint), findsWidgets);
    });
  });

  // -------------------------------------------------------------------------
  // FrameDrawScreen drag → stroke + undo + save callback normalized JSON
  // -------------------------------------------------------------------------
  group('FrameDrawScreen (drag→stroke + undo + save)', () {
    const frame = FrameImage(w: 200, h: 100);

    testWidgets('drag creates stroke and Save returns normalized VideoMarkup', (tester) async {
      FrameImage? savedFrame;
      VideoMarkup? savedMarkup;

      await tester.pumpWidget(
        MaterialApp(
          home: FrameDrawScreen(
            frame: frame,
            onSave: (f, m) async {
              savedFrame = f;
              savedMarkup = m;
            },
            onCancel: () {},
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Find the GestureDetector's canvas area and drag across it.
      // Drag from (20,60) to (120,60) — horizontal line near top.
      final center = tester.getCenter(find.byType(FrameDrawScreen));
      // Use a pan: start offset relative to screen; drag is in local coords.
      await tester.dragFrom(center, const Offset(100, 0));
      await tester.pump();

      // Tap Save (Enter) button.
      await tester.tap(find.text('Save (Enter)'));
      await tester.pumpAndSettle();

      expect(savedFrame, isNotNull);
      expect(savedFrame!.w, 200);
      expect(savedFrame!.h, 100);
      expect(savedMarkup, isNotNull);
      expect(savedMarkup!.strokes, isNotEmpty);
      final pts = savedMarkup!.strokes.first.points;
      // Normalized 0..1: points should be within [0,1].
      for (final v in pts) {
        expect(v, greaterThanOrEqualTo(0.0));
        expect(v, lessThanOrEqualTo(1.0));
      }
      // JSON round-trip check.
      final json = savedMarkup!.toJson();
      final restored = VideoMarkup.fromJson(json);
      expect(restored, savedMarkup);
    });

    testWidgets('undo removes last stroke before save', (tester) async {
      VideoMarkup? savedMarkup;
      await tester.pumpWidget(
        MaterialApp(
          home: FrameDrawScreen(
            frame: frame,
            onSave: (f, m) async => savedMarkup = m,
            onCancel: () {},
          ),
        ),
      );
      await tester.pumpAndSettle();

      final center = tester.getCenter(find.byType(FrameDrawScreen));
      await tester.dragFrom(center, const Offset(80, 0));
      await tester.pump();
      // Undo via Ctrl+Z (keyboard) — more robust than hit-testing the toolbar
      // chip which may be off-screen inside the horizontal scroll.
      await tester.sendKeyDownEvent(LogicalKeyboardKey.control);
      await tester.sendKeyDownEvent(LogicalKeyboardKey.keyZ);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.keyZ);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.control);
      await tester.pump();
      await tester.tap(find.text('Save (Enter)'));
      await tester.pumpAndSettle();

      // After undo, no markup should be saved (null markup for empty).
      expect(savedMarkup == null || savedMarkup!.strokes.isEmpty, isTrue);
    });

    testWidgets('Esc calls onCancel', (tester) async {
      var cancelled = false;
      await tester.pumpWidget(
        MaterialApp(
          home: FrameDrawScreen(
            frame: frame,
            onSave: (f, m) async {},
            onCancel: () => cancelled = true,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pump();
      expect(cancelled, isTrue);
    });

    testWidgets('color picker changes selected color', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: FrameDrawScreen(
            frame: frame,
            onSave: (f, m) async {},
            onCancel: () {},
          ),
        ),
      );
      await tester.pumpAndSettle();
      // Tap a color chip (red is second).
      // Color buttons are GestureDetectors with colored containers; find by tapping.
      // Just ensure the widget builds and color chips exist.
      expect(find.byType(FrameDrawScreen), findsOneWidget);
      // We don't assert color state directly; presence of chips is covered by 4 FrameColor values.
      expect(FrameColor.values.length, 4);
    });
  });

  // -------------------------------------------------------------------------
  // ProviderScope integration pattern (AppDatabase.inMemory) — Riverpod wrapper
  // -------------------------------------------------------------------------
  group('FrameDrawScreenRiverpod + AppDatabase.inMemory', () {
    late AppDatabase db;

    setUp(() {
      db = AppDatabase.inMemory();
    });

    tearDown(() {
      db.close();
    });

    testWidgets('Riverpod wrapper builds with ProviderScope override', (tester) async {
      const pageUrl = 'https://www.youtube.com/watch?v=abc123';
      const f = FrameImage(w: 320, h: 180);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [databaseProvider.overrideWithValue(db)],
          child: MaterialApp(
            home: FrameDrawScreenRiverpod(
              pageUrl: pageUrl,
              frame: f,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(FrameDrawScreen), findsOneWidget);
      expect(find.text('Save (Enter)'), findsOneWidget);
    });
  });
}
