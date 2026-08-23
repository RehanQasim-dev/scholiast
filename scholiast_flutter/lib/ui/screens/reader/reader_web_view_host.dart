import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import 'dart:io' show Platform;

import 'package:scholiast_flutter/core/models/page_highlight.dart';
import 'reader_web_controller.dart';
import 'reader_web_view_host_linux.dart';

/// Callbacks for JS → Dart bridge events.
typedef HighlightCreatedCallback = void Function(Map<String, dynamic> payload);
typedef HighlightCallback = void Function(String highlightId, Map<String, dynamic> payload);
typedef LinkTapCallback = void Function(String href);
typedef ScrollCallback = void Function(double scrollPct);
typedef SelectionCallback = void Function(bool hasSelection, String selectedText);

/// Host for the live WebView reader.

/// Loads [url], injects `android-reader.js` + `android-reader.css`, and
/// exposes a [ReaderWebController] bridge to Dart.
///
/// On platforms where InAppWebView is unavailable (e.g. Linux unit tests),
/// the widget renders a lightweight placeholder and delegates to
/// [FakeReaderWebController] when supplied.
class ReaderWebViewHost extends StatefulWidget {
  final String url;
  final ReaderWebController? controller;
  final ValueChanged<bool>? onReady;
  final HighlightCreatedCallback? onHighlightCreated;
  final HighlightCallback? onHighlightUpdated;
  final HighlightCallback? onHighlightDeleted;
  final LinkTapCallback? onLinkTap;
  final ScrollCallback? onScrollPct;
  final SelectionCallback? onSelectionState;

  const ReaderWebViewHost({
    super.key,
    required this.url,
    this.controller,
    this.onReady,
    this.onHighlightCreated,
    this.onHighlightUpdated,
    this.onHighlightDeleted,
    this.onLinkTap,
    this.onScrollPct,
    this.onSelectionState,
  });

  @override
  State<ReaderWebViewHost> createState() => _ReaderWebViewHostState();
}

class _ReaderWebViewHostState extends State<ReaderWebViewHost> {
  // ignore: unused_field
  InAppWebViewController? _webController;
  // ignore: unused_field
  bool _ready = false;

  @override
  Widget build(BuildContext context) {
    // Linux / test: if the controller is a Fake, avoid launching a real WebView.
    final isLinuxTest = kIsWeb == false &&
        defaultTargetPlatform == TargetPlatform.linux &&
        widget.controller is FakeReaderWebController;

    if (!kIsWeb &&
        !isLinuxTest &&
        Platform.isLinux) {
      return LinuxReaderWebView(
        url: widget.url,
        onReady: widget.onReady,
        onHighlightCreated: widget.onHighlightCreated,
        onHighlightUpdated: widget.onHighlightUpdated,
        onHighlightDeleted: widget.onHighlightDeleted,
        onLinkTap: widget.onLinkTap,
        onScrollPct: widget.onScrollPct,
        onSelectionState: widget.onSelectionState,
      );
    }

    if (isLinuxTest) {
      return Container(
        color: const Color(0xFF0B0D14),
        alignment: Alignment.center,
        child: const Text(
          'WebView preview unavailable on Linux',
          style: TextStyle(color: Color(0xFF9AA0A6)),
        ),
      );
    }

    return InAppWebView(
      initialUrlRequest: URLRequest(url: WebUri(widget.url)),
      initialSettings: InAppWebViewSettings(
        javaScriptEnabled: true,
        domStorageEnabled: true,
        allowFileAccess: true,
        transparentBackground: false,
        supportZoom: true,
        builtInZoomControls: true,
        displayZoomControls: false,
      ),
      onWebViewCreated: (controller) {
        _webController = controller;
        _registerHandlers(controller);
      },
      onLoadStop: (controller, url) async {
        await _injectReaderAssets(controller);
      },
      onConsoleMessage: (controller, message) {
        if (kDebugMode) {
          debugPrint('[ReaderWebView] ${message.message}');
        }
      },
    );
  }

  void _registerHandlers(InAppWebViewController controller) {
    controller.addJavaScriptHandler(
      handlerName: 'onReady',
      callback: (List<dynamic> args) {
        _ready = true;
        widget.onReady?.call(true);
        return null;
      },
    );

    controller.addJavaScriptHandler(
      handlerName: 'onHighlightCreated',
      callback: (List<dynamic> args) {
        if (args.isEmpty) return null;
        final payload = args.first is Map
            ? Map<String, dynamic>.from(args.first as Map)
            : <String, dynamic>{'raw': args.first};
        widget.onHighlightCreated?.call(payload);
        return null;
      },
    );

    controller.addJavaScriptHandler(
      handlerName: 'onHighlightUpdated',
      callback: (List<dynamic> args) {
        final id = args.isNotEmpty ? args[0]?.toString() ?? '' : '';
        final payload = args.length > 1 && args[1] is Map
            ? Map<String, dynamic>.from(args[1] as Map)
            : <String, dynamic>{};
        widget.onHighlightUpdated?.call(id, payload);
        return null;
      },
    );

    controller.addJavaScriptHandler(
      handlerName: 'onHighlightDeleted',
      callback: (List<dynamic> args) {
        final id = args.isNotEmpty ? args[0]?.toString() ?? '' : '';
        final payload = args.length > 1 && args[1] is Map
            ? Map<String, dynamic>.from(args[1] as Map)
            : <String, dynamic>{};
        widget.onHighlightDeleted?.call(id, payload);
        return null;
      },
    );

    controller.addJavaScriptHandler(
      handlerName: 'onLinkTap',
      callback: (List<dynamic> args) {
        final href = args.isNotEmpty ? args[0]?.toString() ?? '' : '';
        widget.onLinkTap?.call(href);
        return null;
      },
    );

    controller.addJavaScriptHandler(
      handlerName: 'onScrollPct',
      callback: (List<dynamic> args) {
        final num? raw = args.isNotEmpty ? args[0] as num? : null;
        final double pct = raw?.toDouble() ?? 0.0;
        widget.onScrollPct?.call(pct);
        return null;
      },
    );

    controller.addJavaScriptHandler(
      handlerName: 'onSelectionState',
      callback: (List<dynamic> args) {
        final hasSel = args.isNotEmpty ? args[0] == true : false;
        final text = args.length > 1 ? args[1]?.toString() ?? '' : '';
        widget.onSelectionState?.call(hasSel, text);
        return null;
      },
    );
  }

  Future<void> _injectReaderAssets(InAppWebViewController controller) async {
    try {
      final js = await rootBundle.loadString('assets/wwwreader/android-reader.js');
      final css = await rootBundle.loadString('assets/wwwreader/android-reader.css');

      if (css.trim().isNotEmpty) {
        final escapedCss = jsonEncode(css);
        await controller.evaluateJavascript(
          source: '''
(function(){
  var style = document.getElementById('scholiast-reader-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'scholiast-reader-style';
    document.documentElement.appendChild(style);
  }
  style.textContent = $escapedCss;
})();
''',
        );
      }

      if (js.trim().isNotEmpty) {
        await controller.evaluateJavascript(source: js);
      }
    } catch (e) {
      if (kDebugMode) debugPrint('[ReaderWebView] asset injection failed: $e');
    }
  }
}

/// Real controller backed by an [InAppWebViewController].
class InAppReaderWebController implements ReaderWebController {
  final InAppWebViewController webController;
  bool _ready = false;

  InAppReaderWebController(this.webController);

  void markReady(bool ready) => _ready = ready;

  @override
  bool get isReady => _ready;

  @override
  Future<void> paintHighlights(List<PageHighlight> highlights) async {
    final json = jsonEncode(highlights.map((h) => h.toJson()).toList());
    final encoded = jsonEncode(json);
    await webController.evaluateJavascript(
      source: 'window.ReaderAndroid && window.ReaderAndroid.paintHighlights(JSON.parse($encoded));',
    );
  }

  @override
  Future<void> revealHighlight(String highlightId) async {
    final encoded = jsonEncode(highlightId);
    await webController.evaluateJavascript(
      source: 'window.ReaderAndroid && window.ReaderAndroid.revealHighlight($encoded);',
    );
  }

  @override
  Future<void> setReaderTheme({
    required int fontStep,
    required bool isSerif,
  }) async {
    await webController.evaluateJavascript(
      source:
          'window.ReaderAndroid && window.ReaderAndroid.setReaderTheme($fontStep, ${isSerif ? 'true' : 'false'});',
    );
  }

  @override
  Future<String> getArticleText() async {
    final result = await webController.evaluateJavascript(
      source: 'window.ReaderAndroid ? window.ReaderAndroid.getArticleText() : document.body.innerText;',
    );
    return result?.toString() ?? '';
  }

  @override
  Future<void> commitPending() async {
    await webController.evaluateJavascript(
      source: 'window.ReaderAndroid && window.ReaderAndroid.commitPending();',
    );
  }
}
