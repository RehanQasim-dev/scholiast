import 'dart:math' as math;

import '../../../core/models/video_item.dart';

/// The four markup colors — DATA colors that must render identically on every
/// client (desktop, tablet, synced note). Hex values copied verbatim from the
/// desktop's `VIDEO_COLOR_HEX` and the Android [FrameColor] enum (0xFFFACC15
/// yellow, 0xFFFB7185 red, 0xFF4AC582 green, 0xFF000000 black).
enum FrameColor {
  yellow('yellow', 0xFFFACC15),
  red('red', 0xFFFB7185),
  green('green', 0xFF4AC582),
  black('black', 0xFF000000);

  final String json;
  final int argb;
  const FrameColor(this.json, this.argb);

  static FrameColor fromJson(String name) {
    for (final c in FrameColor.values) {
      if (c.json == name) return c;
    }
    return FrameColor.yellow;
  }
}

/// Faithful Dart port of `android/app/src/main/java/com/scholiast/android/ui/frame/MarkupMath.kt`.
///
/// All coordinates that leave this module are normalized 0..1 of the frame's
/// W×H — the shape the desktop stores in `VideoMarkup.points` / line/rect/arrow
/// fields. See `video-storage.ts` / `video-markup.ts` for the exchange format.
abstract final class MarkupMath {
  static const int maxUndo = 50;
  static const double minPencilDp = 2.0;
  static const double maxPencilDp = 10.0;
  static const double highlighterDp = 22.0;
  static const double highlighterAlpha = 0.35;
  static const double minSamplePx = 2.0;
  static const double eraserTolDp = 8.0;

  static const String weightThin = 'thin';
  static const String weightMedium = 'medium';
  static const String weightThick = 'thick';

  // --- Normalization -------------------------------------------------------

  /// Pixel → normalized 0..1 of [size], clamped.
  static double normalize(double x, int size) {
    final s = size < 1 ? 1 : size;
    return (x / s).clamp(0.0, 1.0);
  }

  /// Normalized 0..1 → pixel.
  static double denormalize(double v, int size) {
    final s = size < 1 ? 1 : size;
    return v * s;
  }

  /// Flatten [(x,y)] pairs into the desktop's `[x0,y0,x1,y1,...]` list.
  static List<double> flatten(List<Point> points) {
    final out = <double>[];
    for (final p in points) {
      out.add(p.x);
      out.add(p.y);
    }
    return out;
  }

  /// Normalize a flattened pixel-coordinate list ([x0,y0,x1,y1,...]) to 0..1
  /// of the W×H box — the desktop's `points` array shape.
  static List<double> normalizeFlattened(
      List<double> values, int w, int h) {
    final out = <double>[];
    var i = 0;
    while (i + 1 < values.length) {
      out.add(normalize(values[i], w));
      out.add(normalize(values[i + 1], h));
      i += 2;
    }
    return out;
  }

  /// The inverse of [flatten].
  static List<Point> unflatten(List<double> values) {
    final out = <Point>[];
    var i = 0;
    while (i + 1 < values.length) {
      out.add(Point(values[i], values[i + 1]));
      i += 2;
    }
    return out;
  }

  /// Drop samples closer than [minPx] to the previous kept one.
  static List<Point> filterMinDistance(
    List<Point> points, [
    double minPx = minSamplePx,
  ]) {
    if (points.isEmpty) return points;
    final out = <Point>[points[0]];
    var last = points[0];
    for (var i = 1; i < points.length; i++) {
      final p = points[i];
      if (_dist(p, last) >= minPx) {
        out.add(p);
        last = p;
      }
    }
    return out;
  }

  static double _dist(Point a, Point b) {
    final dx = a.x - b.x;
    final dy = a.y - b.y;
    return math.sqrt(dx * dx + dy * dy);
  }

  // --- Eraser hit-testing --------------------------------------------------

  /// Distance from point (px,py) to segment (ax,ay)-(bx,by).
  static double distToSegment(
    double px,
    double py,
    double ax,
    double ay,
    double bx,
    double by,
  ) {
    final dx = bx - ax;
    final dy = by - ay;
    final len2 = dx * dx + dy * dy;
    var t = len2 != 0.0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0.0;
    t = t.clamp(0.0, 1.0);
    final cx = ax + t * dx;
    final cy = ay + t * dy;
    final ex = px - cx;
    final ey = py - cy;
    return math.sqrt(ex * ex + ey * ey);
  }

  /// True when any segment of [stroke] comes within [tolPx] (view/frame px)
  /// of any point of the eraser path. Whole-stroke removal.
  static bool eraserHits(
    Stroke stroke,
    List<double> eraserPathPx,
    double tolPx,
    int w,
    int h,
  ) {
    if (eraserPathPx.length < 2) return false;
    final pts = stroke.points;
    if (pts.length < 4) return false;
    final segs = <(Point, Point)>[];
    var i = 0;
    while (i + 3 < pts.length) {
      final ax = denormalize(pts[i], w);
      final ay = denormalize(pts[i + 1], h);
      final bx = denormalize(pts[i + 2], w);
      final by = denormalize(pts[i + 3], h);
      segs.add((Point(ax, ay), Point(bx, by)));
      i += 2;
    }
    var j = 0;
    while (j + 1 < eraserPathPx.length) {
      final ex = eraserPathPx[j];
      final ey = eraserPathPx[j + 1];
      for (final seg in segs) {
        final a = seg.$1;
        final b = seg.$2;
        if (distToSegment(ex, ey, a.x, a.y, b.x, b.y) <= tolPx) return true;
      }
      j += 2;
    }
    return false;
  }

  // --- Width / weight mapping ----------------------------------------------

  static double strokeWidthPx(double minPx, double maxPx, double pressure) {
    return minPx + (maxPx - minPx) * pressure.clamp(0.0, 1.0);
  }

  static double pencilWidthPx(double density, double pressure) {
    return strokeWidthPx(
        minPencilDp * density, maxPencilDp * density, pressure);
  }

  static double highlighterWidthPx(double density) =>
      highlighterDp * density;

  static double eraserWidthPx(double density) =>
      (highlighterDp * 1.4) * density;

  static String weightFor(double widthPx, double density) {
    final dp = widthPx / (density < 0.1 ? 0.1 : density);
    if (dp < 4) return weightThin;
    if (dp < 8) return weightMedium;
    return weightThick;
  }

  /// Render weight in px — `base = max(2, W * 0.004)` scaled by weight.
  static double renderWeightPx(String? weight, int canvasWidth) {
    final base = math.max(2.0, (canvasWidth < 1 ? 1 : canvasWidth) * 0.004);
    return switch (weight) {
      weightThin => base * 0.5,
      weightThick => base * 2.0,
      _ => base,
    };
  }
}

/// Simple 2-D point (frame or view pixels — caller tracks the space).
class Point {
  final double x;
  final double y;
  const Point(this.x, this.y);

  @override
  bool operator ==(Object other) =>
      other is Point && x == other.x && y == other.y;

  @override
  int get hashCode => Object.hash(x, y);

  @override
  String toString() => 'Point($x, $y)';
}

/// Undo/redo session over a [VideoMarkup]. Snapshots are immutable data copies,
/// capped at [MarkupMath.maxUndo] like the desktop's `pushUndoSnapshot`.
class MarkupSession {
  VideoMarkup _markup;
  final List<VideoMarkup> _undoStack = [];
  final List<VideoMarkup> _redoStack = [];

  MarkupSession([VideoMarkup? initial]) : _markup = initial ?? VideoMarkup.empty();

  VideoMarkup get markup => _markup;

  bool get canUndo => _undoStack.isNotEmpty;
  bool get canRedo => _redoStack.isNotEmpty;

  bool get hasMarkup =>
      _markup.strokes.isNotEmpty ||
      _markup.lines.isNotEmpty ||
      _markup.texts.isNotEmpty ||
      (_markup.rects != null && _markup.rects!.isNotEmpty) ||
      (_markup.arrows != null && _markup.arrows!.isNotEmpty);

  void pushSnapshot() {
    _undoStack.add(_markup);
    if (_undoStack.length > MarkupMath.maxUndo) _undoStack.removeAt(0);
    _redoStack.clear();
  }

  Stroke commitStroke(
      String id, String color, List<double> points, String weight) {
    pushSnapshot();
    final stroke = Stroke(id: id, color: color, points: points, weight: weight);
    _markup = VideoMarkup(
      strokes: [..._markup.strokes, stroke],
      lines: _markup.lines,
      texts: _markup.texts,
      rects: _markup.rects,
      arrows: _markup.arrows,
    );
    return stroke;
  }

  /// Supports erasing across all vector types: strokes, lines, rects, arrows.
  bool eraseStrokes(
      List<double> eraserPathPx, double tolPx, int w, int h) {
    // For stroke erasure, use the precise segment hit-test.
    // For shapes, use bounding-box / segment proximity.
    final before = _markup;
    final keptStrokes = _markup.strokes
        .where((Stroke s) => !MarkupMath.eraserHits(s, eraserPathPx, tolPx, w, h))
        .toList();

    // Lines: check segment distance.
    List<Line>? keptLines;
    if (_markup.lines.isNotEmpty) {
      keptLines = _markup.lines.where((Line l) {
        final ax = MarkupMath.denormalize(l.x1, w);
        final ay = MarkupMath.denormalize(l.y1, h);
        final bx = MarkupMath.denormalize(l.x2, w);
        final by = MarkupMath.denormalize(l.y2, h);
        for (var j = 0; j + 1 < eraserPathPx.length; j += 2) {
          if (MarkupMath.distToSegment(
                  eraserPathPx[j], eraserPathPx[j + 1], ax, ay, bx, by) <=
              tolPx) {
            return false;
          }
        }
        return true;
      }).toList();
    }

    // Rects: hit if eraser near any edge segment.
    List<Rect>? keptRects;
    if (_markup.rects != null && _markup.rects!.isNotEmpty) {
      keptRects = _markup.rects!.where((Rect r) {
        final x = MarkupMath.denormalize(r.x, w);
        final y = MarkupMath.denormalize(r.y, h);
        final rw = MarkupMath.denormalize(r.w, w);
        final rh = MarkupMath.denormalize(r.h, h);
        final edges = [
          (Point(x, y), Point(x + rw, y)),
          (Point(x + rw, y), Point(x + rw, y + rh)),
          (Point(x + rw, y + rh), Point(x, y + rh)),
          (Point(x, y + rh), Point(x, y)),
        ];
        for (var j = 0; j + 1 < eraserPathPx.length; j += 2) {
          final ex = eraserPathPx[j];
          final ey = eraserPathPx[j + 1];
          for (final e in edges) {
            if (MarkupMath.distToSegment(
                    ex, ey, e.$1.x, e.$1.y, e.$2.x, e.$2.y) <=
                tolPx) {
              return false;
            }
          }
        }
        return true;
      }).toList();
    }

    // Arrows: same as lines.
    List<Arrow>? keptArrows;
    if (_markup.arrows != null && _markup.arrows!.isNotEmpty) {
      keptArrows = _markup.arrows!.where((Arrow a) {
        final ax = MarkupMath.denormalize(a.x1, w);
        final ay = MarkupMath.denormalize(a.y1, h);
        final bx = MarkupMath.denormalize(a.x2, w);
        final by = MarkupMath.denormalize(a.y2, h);
        for (var j = 0; j + 1 < eraserPathPx.length; j += 2) {
          if (MarkupMath.distToSegment(
                  eraserPathPx[j], eraserPathPx[j + 1], ax, ay, bx, by) <=
              tolPx) {
            return false;
          }
        }
        return true;
      }).toList();
    }

    // Text labels: hit if inside expanded bbox.
    List<TextLabel>? keptTexts;
    if (_markup.texts.isNotEmpty) {
      keptTexts = _markup.texts.where((TextLabel t) {
        final tx = MarkupMath.denormalize(t.x, w);
        final ty = MarkupMath.denormalize(t.y, h);
        final tw = MarkupMath.denormalize(t.w, w);
        // Approximate height as 24px scaled.
        const th = 22.0;
        for (var j = 0; j + 1 < eraserPathPx.length; j += 2) {
          final ex = eraserPathPx[j];
          final ey = eraserPathPx[j + 1];
          if (ex >= tx - tolPx &&
              ex <= tx + tw + tolPx &&
              ey >= ty - tolPx &&
              ey <= ty + th + tolPx) {
            return false;
          }
        }
        return true;
      }).toList();
    }

    final strokesChanged = keptStrokes.length != _markup.strokes.length;
    final linesChanged = keptLines != null && keptLines.length != _markup.lines.length;
    final rectsChanged = keptRects != null && keptRects.length != (_markup.rects?.length ?? 0);
    final arrowsChanged = keptArrows != null && keptArrows.length != (_markup.arrows?.length ?? 0);
    final textsChanged = keptTexts != null && keptTexts.length != _markup.texts.length;

    if (!strokesChanged && !linesChanged && !rectsChanged && !arrowsChanged && !textsChanged) {
      return false;
    }
    pushSnapshot();
    _markup = VideoMarkup(
      strokes: keptStrokes,
      lines: keptLines ?? _markup.lines,
      texts: keptTexts ?? _markup.texts,
      rects: keptRects ?? _markup.rects,
      arrows: keptArrows ?? _markup.arrows,
    );
    // Avoid unused variable warning.
    assert(before != _markup);
    return true;
  }

  bool undo() {
    if (_undoStack.isEmpty) return false;
    _redoStack.add(_markup);
    _markup = _undoStack.removeLast();
    return true;
  }

  bool redo() {
    if (_redoStack.isEmpty) return false;
    _undoStack.add(_markup);
    _markup = _redoStack.removeLast();
    return true;
  }

  void clear() {
    if (!hasMarkup) return;
    pushSnapshot();
    _markup = VideoMarkup.empty();
  }

  void reset() {
    _markup = VideoMarkup.empty();
    _undoStack.clear();
    _redoStack.clear();
  }

  void replace(VideoMarkup markup) {
    reset();
    _markup = markup;
  }
}

enum PointerKind { stylus, eraser, finger }

abstract final class PalmRejection {
  static bool acceptDown(PointerKind kind, bool penNear) {
    return kind != PointerKind.finger || !penNear;
  }
}

class PenProximityTracker {
  final Set<int> _hoveringDevices = {};

  bool get penNear => _hoveringDevices.isNotEmpty;

  void onHoverEnter(int deviceId) => _hoveringDevices.add(deviceId);
  void onHoverMove(int deviceId) => _hoveringDevices.add(deviceId);
  void onHoverExit(int deviceId) => _hoveringDevices.remove(deviceId);
}
