import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import 'package:scholiast_flutter/core/webkit/embedded_webview.dart';

import 'player_web_controller.dart';

/// The WebView host for `assets/player.html` on Linux — an offscreen
/// WebKitGTK texture view. One instance per player screen; switching videos
/// only calls [LinuxPlayerWebController.loadVideo].
///
/// Bridge: commands out via JS to the `command*` functions in `player.html`;
/// events in via `window.flutter_inappwebview.callHandler` (same names as
/// Android).
class LinuxPlayerWebView extends StatefulWidget {
  final String videoId;
  final PlayerWebEvents? events;
  final void Function(LinuxPlayerWebController controller)? onControllerCreated;

  const LinuxPlayerWebView({
    super.key,
    required this.videoId,
    this.events,
    this.onControllerCreated,
  });

  @override
  State<LinuxPlayerWebView> createState() => _LinuxPlayerWebViewState();
}

class _LinuxPlayerWebViewState extends State<LinuxPlayerWebView> {
  LinuxPlayerWebController? _controller;

  @override
  void didUpdateWidget(covariant LinuxPlayerWebView oldWidget) {
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
    // The EmbeddedWebView widget owns its controller; nothing to do here.
    super.dispose();
  }

  void _bind(EmbeddedWebviewController web) {
    final controller = LinuxPlayerWebController._(web, evalQueued: web.runJavaScript);
    _controller = controller;
    controller.setEventsListener(widget.events);

    for (final name in const [
      'onPlayerReady',
      'onStateChange',
      'onError',
      'onTimeUpdate',
      'onDuration',
      'onTitle',
      'onCaptionsAvailable',
      'onCaptureResult',
    ]) {
      web.registerJavaScriptHandler(name, (args) async {
        final arg = args.isNotEmpty ? args.first?.toString() ?? '' : '';
        controller.dispatchEvent(name, arg);
        return null;
      });
    }

    web.onLoadStop = (_) {
      if (widget.videoId.isNotEmpty) {
        controller.loadVideo(widget.videoId);
      }
    };

    widget.onControllerCreated?.call(controller);
  }

  @override
  Widget build(BuildContext context) {
    return EmbeddedWebView(
      initialFile: embeddedAssetPath('assets/player.html'),
      onControllerCreated: _bind,
    );
  }
}

/// Concrete [PlayerWebController] backed by the native Linux web view.
class LinuxPlayerWebController implements PlayerWebController {
  final void Function(String js) _eval;
  PlayerWebEvents? _events;

  LinuxPlayerWebController._(EmbeddedWebviewController web,
      {required void Function(String js) evalQueued})
      : _eval = evalQueued;

  @override
  void setEventsListener(PlayerWebEvents? listener) {
    _events = listener;
  }

  void dispatchEvent(String name, String arg) {
    final events = _events;
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
