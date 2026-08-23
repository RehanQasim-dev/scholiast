import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Native WebKitGTK texture web view bridge (Linux desktop).
///
/// One method channel serves every view; each view is addressed by an integer
/// id. The native side lives in `linux/webkit_view/`.

const MethodChannel _webkitChannel = MethodChannel('scholiast/webkit_view');

typedef EmbeddedJsHandler = Future<Object?> Function(List<Object?> args);

/// Resolves the absolute path of a bundled Flutter asset on disk (Linux
/// bundles keep `data/flutter_assets` next to the executable).
String embeddedAssetPath(String assetKey) {
  final exeDir = File(Platform.resolvedExecutable).parent.path;
  return '$exeDir/data/flutter_assets/$assetKey';
}

class EmbeddedWebviewController {
  static int _nextId = 1;
  static final Map<int, EmbeddedWebviewController> _views = {};
  static bool _channelBound = false;

  final int id;

  /// Texture id for the [Texture] widget that displays this view.
  late final int textureId;

  bool _loaded = false;
  final List<String> _pendingScripts = [];
  final Map<String, EmbeddedJsHandler> _handlers = {};

  void Function(String message)? onConsoleMessage;
  void Function(String url)? onLoadStop;

  EmbeddedWebviewController._(this.id);

  bool get isPageLoaded => _loaded;

  static Future<EmbeddedWebviewController> create({
    required double width,
    required double height,
    required double devicePixelRatio,
  }) async {
    if (!_channelBound) {
      _webkitChannel.setMethodCallHandler(_onMethodCall);
      _channelBound = true;
    }
    final id = _nextId++;
    final result = await _webkitChannel
        .invokeMethod('create', {
          'id': id,
          'width': (width * devicePixelRatio).round(),
          'height': (height * devicePixelRatio).round(),
        })
        .then((Object? v) => Map<String, dynamic>.from(v as Map));
    final controller = EmbeddedWebviewController._(id)
      ..textureId = result['textureId'] as int;
    _views[id] = controller;
    return controller;
  }

  static Future<dynamic> _onMethodCall(MethodCall call) async {
    switch (call.method) {
      case 'onLoadStop':
        final args = Map<Object?, Object?>.from(call.arguments as Map);
        final c = _views[args['id'] as int];
        if (c != null) {
          c._loaded = true;
          final pending = List<String>.from(c._pendingScripts);
          c._pendingScripts.clear();
          for (final js in pending) {
            c.runJavaScript(js);
          }
          c.onLoadStop?.call(args['url'] as String? ?? '');
        }
        return true;
      case 'callHandler':
        return await _dispatchJsHandler(call.arguments);
      default:
        throw MissingPluginException(call.method);
    }
  }

  static Future<String> _dispatchJsHandler(Object? arguments) async {
    final args = Map<Object?, Object?>.from(arguments as Map);
    final c = _views[args['id'] as int];
    if (c == null) return 'null';
    final payload = jsonDecode(args['payload'] as String) as Map<String, dynamic>;
    final name = payload['n'] as String;
    if (name == '__console__') {
      final list = payload['a'] as List?;
      c.onConsoleMessage?.call(list?.first?.toString() ?? '');
      return 'null';
    }
    final handler = c._handlers[name];
    if (handler == null) return 'null';
    try {
      final rawArgs = <Object?>[
        ...((payload['a'] as List?) ?? const []),
      ];
      // JSON round-trip turns numbers into num/double and maps into
      // Map<String,dynamic>; normalize plain Maps for consumers.
      final normalized = rawArgs.map(_normalize).toList();
      final result = await handler(normalized);
      return result == null ? 'null' : jsonEncode(result);
    } catch (e) {
      debugPrint('[EmbeddedWebView] handler $name failed: $e');
      return 'null';
    }
  }

  static Object? _normalize(Object? v) {
    if (v is Map) return Map<String, dynamic>.from(v);
    return v;
  }

  void registerJavaScriptHandler(String name, EmbeddedJsHandler handler) {
    _handlers[name] = handler;
  }

  /// Evaluates [script]; returns the JSON-encoded result value.
  Future<String> runJavaScriptReturningJson(String script) async {
    final out = await _webkitChannel.invokeMethod('evalJs', {'id': id, 'script': script});
    return out as String? ?? 'null';
  }

  /// Fire-and-forget JS execution; queues until the first page finishes
  /// loading so early commands are not lost (matches the Android host).
  void runJavaScript(String script) {
    if (_loaded) {
      unawaited(runJavaScriptReturningJson(script));
    } else {
      _pendingScripts.add(script);
    }
  }

  void loadUrl(String url) =>
      unawaited(_webkitChannel.invokeMethod('loadUrl', {'id': id, 'url': url}));

  void loadFile(String path) =>
      unawaited(_webkitChannel.invokeMethod('loadFile', {'id': id, 'path': path}));

  void setSize(double width, double height, double devicePixelRatio) {
    unawaited(_webkitChannel.invokeMethod('setSize', {
      'id': id,
      'width': (width * devicePixelRatio).round(),
      'height': (height * devicePixelRatio).round(),
    }));
  }

  void _pointer(String type, Offset local, double dpr, {int buttons = 0}) {
    unawaited(_webkitChannel.invokeMethod('pointer', {
      'id': id,
      'type': type,
      'x': local.dx * dpr,
      'y': local.dy * dpr,
      'buttons': buttons,
    }));
  }

  void _scroll(double dx, double dy, Offset local, double dpr) {
    unawaited(_webkitChannel.invokeMethod('scroll', {
      'id': id,
      'dx': dx,
      'dy': dy,
      'x': local.dx * dpr,
      'y': local.dy * dpr,
    }));
  }

  void _key(KeyEvent event, double dpr) {
    final down = event is KeyDownEvent || event is KeyRepeatEvent;
    final logical = event.logicalKey;
    // GDK keyvals: Unicode keys sit at 0x01000000 | unicode; the specials we
    // need map to their X keysyms.
    int keyval;
    final special = <LogicalKeyboardKey, int>{
      LogicalKeyboardKey.enter: 0xff0d,
      LogicalKeyboardKey.numpadEnter: 0xff0d,
      LogicalKeyboardKey.backspace: 0xff08,
      LogicalKeyboardKey.escape: 0xff1b,
      LogicalKeyboardKey.tab: 0xff09,
      LogicalKeyboardKey.space: 0x0020,
      LogicalKeyboardKey.arrowLeft: 0xff51,
      LogicalKeyboardKey.arrowUp: 0xff52,
      LogicalKeyboardKey.arrowRight: 0xff53,
      LogicalKeyboardKey.arrowDown: 0xff54,
      LogicalKeyboardKey.pageUp: 0xff55,
      LogicalKeyboardKey.pageDown: 0xff56,
      LogicalKeyboardKey.home: 0xff50,
      LogicalKeyboardKey.end: 0xff57,
    };
    final char = event.character;
    if (special.containsKey(logical)) {
      keyval = special[logical]!;
    } else if (char != null && char.isNotEmpty && char.codeUnitAt(0) >= 0x20) {
      keyval = 0x01000000 | char.codeUnitAt(0);
    } else {
      return; // pure modifier presses carry no page-visible meaning
    }

    var state = 0;
    final pressed = HardwareKeyboard.instance.logicalKeysPressed;
    if (pressed.contains(LogicalKeyboardKey.controlLeft) ||
        pressed.contains(LogicalKeyboardKey.controlRight)) {
      state |= 0x4; // GDK_CONTROL_MASK
    }
    if (pressed.contains(LogicalKeyboardKey.shiftLeft) ||
        pressed.contains(LogicalKeyboardKey.shiftRight)) {
      state |= 0x1; // GDK_SHIFT_MASK
    }
    if (pressed.contains(LogicalKeyboardKey.altLeft) ||
        pressed.contains(LogicalKeyboardKey.altRight)) {
      state |= 0x8; // GDK_MOD1_MASK
    }
    if (pressed.contains(LogicalKeyboardKey.metaLeft) ||
        pressed.contains(LogicalKeyboardKey.metaRight)) {
      state |= 0x40; // GDK_META_MASK
    }

    unawaited(_webkitChannel.invokeMethod('key', {
      'id': id,
      'press': down,
      'keyval': keyval,
      'text': down ? char : null,
      'state': state,
    }));
  }

  Future<void> dispose() async {
    _views.remove(id);
    try {
      await _webkitChannel.invokeMethod('destroy', {'id': id});
    } catch (_) {}
  }
}

/// Flutter-side host widget: renders the native texture and forwards pointer,
/// scroll and keyboard input to the offscreen WebKitGTK view.
class EmbeddedWebView extends StatefulWidget {
  final String? initialUrl;
  final String? initialFile;
  final EmbeddedWebviewController? controller;
  final void Function(EmbeddedWebviewController controller)? onControllerCreated;

  const EmbeddedWebView({
    super.key,
    this.initialUrl,
    this.initialFile,
    this.controller,
    this.onControllerCreated,
  });

  @override
  State<EmbeddedWebView> createState() => _EmbeddedWebViewState();
}

class _EmbeddedWebViewState extends State<EmbeddedWebView> {
  EmbeddedWebviewController? _controller;
  Size? _lastSize;

  @override
  void initState() {
    super.initState();
    _maybeCreate(Size.zero);
  }

  Future<void> _maybeCreate(Size size) async {
    if (_controller != null) return;
    final dpr = MediaQuery.maybeDevicePixelRatioOf(context) ??
        View.of(context).devicePixelRatio;
    final w = size.width > 0 ? size.width : 800.0;
    final h = size.height > 0 ? size.height : 600.0;
    final controller = widget.controller ??
        await EmbeddedWebviewController.create(
          width: w,
          height: h,
          devicePixelRatio: dpr,
        );
    if (!mounted) {
      if (widget.controller == null) await controller.dispose();
      return;
    }
    setState(() => _controller = controller);
    widget.onControllerCreated?.call(controller);
    if (widget.initialFile != null) {
      controller.loadFile(widget.initialFile!);
    } else if (widget.initialUrl != null) {
      controller.loadUrl(widget.initialUrl!);
    }
  }

  @override
  void didUpdateWidget(covariant EmbeddedWebView oldWidget) {
    super.didUpdateWidget(oldWidget);
  }

  @override
  void dispose() {
    // Only dispose views we own; injected controllers belong to the caller.
    final owned = _controller;
    if (owned != null && widget.controller == null) {
      owned.dispose();
    }
    super.dispose();
  }

  KeyEventResult _onKeyEvent(FocusNode node, KeyEvent event) {
    final dpr = View.of(context).devicePixelRatio;
    _controller?._key(event, dpr);
    return KeyEventResult.handled;
  }

  @override
  Widget build(BuildContext context) {
    final dpr = View.of(context).devicePixelRatio;
    final controller = _controller;
    return LayoutBuilder(
      builder: (context, constraints) {
        final size = constraints.biggest;
        if (controller != null &&
            _lastSize != null &&
            (_lastSize!.width != size.width ||
                _lastSize!.height != size.height)) {
          controller.setSize(size.width, size.height, dpr);
        }
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) return;
          _lastSize = constraints.biggest;
          _maybeCreate(constraints.biggest);
        });
        final child = controller == null
            ? const SizedBox.expand()
            : Listener(
                behavior: HitTestBehavior.opaque,
                onPointerDown: (e) => controller
                    ._pointer('down', e.localPosition, dpr, buttons: e.buttons),
                onPointerUp: (e) =>
                    controller._pointer('up', e.localPosition, dpr),
                onPointerMove: (e) => controller
                    ._pointer('move', e.localPosition, dpr, buttons: e.buttons),
                onPointerSignal: (e) {
                  if (e is PointerScrollEvent) {
                    controller._scroll(
                        e.scrollDelta.dx, e.scrollDelta.dy, e.localPosition, dpr);
                  }
                },
                child: Texture(textureId: controller.textureId),
              );
        return Focus(autofocus: true, onKeyEvent: _onKeyEvent, child: child);
      },
    );
  }
}
