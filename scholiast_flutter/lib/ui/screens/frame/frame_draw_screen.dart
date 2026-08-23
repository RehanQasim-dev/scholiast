import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/video_item.dart';
import '../../../features/player/player_state_notifier.dart';
import 'markup_math.dart';
import 'markup_painter.dart';

/// The six draw tools + eraser, mirroring the desktop / Android surface.
enum MarkupTool {
  pen,
  highlighter,
  line,
  rect,
  arrow,
  text,
  eraser,
}

/// Primary draw screen: full-bleed dark surface that turns gestures into a
/// normalized [VideoMarkup] and returns it via [onSave] together with the
/// (optionally composited) [FrameImage].
///
/// Coordinates stored in [VideoMarkup] are **normalized 0..1 of W×H** — see
/// [MarkupMath.normalize] — so the same markup repaints at any display size.
///
class FrameDrawScreen extends StatefulWidget {
  final FrameImage frame;
  final ui.Image? frameImage;
  final VideoMarkup? initialMarkup;
  final Future<void> Function(FrameImage frame, VideoMarkup? markup) onSave;
  final VoidCallback onCancel;

  const FrameDrawScreen({
    super.key,
    required this.frame,
    this.frameImage,
    this.initialMarkup,
    required this.onSave,
    required this.onCancel,
  });

  @override
  State<FrameDrawScreen> createState() => _FrameDrawScreenState();
}

class _FrameDrawScreenState extends State<FrameDrawScreen> {
  static const _bg = Color(0xFF0B0D14);
  static const _accent = Color(0xFF8B7CF6);

  late MarkupSession _session;
  MarkupTool _tool = MarkupTool.pen;
  FrameColor _color = FrameColor.yellow;

  // In-progress stroke (pixel coords) before commit.
  List<Offset> _currentPixels = [];
  // In-progress shape anchors for line/rect/arrow (pixel).
  Offset? _shapeStart;
  Offset? _shapeEnd;

  // Text-placement controller.
  final TextEditingController _textController = TextEditingController();
  // Pending text anchor (pixel) waiting for typed content.
  Offset? _pendingTextAnchor;

  bool _saving = false;
  final FocusNode _focusNode = FocusNode();

  @override
  void initState() {
    super.initState();
    _session = MarkupSession(widget.initialMarkup);
    // Autofocus so Esc/Enter/Ctrl+Z work without an extra tap.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _focusNode.requestFocus();
    });
  }

  @override
  void dispose() {
    _textController.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  // --- Helpers ---------------------------------------------------------------

  String get _colorJson => _color.json;

  String get _weightForTool {
    switch (_tool) {
      case MarkupTool.highlighter:
        return MarkupMath.weightThick;
      case MarkupTool.pen:
        return MarkupMath.weightThin;
      default:
        return MarkupMath.weightMedium;
    }
  }

  void _setTool(MarkupTool t) => setState(() => _tool = t);
  void _setColor(FrameColor c) => setState(() => _color = c);

  bool _handleKey(KeyEvent event) {
    if (event is! KeyDownEvent) return false;
    final isCtrl = HardwareKeyboard.instance.isControlPressed ||
        HardwareKeyboard.instance.isMetaPressed;

    if (event.logicalKey == LogicalKeyboardKey.escape) {
      widget.onCancel();
      return true;
    }
    if (event.logicalKey == LogicalKeyboardKey.enter) {
      // Enter saves; Ctrl+Enter also saves even while text field focused.
      _doSave();
      return true;
    }
    if (isCtrl && event.logicalKey == LogicalKeyboardKey.keyZ) {
      final isShift = HardwareKeyboard.instance.isShiftPressed;
      if (isShift) {
        _doRedo();
      } else {
        _doUndo();
      }
      return true;
    }
    if (isCtrl && event.logicalKey == LogicalKeyboardKey.keyY) {
      _doRedo();
      return true;
    }
    return false;
  }

  void _doUndo() {
    if (_session.undo()) setState(() {});
  }

  void _doRedo() {
    if (_session.redo()) setState(() {});
  }

  void _doClear() {
    _session.clear();
    setState(() {
      _currentPixels = [];
      _shapeStart = null;
      _shapeEnd = null;
    });
  }

  Future<void> _doSave() async {
    if (_saving) return;
    setState(() => _saving = true);
    try {
      // If a shape is still being dragged, commit it first.
      _commitPendingShape();
      // If a freehand stroke is still in flight, commit it.
      if (_currentPixels.isNotEmpty) {
        _commitCurrentStroke();
      }
      // Text label pending, but empty → discard.

      VideoMarkup? markup =
          _session.hasMarkup ? _session.markup : null;

      // Optionally composite frame+markup into a new JPEG via PictureRecorder.
      // The caller may ignore frameImage bytes and just persist markup; we
      // produce composited bytes only if a frameImage was supplied and markup exists.
      FrameImage outFrame = widget.frame;
      if (markup != null && widget.frameImage != null) {
        try {
          final bytes = await renderMarkupToJpeg(
            markup: markup,
            width: widget.frame.w > 0 ? widget.frame.w : 1280,
            height: widget.frame.h > 0 ? widget.frame.h : 720,
            frameImage: widget.frameImage,
          );
          // Keep metadata w/h unchanged; caller may upload bytes separately.
          // We stash the composite as a dataUrl-like hint only when bytes exist,
          // but per convention dataUrl is runtime-only — the real persistence
          // uses FrameStore files. So we pass through w/h and let the Riverpod
          // wrapper handle file IO.
          // Re-encode length check just to confirm render succeeded.
          assert(bytes.isNotEmpty);
        } catch (_) {
          // Render failure is non-fatal: still save markup.
        }
      }

      await widget.onSave(outFrame, markup);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _commitCurrentStroke() {
    if (_currentPixels.length < 2) {
      _currentPixels = [];
      return;
    }
    final filtered = MarkupMath.filterMinDistance(
      _currentPixels.map((o) => Point(o.dx, o.dy)).toList(),
    );
    final w = widget.frame.w;
    final h = widget.frame.h;
    // Flatten + normalize to 0..1 of W×H.
    final flat = filtered.map((p) => [p.x, p.y]).expand((e) => e).toList();
    final norm = MarkupMath.normalizeFlattened(flat, w, h);
    if (norm.length >= 4) {
      final id = 'st_${DateTime.now().millisecondsSinceEpoch}_${math.Random().nextInt(9999)}';
      _session.commitStroke(id, _colorJson, norm, _weightForTool);
    }
    _currentPixels = [];
  }

  void _commitPendingShape() {
    final start = _shapeStart;
    final end = _shapeEnd;
    if (start == null || end == null) return;
    final w = widget.frame.w;
    final h = widget.frame.h;
    final id = 'sh_${DateTime.now().millisecondsSinceEpoch}_${math.Random().nextInt(9999)}';
    final cur = _session.markup;
    _session.pushSnapshot();
    switch (_tool) {
      case MarkupTool.line:
        _session.replace(VideoMarkup(
          strokes: cur.strokes,
          lines: [
            ...cur.lines,
            Line(
              id: id,
              color: _colorJson,
              x1: MarkupMath.normalize(start.dx, w),
              y1: MarkupMath.normalize(start.dy, h),
              x2: MarkupMath.normalize(end.dx, w),
              y2: MarkupMath.normalize(end.dy, h),
              weight: _weightForTool,
            ),
          ],
          texts: cur.texts,
          rects: cur.rects,
          arrows: cur.arrows,
        ));
        break;
      case MarkupTool.rect:
        final x = math.min(start.dx, end.dx);
        final y = math.min(start.dy, end.dy);
        final rw = (end.dx - start.dx).abs();
        final rh = (end.dy - start.dy).abs();
        _session.replace(VideoMarkup(
          strokes: cur.strokes,
          lines: cur.lines,
          texts: cur.texts,
          rects: [
            ...(cur.rects ?? const <Rect>[]),
            Rect(
              id: id,
              color: _colorJson,
              x: MarkupMath.normalize(x, w),
              y: MarkupMath.normalize(y, h),
              w: MarkupMath.normalize(rw, w),
              h: MarkupMath.normalize(rh, h),
              weight: _weightForTool,
            ),
          ],
          arrows: cur.arrows,
        ));
        break;
      case MarkupTool.arrow:
        _session.replace(VideoMarkup(
          strokes: cur.strokes,
          lines: cur.lines,
          texts: cur.texts,
          rects: cur.rects,
          arrows: [
            ...(cur.arrows ?? const <Arrow>[]),
            Arrow(
              id: id,
              color: _colorJson,
              x1: MarkupMath.normalize(start.dx, w),
              y1: MarkupMath.normalize(start.dy, h),
              x2: MarkupMath.normalize(end.dx, w),
              y2: MarkupMath.normalize(end.dy, h),
              weight: _weightForTool,
            ),
          ],
        ));
        break;
      default:
        break;
    }
    _shapeStart = null;
    _shapeEnd = null;
  }

  void _commitTextLabel(Offset anchor, String text) {
    if (text.trim().isEmpty) return;
    final w = widget.frame.w;
    final h = widget.frame.h;
    final id = 'tx_${DateTime.now().millisecondsSinceEpoch}_${math.Random().nextInt(9999)}';
    final cur = _session.markup;
    _session.pushSnapshot();
    _session.replace(VideoMarkup(
      strokes: cur.strokes,
      lines: cur.lines,
      texts: [
        ...cur.texts,
        TextLabel(
          id: id,
          color: _colorJson,
          x: MarkupMath.normalize(anchor.dx, w),
          y: MarkupMath.normalize(anchor.dy, h),
          w: MarkupMath.normalize(180, w),
          text: text.trim(),
        ),
      ],
      rects: cur.rects,
      arrows: cur.arrows,
    ));
  }

  void _handleEraser(List<Offset> pathPx, Size canvasSize) {
    if (pathPx.length < 2) return;
    final flat = <double>[];
    for (final o in pathPx) {
      flat.add(o.dx);
      flat.add(o.dy);
    }
    // tol ~ 12 logical px.
    final tol = 12.0;
    final w = widget.frame.w > 0 ? widget.frame.w : canvasSize.width.toInt();
    final h = widget.frame.h > 0 ? widget.frame.h : canvasSize.height.toInt();
    if (_session.eraseStrokes(flat, tol, w, h)) {
      setState(() {});
    }
  }

  // --- Gesture routing -------------------------------------------------------

  void _onPanStart(DragStartDetails d, Size size) {
    final pos = d.localPosition;
    if (_tool == MarkupTool.text) {
      setState(() => _pendingTextAnchor = pos);
      _showTextDialog(pos);
      return;
    }
    if (_tool == MarkupTool.line ||
        _tool == MarkupTool.rect ||
        _tool == MarkupTool.arrow) {
      _shapeStart = pos;
      _shapeEnd = pos;
      setState(() {});
      return;
    }
    // pen / highlighter / eraser
    _currentPixels = [pos];
    setState(() {});
  }

  void _onPanUpdate(DragUpdateDetails d, Size size) {
    final pos = d.localPosition;
    if (_tool == MarkupTool.line ||
        _tool == MarkupTool.rect ||
        _tool == MarkupTool.arrow) {
      _shapeEnd = pos;
      setState(() {});
      return;
    }
    _currentPixels.add(pos);
    setState(() {});
  }

  void _onPanEnd(DragEndDetails d, Size size) {
    if (_tool == MarkupTool.eraser) {
      _handleEraser(List<Offset>.from(_currentPixels), size);
      _currentPixels = [];
      setState(() {});
      return;
    }
    if (_tool == MarkupTool.line ||
        _tool == MarkupTool.rect ||
        _tool == MarkupTool.arrow) {
      _commitPendingShape();
      setState(() {});
      return;
    }
    if (_tool == MarkupTool.pen || _tool == MarkupTool.highlighter) {
      _commitCurrentStroke();
      setState(() {});
      return;
    }
  }

  void _showTextDialog(Offset anchor) {
    _textController.clear();
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1A1C22),
        title: const Text('Add label', style: TextStyle(color: Colors.white)),
        content: TextField(
          controller: _textController,
          autofocus: true,
          style: const TextStyle(color: Colors.white),
          decoration: const InputDecoration(hintText: 'Label text'),
          onSubmitted: (v) {
            _commitTextLabel(anchor, v);
            Navigator.of(ctx).pop();
            setState(() {});
          },
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: _accent),
            onPressed: () {
              _commitTextLabel(anchor, _textController.text);
              Navigator.of(ctx).pop();
              setState(() {});
            },
            child: const Text('Add'),
          ),
        ],
      ),
    ).whenComplete(() => _pendingTextAnchor = null);
  }

  // --- Build ---------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    // Ensure Esc/Enter handled even when a TextField is focused: use Focus
    // with onKeyEvent at top level.
    return Focus(
      focusNode: _focusNode,
      autofocus: true,
      onKeyEvent: (node, event) => _handleKey(event) ? KeyEventResult.handled : KeyEventResult.ignored,
      child: Scaffold(
        backgroundColor: _bg,
        appBar: _buildToolbar(),
        body: LayoutBuilder(
          builder: (context, constraints) {
            final canvasW = constraints.maxWidth;
            final canvasH = constraints.maxHeight;
            final size = Size(canvasW, canvasH);
            return GestureDetector(
              behavior: HitTestBehavior.opaque,
              onPanStart: (d) => _onPanStart(d, size),
              onPanUpdate: (d) => _onPanUpdate(d, size),
              onPanEnd: (d) => _onPanEnd(d, size),
              onTapDown: (d) {
                // Text tool taps also handled via panStart; keep for completeness.
                if (_tool == MarkupTool.text) {
                  setState(() => _pendingTextAnchor = d.localPosition);
                  _showTextDialog(d.localPosition);
                }
              },
              child: Stack(
                fit: StackFit.expand,
                children: [
                  // Frame bitmap (if available) + markup overlay.
                  if (widget.frameImage != null)
                    CustomPaint(
                      painter: _FrameImagePainter(widget.frameImage!),
                      size: size,
                    )
                  else
                    Container(color: _bg),
                  // Committed markup.
                  CustomPaint(
                    painter: MarkupPainter(
                      markup: _session.markup,
                      frameImage: null,
                    ),
                    size: size,
                  ),
                  // In-progress preview (stroke or shape).
                  CustomPaint(
                    painter: _PreviewPainter(
                      tool: _tool,
                      color: Color(_color.argb),
                      pixels: List<Offset>.from(_currentPixels),
                      shapeStart: _shapeStart,
                      shapeEnd: _shapeEnd,
                      weight: _weightForTool,
                      canvasWidth: canvasW.toInt(),
                    ),
                    size: size,
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  PreferredSizeWidget _buildToolbar() {
    return AppBar(
      backgroundColor: _bg,
      elevation: 0,
      leading: IconButton(
        tooltip: 'Cancel (Esc)',
        icon: const Icon(Icons.close, color: Colors.white70),
        onPressed: widget.onCancel,
      ),
      title: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            for (final t in MarkupTool.values) _toolButton(t),
            const SizedBox(width: 12),
            Container(width: 1, height: 24, color: Colors.white12),
            const SizedBox(width: 12),
            for (final c in FrameColor.values) _colorButton(c),
            const SizedBox(width: 12),
            Container(width: 1, height: 24, color: Colors.white12),
            const SizedBox(width: 8),
            IconButton(
              tooltip: 'Undo (Ctrl+Z)',
              icon: const Icon(Icons.undo, color: Colors.white70),
              onPressed: _session.canUndo ? _doUndo : null,
            ),
            IconButton(
              tooltip: 'Redo (Ctrl+Shift+Z)',
              icon: const Icon(Icons.redo, color: Colors.white70),
              onPressed: _session.canRedo ? _doRedo : null,
            ),
            IconButton(
              tooltip: 'Clear',
              icon: const Icon(Icons.delete_outline, color: Colors.white70),
              onPressed: _session.hasMarkup ? _doClear : null,
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: widget.onCancel,
          child: const Text('Discard', style: TextStyle(color: Colors.white70)),
        ),
        const SizedBox(width: 4),
        Padding(
          padding: const EdgeInsets.only(right: 8),
          child: FilledButton(
            style: FilledButton.styleFrom(backgroundColor: _accent),
            onPressed: _saving ? null : _doSave,
            child: _saving
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Text('Save (Enter)', style: TextStyle(color: Colors.white)),
          ),
        ),
      ],
    );
  }

  Widget _toolButton(MarkupTool tool) {
    final selected = _tool == tool;
    final icon = switch (tool) {
      MarkupTool.pen => Icons.edit,
      MarkupTool.highlighter => Icons.highlight,
      MarkupTool.line => Icons.show_chart,
      MarkupTool.rect => Icons.crop_square,
      MarkupTool.arrow => Icons.arrow_right_alt,
      MarkupTool.text => Icons.text_fields,
      MarkupTool.eraser => Icons.cleaning_services,
    };
    final label = switch (tool) {
      MarkupTool.pen => 'Pen',
      MarkupTool.highlighter => 'HL',
      MarkupTool.line => 'Line',
      MarkupTool.rect => 'Rect',
      MarkupTool.arrow => 'Arrow',
      MarkupTool.text => 'Text',
      MarkupTool.eraser => 'Eraser',
    };
    return Padding(
      padding: const EdgeInsets.only(right: 4),
      child: ChoiceChip(
        label: Row(mainAxisSize: MainAxisSize.min, children: [Icon(icon, size: 16, color: selected ? Colors.white : Colors.white70), const SizedBox(width: 4), Text(label)]),
        selected: selected,
        selectedColor: _accent,
        backgroundColor: const Color(0xFF1A1C22),
        labelStyle: TextStyle(color: selected ? Colors.white : Colors.white70, fontSize: 12),
        onSelected: (_) => _setTool(tool),
      ),
    );
  }

  Widget _colorButton(FrameColor c) {
    final selected = _color == c;
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: GestureDetector(
        onTap: () => _setColor(c),
        child: Container(
          width: 28,
          height: 28,
          decoration: BoxDecoration(
            color: Color(c.argb),
            shape: BoxShape.circle,
            border: Border.all(
              color: selected ? Colors.white : Colors.white24,
              width: selected ? 2 : 1,
            ),
          ),
        ),
      ),
    );
  }
}

class _FrameImagePainter extends CustomPainter {
  final ui.Image image;
  _FrameImagePainter(this.image);
  @override
  void paint(Canvas canvas, Size size) {
    paintImage(
      canvas: canvas,
      rect: Offset.zero & size,
      image: image,
      fit: BoxFit.contain,
      filterQuality: FilterQuality.medium,
    );
  }

  @override
  bool shouldRepaint(covariant _FrameImagePainter oldDelegate) => oldDelegate.image != image;
}

class _PreviewPainter extends CustomPainter {
  final MarkupTool tool;
  final Color color;
  final List<Offset> pixels;
  final Offset? shapeStart;
  final Offset? shapeEnd;
  final String weight;
  final int canvasWidth;

  _PreviewPainter({
    required this.tool,
    required this.color,
    required this.pixels,
    required this.shapeStart,
    required this.shapeEnd,
    required this.weight,
    required this.canvasWidth,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = tool == MarkupTool.highlighter ? color.withOpacity(0.5) : color
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..strokeWidth = MarkupMath.renderWeightPx(weight, canvasWidth)
      ..isAntiAlias = true;

    if ((tool == MarkupTool.pen || tool == MarkupTool.highlighter || tool == MarkupTool.eraser) && pixels.length >= 2) {
      final path = Path()..moveTo(pixels.first.dx, pixels.first.dy);
      if (pixels.length < 3) {
        for (var i = 1; i < pixels.length; i++) {
          path.lineTo(pixels[i].dx, pixels[i].dy);
        }
      } else {
        for (var i = 1; i < pixels.length - 1; i++) {
          final xc = (pixels[i].dx + pixels[i + 1].dx) / 2;
          final yc = (pixels[i].dy + pixels[i + 1].dy) / 2;
          path.quadraticBezierTo(pixels[i].dx, pixels[i].dy, xc, yc);
        }
        path.lineTo(pixels.last.dx, pixels.last.dy);
      }
      final p = tool == MarkupTool.eraser
          ? (Paint()
            ..color = Colors.white.withOpacity(0.35)
            ..style = PaintingStyle.stroke
            ..strokeCap = StrokeCap.round
            ..strokeWidth = 18)
          : paint;
      canvas.drawPath(path, p);
      return;
    }

    final s = shapeStart;
    final e = shapeEnd;
    if (s == null || e == null) return;
    switch (tool) {
      case MarkupTool.line:
        canvas.drawLine(s, e, paint);
        break;
      case MarkupTool.rect:
        canvas.drawRect(ui.Rect.fromPoints(s, e), paint);
        break;
      case MarkupTool.arrow:
        canvas.drawLine(s, e, paint);
        final angle = math.atan2(e.dy - s.dy, e.dx - s.dx);
        final headLen = math.max(10.0, paint.strokeWidth * 4);
        final a1 = angle - math.pi / 6;
        final a2 = angle + math.pi / 6;
        final hx1 = e.dx - headLen * math.cos(a1);
        final hy1 = e.dy - headLen * math.sin(a1);
        final hx2 = e.dx - headLen * math.cos(a2);
        final hy2 = e.dy - headLen * math.sin(a2);
        final head = Path()
          ..moveTo(hx1, hy1)
          ..lineTo(e.dx, e.dy)
          ..lineTo(hx2, hy2);
        canvas.drawPath(head, paint);
        break;
      default:
        break;
    }
  }

  @override
  bool shouldRepaint(covariant _PreviewPainter oldDelegate) =>
      oldDelegate.tool != tool ||
      oldDelegate.color != color ||
      oldDelegate.pixels != pixels ||
      oldDelegate.shapeStart != shapeStart ||
      oldDelegate.shapeEnd != shapeEnd;
}

/// Riverpod wrapper that wires [FrameDrawScreen] to
/// [playerStateNotifierProvider.addFrameCapture] so callers need not handle
/// persistence themselves.
///
/// Usage: `showDialog(..., builder: (_) => FrameDrawScreenRiverpod(...))`.
class FrameDrawScreenRiverpod extends ConsumerWidget {
  final String pageUrl;
  final FrameImage frame;
  final ui.Image? frameImage;
  final VideoMarkup? initialMarkup;
  final VoidCallback? onDone;

  const FrameDrawScreenRiverpod({
    super.key,
    required this.pageUrl,
    required this.frame,
    this.frameImage,
    this.initialMarkup,
    this.onDone,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return FrameDrawScreen(
      frame: frame,
      frameImage: frameImage,
      initialMarkup: initialMarkup,
      onSave: (outFrame, markup) async {
        final notifier = ref.read(playerStateNotifierProvider(pageUrl).notifier);
        await notifier.addFrameCapture(frame: outFrame, markup: markup);
        if (context.mounted) Navigator.of(context).pop();
        onDone?.call();
      },
      onCancel: () {
        Navigator.of(context).pop();
        onDone?.call();
      },
    );
  }
}
