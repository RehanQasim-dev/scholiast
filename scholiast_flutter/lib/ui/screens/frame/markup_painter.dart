import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../../core/models/video_item.dart' as vm;
import 'markup_math.dart';

/// CustomPainter rendering a [VideoMarkup] at a given canvas size.
///
/// All markup coords are normalized 0..1 (see [MarkupMath]) — this painter
/// denormalizes them to the [size] it is given, so the same markup repaints
/// correctly over the saved JPEG at any display size.
///
/// When a [frameImage] is supplied it is painted first (letterbox-free, already
/// sized to the canvas). The painter itself does **not** decode JPEG — callers
/// pass a decoded [ui.Image] or paint the frame separately in a stacked
/// widget and use this painter only for the vector overlay.
class MarkupPainter extends CustomPainter {
  final vm.VideoMarkup markup;
  final ui.Image? frameImage;
  final Color? debugBackground;

  MarkupPainter({
    required this.markup,
    this.frameImage,
    this.debugBackground,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width.toInt();
    final h = size.height.toInt();
    if (w <= 0 || h <= 0) return;

    if (debugBackground != null) {
      canvas.drawRect(
        Offset.zero & size,
        Paint()..color = debugBackground!,
      );
    }

    if (frameImage != null) {
      // Draw frame stretched to canvas (caller ensures aspect already matches
      // or that this painter's size equals the frame rect).
      paintImage(
        canvas: canvas,
        rect: Offset.zero & size,
        image: frameImage!,
        fit: BoxFit.fill,
        filterQuality: FilterQuality.medium,
      );
    }

    drawMarkupToCanvas(canvas, markup, w, h, 2.5);
  }

  @override
  bool shouldRepaint(covariant MarkupPainter oldDelegate) {
    return oldDelegate.markup != markup ||
        oldDelegate.frameImage != frameImage;
  }
}

/// Shared renderer: draws [markup] onto [canvas] at W×H pixels.
/// Ported from `drawMarkupTo` in `android/ui/frame/MarkupView.kt` and the
/// desktop's `renderMarkupSvg` (`src/utils/video/video-markup.ts`).
void drawMarkupToCanvas(
  Canvas canvas,
  vm.VideoMarkup markup,
  int w,
  int h,
  double density,
) {
  if (w <= 0 || h <= 0) return;

  final paint = Paint()
    ..isAntiAlias = true
    ..style = PaintingStyle.stroke
    ..strokeCap = StrokeCap.round
    ..strokeJoin = StrokeJoin.round;

  for (final stroke in markup.strokes) {
    final path = strokePath(stroke.points, w, h);
    if (path == null) continue;
    paint.color = Color(FrameColor.fromJson(stroke.color).argb);
    paint.strokeWidth = MarkupMath.renderWeightPx(stroke.weight, w);
    // Highlighter heuristic: wide weight + optional alpha could be encoded;
    // for now render opaque. If highlighter alpha is needed, encode via color
    // or extend Stroke model.
    canvas.drawPath(path, paint);
  }

  for (final line in markup.lines) {
    paint.color = Color(FrameColor.fromJson(line.color).argb);
    paint.strokeWidth = MarkupMath.renderWeightPx(line.weight, w);
    canvas.drawLine(
      Offset(MarkupMath.denormalize(line.x1, w),
          MarkupMath.denormalize(line.y1, h)),
      Offset(MarkupMath.denormalize(line.x2, w),
          MarkupMath.denormalize(line.y2, h)),
      paint,
    );
  }

  for (final text in markup.texts) {
    _drawTextLabel(canvas, text, w, h, density, paint);
  }

  for (final rect in markup.rects ?? const <vm.Rect>[]) {
    paint.color = Color(FrameColor.fromJson(rect.color).argb);
    paint.strokeWidth = MarkupMath.renderWeightPx(rect.weight, w);
    canvas.drawRect(
      Rect.fromLTWH(
        MarkupMath.denormalize(rect.x, w),
        MarkupMath.denormalize(rect.y, h),
        MarkupMath.denormalize(rect.w, w),
        MarkupMath.denormalize(rect.h, h),
      ),
      paint,
    );
  }

  for (final arrow in markup.arrows ?? const <vm.Arrow>[]) {
    _drawArrow(canvas, arrow, w, h, paint);
  }
}

/// Smoothed path through normalized stroke points (desktop `strokePath`).
Path? strokePath(List<double> points, int w, int h) {
  if (points.length < 2) return null;
  double px(int i) => MarkupMath.denormalize(points[i], w);
  double py(int i) => MarkupMath.denormalize(points[i + 1], h);

  final path = Path();
  path.moveTo(px(0), py(0));
  if (points.length < 6) {
    var i = 2;
    while (i < points.length) {
      path.lineTo(px(i), py(i));
      i += 2;
    }
    return path;
  }
  var i = 2;
  while (i < points.length - 2) {
    final xc = (px(i) + px(i + 2)) / 2;
    final yc = (py(i) + py(i + 2)) / 2;
    path.quadraticBezierTo(px(i), py(i), xc, yc);
    i += 2;
  }
  path.lineTo(px(points.length - 2), py(points.length - 2));
  return path;
}

void _drawTextLabel(
  Canvas canvas,
  vm.TextLabel text,
  int w,
  int h,
  double density,
  Paint paint,
) {
  final boxW = (text.w > 0 ? text.w : 0.28) * w;
  final fontSize = math.max(11.0, h * 0.034) * (text.size ?? 1.0);
  final color = Color(FrameColor.fromJson(text.color).argb);
  final shadowColor =
      text.color == FrameColor.black.json ? const Color(0xB3FFFFFF) : const Color(0xB3000000);

  // Use TextPainter for wrapping semantics (unlike the pure-raster path in
  // MarkupView.kt which is single-line). Honors boxW.
  final tp = TextPainter(
    text: TextSpan(
      text: text.text,
      style: TextStyle(
        color: color,
        fontSize: fontSize,
        shadows: [
          Shadow(color: shadowColor, blurRadius: 2 * density, offset: const Offset(0, 1)),
        ],
      ),
    ),
    textDirection: TextDirection.ltr,
    maxLines: 20,
  )..layout(maxWidth: boxW > 0 ? boxW : w.toDouble());

  final x = MarkupMath.denormalize(text.x, w);
  final y = MarkupMath.denormalize(text.y, h);
  tp.paint(canvas, Offset(x, y));
}

void _drawArrow(Canvas canvas, vm.Arrow arrow, int w, int h, Paint paint) {
  final x1 = MarkupMath.denormalize(arrow.x1, w);
  final y1 = MarkupMath.denormalize(arrow.y1, h);
  final x2 = MarkupMath.denormalize(arrow.x2, w);
  final y2 = MarkupMath.denormalize(arrow.y2, h);
  paint.color = Color(FrameColor.fromJson(arrow.color).argb);
  final strokeWidth = MarkupMath.renderWeightPx(arrow.weight, w);
  paint.strokeWidth = strokeWidth;
  canvas.drawLine(Offset(x1, y1), Offset(x2, y2), paint);

  final angle = math.atan2(y2 - y1, x2 - x1);
  final headLen = math.max(10.0, strokeWidth * 4);
  final a1 = angle - math.pi / 6;
  final a2 = angle + math.pi / 6;
  final hx1 = x2 - headLen * math.cos(a1);
  final hy1 = y2 - headLen * math.sin(a1);
  final hx2 = x2 - headLen * math.cos(a2);
  final hy2 = y2 - headLen * math.sin(a2);
  final head = Path()
    ..moveTo(hx1, hy1)
    ..lineTo(x2, y2)
    ..lineTo(hx2, hy2);
  canvas.drawPath(head, paint);
}

/// Render markup+optional frame into a JPEG byte array at the frame's natural
/// pixel size via [PictureRecorder]. Used by the save path to produce the
/// composite that replaces the original JPEG when markup exists.
Future<List<int>> renderMarkupToJpeg({
  required vm.VideoMarkup markup,
  required int width,
  required int height,
  ui.Image? frameImage,
  double density = 2.5,
}) async {
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  if (frameImage != null) {
    paintImage(
      canvas: canvas,
      rect: Rect.fromLTWH(0, 0, width.toDouble(), height.toDouble()),
      image: frameImage,
      fit: BoxFit.fill,
      filterQuality: FilterQuality.medium,
    );
  } else {
    canvas.drawRect(
      Rect.fromLTWH(0, 0, width.toDouble(), height.toDouble()),
      Paint()..color = const Color(0xFF0B0D14),
    );
  }
  drawMarkupToCanvas(canvas, markup, width, height, density);
  final picture = recorder.endRecording();
  final img = await picture.toImage(width, height);
  final byteData = await img.toByteData(format: ui.ImageByteFormat.png);
  // Encode as PNG bytes here; caller may re-encode to JPEG if needed.
  // PNG is lossless and avoids a second JPEG codec dependency. FrameStore
  // accepts any bytes — the original JPEG path uses JPEG; this composite is
  // typically stored as JPEG but PNG bytes are still a valid image. For
  // strict JPEG, wrap with `image` package or platform encoder.
  return byteData!.buffer.asUint8List();
}
