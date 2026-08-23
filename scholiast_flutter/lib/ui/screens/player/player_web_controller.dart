import 'package:flutter/foundation.dart';

/// Commands out (Flutter → JS) plus event wiring — mirrors
/// `android/app/src/main/java/com/scholiast/android/player/PlayerBridge.kt`.
///
/// Events in (JS → Flutter) use these handler names:
///   onPlayerReady / onStateChange / onError / onTimeUpdate / onDuration
///   / onTitle / onCaptionsAvailable / onCaptureResult
/// Commands out share the same names as native: loadVideo, seekTo, play,
/// pause, setRate, setVolume, setCaptions, captureFrame.
abstract class PlayerWebController {
  void setEventsListener(PlayerWebEvents? listener);

  void loadVideo(String videoId);

  void seekTo(double seconds);

  void play();

  void pause();

  void setRate(double rate);

  void setVolume(int percent);

  void setCaptions(bool enabled);

  void captureFrame();

  void dispose();
}

/// Events in (JS → Flutter) — same contract as native [PlayerEvents].
abstract class PlayerWebEvents {
  void onPlayerReady();

  /// IFrame API state change. Codes: −1 UNSTARTED, 0 ENDED, 1 PLAYING,
  /// 2 PAUSED, 3 BUFFERING, 5 CUED.
  void onStateChange(int state);

  /// IFrame API error. Codes: 2, 5, 100, 101, 150.
  void onError(int code);

  void onTimeUpdate(double timeSeconds);

  void onDuration(double durationSeconds);

  void onTitle(String title);

  void onCaptionsAvailable(bool available);

  /// Result of a [PlayerWebController.captureFrame] request.
  void onCaptureResult(String? dataUrl, int width, int height, String? error);
}

/// Fake controller for widget tests — records commands, replays events.
class FakePlayerWebController implements PlayerWebController {
  PlayerWebEvents? _listener;

  final List<String> commands = <String>[];
  String? lastVideoId;
  double? lastSeek;
  double? lastRate;
  int? lastVolume;
  bool? lastCaptions;
  bool captureRequested = false;

  @override
  void setEventsListener(PlayerWebEvents? listener) {
    _listener = listener;
  }

  @override
  void loadVideo(String videoId) {
    lastVideoId = videoId;
    commands.add('loadVideo:$videoId');
  }

  @override
  void seekTo(double seconds) {
    lastSeek = seconds;
    commands.add('seekTo:$seconds');
  }

  @override
  void play() => commands.add('play');

  @override
  void pause() => commands.add('pause');

  @override
  void setRate(double rate) {
    lastRate = rate;
    commands.add('setRate:$rate');
  }

  @override
  void setVolume(int percent) {
    lastVolume = percent;
    commands.add('setVolume:$percent');
  }

  @override
  void setCaptions(bool enabled) {
    lastCaptions = enabled;
    commands.add('setCaptions:$enabled');
  }

  @override
  void captureFrame() {
    captureRequested = true;
    commands.add('captureFrame');
  }

  @override
  @mustCallSuper
  void dispose() {
    _listener = null;
  }

  // --- Test helpers: fire events into the listener -------------------------

  void firePlayerReady() => _listener?.onPlayerReady();

  void fireStateChange(int state) => _listener?.onStateChange(state);

  void fireError(int code) => _listener?.onError(code);

  void fireTimeUpdate(double t) => _listener?.onTimeUpdate(t);

  void fireDuration(double d) => _listener?.onDuration(d);

  void fireTitle(String title) => _listener?.onTitle(title);

  void fireCaptionsAvailable(bool v) => _listener?.onCaptionsAvailable(v);

  void fireCaptureResult(String? dataUrl, int w, int h, String? error) =>
      _listener?.onCaptureResult(dataUrl, w, h, error);
}
