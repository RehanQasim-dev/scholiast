import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'dart:io' show Platform;

import 'player_web_controller.dart';
import 'player_web_view_linux.dart';

/// The WebView host for `assets/player.html`. One instance is created per
/// player screen and reused across videos — switching videos only calls
/// [InAppPlayerWebController.loadVideo], never recreates the WebView.
///
/// Bridge: commands out via `evaluateJavascript` to the `command*` functions
/// in `player.html`; events in via `window.flutter_inappwebview.callHandler`
/// (registered as `addJavaScriptHandler` entries).
///
/// On Linux this delegates to [LinuxPlayerWebView] (native WebKitGTK).
class PlayerWebView extends StatefulWidget {
  final String videoId;
  final PlayerWebEvents? events;
  final void Function(PlayerWebController controller)? onControllerCreated;

  const PlayerWebView({
    super.key,
    required this.videoId,
    this.events,
    this.onControllerCreated,
  });

  @override
  State<PlayerWebView> createState() => _PlayerWebViewState();
}

class _PlayerWebViewState extends State<PlayerWebView> {
  InAppWebViewController? _webController;
  InAppPlayerWebController? _controller;
  bool _pageLoaded = false;
  final List<String> _pendingJs = <String>[];

  @override
  void didUpdateWidget(covariant PlayerWebView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.videoId != oldWidget.videoId && widget.videoId.isNotEmpty) {
      _controller?.loadVideo(widget.videoId);
    }
    if (widget.events != oldWidget.events) {
      _controller?.setEventsListener(widget.events);
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  void _flushPending() {
    if (!_pageLoaded || _webController == null) return;
    final pending = List<String>.from(_pendingJs);
    _pendingJs.clear();
    for (final js in pending) {
      _webController!.evaluateJavascript(source: js);
    }
  }

  void _eval(String js) {
    if (_pageLoaded && _webController != null) {
      _webController!.evaluateJavascript(source: js);
    } else {
      _pendingJs.add(js);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!kIsWeb && Platform.isLinux) {
      return LinuxPlayerWebView(
        videoId: widget.videoId,
        events: widget.events,
        onControllerCreated: widget.onControllerCreated,
      );
    }
    return InAppWebView(
      initialFile: 'assets/player.html',
      initialSettings: InAppWebViewSettings(
        javaScriptEnabled: true,
        domStorageEnabled: true,
        mediaPlaybackRequiresUserGesture: false,
        allowFileAccessFromFileURLs: true,
        allowUniversalAccessFromFileURLs: true,
        mixedContentMode: MixedContentMode.MIXED_CONTENT_ALWAYS_ALLOW,
        useWideViewPort: true,
        loadWithOverviewMode: true,
        transparentBackground: true,
        supportZoom: false,
      ),
      onWebViewCreated: (controller) {
        _webController = controller;
        _controller = InAppPlayerWebController(
          webController: controller,
          eval: _eval,
        );
        _controller!.setEventsListener(widget.events);

        // Register JS → Flutter handlers (same names as native bridge).
        for (final name in <String>[
          'onPlayerReady',
          'onStateChange',
          'onError',
          'onTimeUpdate',
          'onDuration',
          'onTitle',
          'onCaptionsAvailable',
          'onCaptureResult',
        ]) {
          controller.addJavaScriptHandler(
            handlerName: name,
            callback: (List<dynamic> args) {
              final arg = args.isNotEmpty ? args.first?.toString() ?? '' : '';
              _handleEvent(name, arg);
            },
          );
        }

        widget.onControllerCreated?.call(_controller!);
      },
      onLoadStop: (controller, url) {
        _pageLoaded = true;
        _flushPending();
        if (widget.videoId.isNotEmpty) {
          _controller?.loadVideo(widget.videoId);
        }
      },
      onConsoleMessage: (controller, message) {
        debugPrint('[PlayerWebView] ${message.message}');
      },
    );
  }

  void _handleEvent(String name, String arg) {
    final events = widget.events ?? _controller?._events;
    if (events == null) return;
    switch (name) {
      case 'onPlayerReady':
        events.onPlayerReady();
        break;
      case 'onStateChange':
        events.onStateChange(int.tryParse(arg) ?? -1);
        break;
      case 'onError':
        events.onError(int.tryParse(arg) ?? 2);
        break;
      case 'onTimeUpdate':
        events.onTimeUpdate(double.tryParse(arg) ?? 0.0);
        break;
      case 'onDuration':
        events.onDuration(double.tryParse(arg) ?? 0.0);
        break;
      case 'onTitle':
        events.onTitle(arg);
        break;
      case 'onCaptionsAvailable':
        events.onCaptionsAvailable(arg == 'true');
        break;
      case 'onCaptureResult':
        try {
          final obj = jsonDecode(arg) as Map<String, dynamic>;
          final dataUrl = (obj['dataUrl'] as String?)?.isNotEmpty == true
              ? obj['dataUrl'] as String
              : null;
          final error = (obj['error'] as String?)?.isNotEmpty == true
              ? obj['error'] as String
              : null;
          final w = (obj['w'] as num?)?.toInt() ?? 0;
          final h = (obj['h'] as num?)?.toInt() ?? 0;
          events.onCaptureResult(dataUrl, w, h, error);
        } catch (_) {}
        break;
    }
  }
}

/// Concrete [PlayerWebController] backed by an [InAppWebViewController].
class InAppPlayerWebController implements PlayerWebController {
  final InAppWebViewController webController;
  final void Function(String js) _eval;

  PlayerWebEvents? _events;

  InAppPlayerWebController({
    required this.webController,
    required void Function(String js) eval,
  })  : _eval = eval;

  @override
  void setEventsListener(PlayerWebEvents? listener) {
    _events = listener;
  }

  String _quote(String s) => jsonEncode(s);

  @override
  void loadVideo(String videoId) => _eval('commandLoadVideo(${_quote(videoId)})');

  @override
  void seekTo(double seconds) => _eval('commandSeekTo($seconds)');

  @override
  void play() => _eval('commandPlay()');

  @override
  void pause() => _eval('commandPause()');

  @override
  void setRate(double rate) => _eval('commandSetRate($rate)');

  @override
  void setVolume(int percent) => _eval('commandSetVolume($percent)');

  @override
  void setCaptions(bool enabled) => _eval('commandSetCaptions($enabled)');

  @override
  void captureFrame() => _eval('commandCaptureFrame()');

  @override
  void dispose() {
    _events = null;
  }
}
