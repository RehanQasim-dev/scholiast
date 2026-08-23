import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'package:scholiast_flutter/core/models/page_highlight.dart';
import 'package:scholiast_flutter/core/webkit/embedded_webview.dart';

import 'reader_web_controller.dart';
import 'reader_web_view_host.dart' show
    HighlightCreatedCallback,
    HighlightCallback,
    LinkTapCallback,
    ScrollCallback,
    SelectionCallback;

/// Linux implementation of [ReaderWebViewHost]'s web surface: an offscreen
/// WebKitGTK texture view with the same JS bridge contract as Android.
class LinuxReaderWebView extends StatefulWidget {
  final String url;
  final ValueChanged<bool>? onReady;
  final HighlightCreatedCallback? onHighlightCreated;
  final HighlightCallback? onHighlightUpdated;
  final HighlightCallback? onHighlightDeleted;
  final LinkTapCallback? onLinkTap;
  final ScrollCallback? onScrollPct;
  final SelectionCallback? onSelectionState;
  final void Function(LinuxReaderWebController controller)? onControllerCreated;

  const LinuxReaderWebView({
    super.key,
    required this.url,
    this.onReady,
    this.onHighlightCreated,
    this.onHighlightUpdated,
    this.onHighlightDeleted,
    this.onLinkTap,
    this.onScrollPct,
    this.onSelectionState,
    this.onControllerCreated,
  });

  @override
  State<LinuxReaderWebView> createState() => _LinuxReaderWebViewState();
}

class _LinuxReaderWebViewState extends State<LinuxReaderWebView> {
  EmbeddedWebviewController? _web;
  bool _injected = false;

  void _bind(EmbeddedWebviewController web) {
    _web = web;
    final controller = LinuxReaderWebController._(web);

    web.registerJavaScriptHandler('onReady', (args) async {
      controller.markReady(true);
      widget.onReady?.call(true);
      return null;
    });
    web.registerJavaScriptHandler('onHighlightCreated', (args) async {
      if (args.isNotEmpty) {
        widget.onHighlightCreated?.call(
            args.first is Map ? Map<String, dynamic>.from(args.first as Map) : {'raw': args.first});
      }
      return null;
    });
    web.registerJavaScriptHandler('onHighlightUpdated', (args) async {
      final id = args.isNotEmpty ? args[0]?.toString() ?? '' : '';
      final payload = args.length > 1 && args[1] is Map
          ? Map<String, dynamic>.from(args[1] as Map)
          : <String, dynamic>{};
      widget.onHighlightUpdated?.call(id, payload);
      return null;
    });
    web.registerJavaScriptHandler('onHighlightDeleted', (args) async {
      final id = args.isNotEmpty ? args[0]?.toString() ?? '' : '';
      final payload = args.length > 1 && args[1] is Map
          ? Map<String, dynamic>.from(args[1] as Map)
          : <String, dynamic>{};
      widget.onHighlightDeleted?.call(id, payload);
      return null;
    });
    web.registerJavaScriptHandler('onLinkTap', (args) async {
      widget.onLinkTap?.call(args.isNotEmpty ? args[0]?.toString() ?? '' : '');
      return null;
    });
    web.registerJavaScriptHandler('onScrollPct', (args) async {
      widget.onScrollPct?.call(
          args.isNotEmpty ? (args[0] as num?)?.toDouble() ?? 0.0 : 0.0);
      return null;
    });
    web.registerJavaScriptHandler('onSelectionState', (args) async {
      final hasSel = args.isNotEmpty && args[0] == true;
      final text = args.length > 1 ? args[1]?.toString() ?? '' : '';
      widget.onSelectionState?.call(hasSel, text);
      return null;
    });

    web.onLoadStop = (_) {
      if (_injected) return;
      _injected = true;
      unawaited(_injectAssets());
    };

    widget.onControllerCreated?.call(controller);
  }

  Future<void> _injectAssets() async {
    try {
      final js = await rootBundle.loadString('assets/wwwreader/android-reader.js');
      final css = await rootBundle.loadString('assets/wwwreader/android-reader.css');

      if (css.trim().isNotEmpty) {
        await _web!.runJavaScriptReturningJson('''
(function(){
  var style = document.getElementById('scholiast-reader-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'scholiast-reader-style';
    document.documentElement.appendChild(style);
  }
  style.textContent = ${jsonEncode(css)};
})();
''');
      }

      if (js.trim().isNotEmpty) {
        await _web!.runJavaScriptReturningJson(js);
      }
      // Assets are injected after LOAD_FINISHED; ask the script to report.
      await _web!.runJavaScriptReturningJson(
          'window.ReaderAndroid && window.ReaderAndroid.init && window.ReaderAndroid.init();');
    } catch (e) {
      if (kDebugMode) debugPrint('[LinuxReader] asset injection failed: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return EmbeddedWebView(
      initialUrl: widget.url,
      onControllerCreated: _bind,
    );
  }
}

/// Real [ReaderWebController] over the native Linux web view.
class LinuxReaderWebController implements ReaderWebController {
  final EmbeddedWebviewController _web;
  bool _ready = false;

  LinuxReaderWebController._(this._web);

  void markReady(bool ready) => _ready = ready;

  @override
  bool get isReady => _ready;

  @override
  Future<void> paintHighlights(List<PageHighlight> highlights) async {
    final json = jsonEncode(highlights.map((h) => h.toJson()).toList());
    final encoded = jsonEncode(json);
    await _web.runJavaScriptReturningJson(
        'window.ReaderAndroid && window.ReaderAndroid.paintHighlights(JSON.parse($encoded));');
  }

  @override
  Future<void> revealHighlight(String highlightId) async {
    final encoded = jsonEncode(highlightId);
    await _web.runJavaScriptReturningJson(
        'window.ReaderAndroid && window.ReaderAndroid.revealHighlight($encoded);');
  }

  @override
  Future<void> setReaderTheme({
    required int fontStep,
    required bool isSerif,
  }) async {
    await _web.runJavaScriptReturningJson(
        'window.ReaderAndroid && window.ReaderAndroid.setReaderTheme($fontStep, ${isSerif ? 'true' : 'false'});');
  }

  @override
  Future<String> getArticleText() async {
    final result = await _web.runJavaScriptReturningJson(
        'window.ReaderAndroid ? window.ReaderAndroid.getArticleText() : document.body.innerText;');
    final decoded = jsonDecode(result);
    return decoded is String ? decoded : result;
  }

  @override
  Future<void> commitPending() async {
    await _web.runJavaScriptReturningJson(
        'window.ReaderAndroid && window.ReaderAndroid.commitPending();');
  }
}
