import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import 'package:uuid/uuid.dart';

import 'audio_models.dart';

/// Service responsible for recording 16kHz 16-bit mono audio on Android, Linux, and other platforms.
///
/// Features:
/// - Canonical 16kHz 16-bit mono configuration tailored for Whisper STT.
/// - Real-time smoothed amplitude stream ([onAmplitudeChanged]).
/// - Accurate recording duration ticker stream ([onDurationChanged]).
/// - Lifecycle state machine ([onStateChanged]).
/// - Automatic temporary file management and cleanup.
class AudioRecorderService {
  static const _uuid = Uuid();

  /// Default sample rate for speech recognition (16 kHz).
  static const int defaultSampleRate = 16000;

  /// Default mono channel count.
  static const int defaultNumChannels = 1;

  /// Default bit rate for WAV recording.
  static const int defaultBitRate = 256000;

  /// Default canonical recording configuration for Whisper speech-to-text.
  static const RecordConfig defaultRecordConfig = RecordConfig(
    encoder: AudioEncoder.wav,
    sampleRate: defaultSampleRate,
    numChannels: defaultNumChannels,
    bitRate: defaultBitRate,
    autoGain: true,
    echoCancel: true,
    noiseSuppress: true,
  );

  final AudioRecorder _recorder;
  final Future<String> Function() _tempDirProvider;
  final Duration _tickerInterval;
  final Duration _amplitudeInterval;
  final double _amplitudeSmoothing;
  final Duration? _maxDuration;

  // Controllers
  final _stateController = StreamController<RecorderState>.broadcast(sync: true);
  final _amplitudeController = StreamController<AudioAmplitude>.broadcast();
  final _durationController = StreamController<Duration>.broadcast();

  // Internal state
  RecorderState _state = RecorderState.idle;
  String? _currentFilePath;
  DateTime? _recordingStartTime;
  Duration _accumulatedDuration = Duration.zero;
  AudioAmplitude _lastAmplitude = AudioAmplitude.zero;

  Timer? _durationTimer;
  Timer? _amplitudeTimer;
  StreamSubscription<RecordState>? _platformStateSubscription;

  // Tracked temporary files for cleanup
  final Set<String> _trackedTempFiles = {};

  AudioRecorderService({
    AudioRecorder? recorder,
    Future<String> Function()? tempDirProvider,
    this._tickerInterval = const Duration(milliseconds: 100),
    this._amplitudeInterval = const Duration(milliseconds: 50),
    this._amplitudeSmoothing = 0.25,
    this._maxDuration,
  })  : _recorder = recorder ?? AudioRecorder(),
        _tempDirProvider = tempDirProvider ?? _resolveDefaultTempDir {
    _platformStateSubscription = _recorder.onStateChanged().listen(
      _handlePlatformStateChanged,
      onError: (Object error) {
        // Silently ignore or handle platform errors gracefully
      },
    );
  }

  static Future<String> _resolveDefaultTempDir() async {
    try {
      final temp = await getTemporaryDirectory();
      return temp.path;
    } catch (_) {
      return Directory.systemTemp.path;
    }
  }

  /// Current recorder lifecycle state.
  RecorderState get state => _state;

  /// Broadcast stream of recorder lifecycle state changes.
  Stream<RecorderState> get onStateChanged => _stateController.stream;

  /// Broadcast stream of real-time smoothed audio amplitudes for UI wave visualizers.
  Stream<AudioAmplitude> get onAmplitudeChanged => _amplitudeController.stream;

  /// Broadcast stream of elapsed recording duration ticker updates.
  Stream<Duration> get onDurationChanged => _durationController.stream;

  /// Current recording elapsed duration.
  Duration get duration {
    if (_state == RecorderState.recording && _recordingStartTime != null) {
      return _accumulatedDuration + DateTime.now().difference(_recordingStartTime!);
    }
    return _accumulatedDuration;
  }

  /// The active recording file path, or `null` if not currently recording.
  String? get currentRecordingPath => _currentFilePath;

  /// Set of all temporary recording files created by this service instance.
  Set<String> get trackedTempFiles => Set.unmodifiable(_trackedTempFiles);

  /// Checks if microphone recording permissions are granted.
  Future<bool> hasPermission() async {
    return _recorder.hasPermission();
  }

  /// Starts recording 16kHz 16-bit mono audio.
  ///
  /// If [customPath] is provided, recording is saved to that path.
  /// Otherwise, a unique temporary file is created in `<tempDir>/scholiast_audio/`.
  Future<String> start({
    String? customPath,
    RecordConfig config = defaultRecordConfig,
  }) async {
    if (_state.isActive) {
      throw StateError('Cannot start recording while recorder is in state $_state');
    }

    final hasPerm = await hasPermission();
    if (!hasPerm) {
      throw const AudioRecorderPermissionException('Microphone permission denied');
    }

    final filePath = customPath ?? await _generateTempFilePath();
    _currentFilePath = filePath;
    _trackedTempFiles.add(filePath);

    // Ensure parent directory exists
    final parentDir = Directory(p.dirname(filePath));
    if (!await parentDir.exists()) {
      await parentDir.create(recursive: true);
    }

    await _recorder.start(config, path: filePath);

    _state = RecorderState.recording;
    _stateController.add(_state);

    _accumulatedDuration = Duration.zero;
    _recordingStartTime = DateTime.now();
    _lastAmplitude = AudioAmplitude.zero;

    _startDurationTicker();
    _startAmplitudePolling();

    return filePath;
  }

  /// Starts streaming raw audio chunks directly without writing to a file.
  Future<Stream<Uint8List>> startStream({
    RecordConfig config = defaultRecordConfig,
  }) async {
    if (_state.isActive) {
      throw StateError('Cannot start recording stream while recorder is in state $_state');
    }

    final hasPerm = await hasPermission();
    if (!hasPerm) {
      throw const AudioRecorderPermissionException('Microphone permission denied');
    }

    _currentFilePath = null;
    final stream = await _recorder.startStream(config);

    _state = RecorderState.recording;
    _stateController.add(_state);

    _accumulatedDuration = Duration.zero;
    _recordingStartTime = DateTime.now();
    _lastAmplitude = AudioAmplitude.zero;

    _startDurationTicker();
    _startAmplitudePolling();

    return stream;
  }

  /// Pauses the active recording session.
  Future<void> pause() async {
    if (_state != RecorderState.recording) return;

    if (_recordingStartTime != null) {
      _accumulatedDuration += DateTime.now().difference(_recordingStartTime!);
      _recordingStartTime = null;
    }

    _stopDurationTicker();
    _stopAmplitudePolling();

    await _recorder.pause();

    _state = RecorderState.paused;
    _stateController.add(_state);
    _amplitudeController.add(AudioAmplitude.zero);
  }

  /// Resumes a paused recording session.
  Future<void> resume() async {
    if (_state != RecorderState.paused) return;

    _recordingStartTime = DateTime.now();
    await _recorder.resume();

    _state = RecorderState.recording;
    _stateController.add(_state);

    _startDurationTicker();
    _startAmplitudePolling();
  }

  /// Stops the recording session and returns the recorded audio file path.
  ///
  /// The returned file is guaranteed to be a valid 16kHz mono WAV file ready for Whisper STT.
  Future<String?> stop() async {
    if (_state.isIdle || _state.isStopped) return null;

    if (_state == RecorderState.recording && _recordingStartTime != null) {
      _accumulatedDuration += DateTime.now().difference(_recordingStartTime!);
      _recordingStartTime = null;
    }

    _stopDurationTicker();
    _stopAmplitudePolling();

    final resultPath = await _recorder.stop();
    final finalPath = resultPath ?? _currentFilePath;

    _state = RecorderState.stopped;
    _stateController.add(_state);
    _durationController.add(_accumulatedDuration);
    _amplitudeController.add(AudioAmplitude.zero);

    _currentFilePath = null;

    // Reset back to idle for the next recording
    _state = RecorderState.idle;
    _stateController.add(_state);

    return finalPath;
  }

  /// Stops recording and returns the full audio payload as bytes ready for Whisper STT.
  ///
  /// If [deleteTempFile] is `true` (default), the temporary file is deleted after reading.
  Future<Uint8List?> stopToBytes({bool deleteTempFile = true}) async {
    final filePath = await stop();
    if (filePath == null) return null;

    final file = File(filePath);
    if (!await file.exists()) return null;

    final bytes = await file.readAsBytes();
    if (deleteTempFile) {
      try {
        await file.delete();
        _trackedTempFiles.remove(filePath);
      } catch (_) {
        // Ignore deletion errors on busy systems
      }
    }
    return bytes;
  }

  /// Cancels the recording session and immediately deletes the recording file.
  Future<void> cancel() async {
    if (_state.isIdle) return;

    _stopDurationTicker();
    _stopAmplitudePolling();

    await _recorder.cancel();

    final filePath = _currentFilePath;
    if (filePath != null) {
      try {
        final file = File(filePath);
        if (await file.exists()) {
          await file.delete();
        }
        _trackedTempFiles.remove(filePath);
      } catch (_) {
        // Ignore deletion errors
      }
    }

    _currentFilePath = null;
    _accumulatedDuration = Duration.zero;
    _recordingStartTime = null;

    _state = RecorderState.idle;
    _stateController.add(_state);
    _durationController.add(Duration.zero);
    _amplitudeController.add(AudioAmplitude.zero);
  }

  /// Cleans up all temporary recording files created by this service.
  Future<void> cleanupTempFiles() async {
    final toRemove = <String>[];
    for (final path in _trackedTempFiles) {
      try {
        final file = File(path);
        if (await file.exists()) {
          await file.delete();
        }
        toRemove.add(path);
      } catch (_) {
        // Ignore deletion errors
      }
    }
    _trackedTempFiles.removeAll(toRemove);

    // Also scan temp audio folder to prune any orphaned recording files
    try {
      final tempDir = await _tempDirProvider();
      final audioDir = Directory(p.join(tempDir, 'scholiast_audio'));
      if (await audioDir.exists()) {
        final entries = audioDir.listSync();
        for (final entry in entries) {
          if (entry is File && p.extension(entry.path) == '.wav') {
            try {
              await entry.delete();
            } catch (_) {}
          }
        }
      }
    } catch (_) {}
  }

  /// Disposes timers, subscriptions, streams, and the underlying recorder.
  Future<void> dispose() async {
    _stopDurationTicker();
    _stopAmplitudePolling();

    await _platformStateSubscription?.cancel();
    _platformStateSubscription = null;

    await _recorder.dispose();

    await _stateController.close();
    await _amplitudeController.close();
    await _durationController.close();
  }

  Future<String> _generateTempFilePath() async {
    final tempDir = await _tempDirProvider();
    final timestamp = DateTime.now().millisecondsSinceEpoch;
    final randId = _uuid.v4().substring(0, 8);
    final filename = 'rec_${timestamp}_$randId.wav';
    return p.join(tempDir, 'scholiast_audio', filename);
  }

  void _startDurationTicker() {
    _durationTimer?.cancel();
    _durationTimer = Timer.periodic(_tickerInterval, (_) {
      if (_state == RecorderState.recording) {
        final currentElapsed = duration;
        _durationController.add(currentElapsed);

        if (_maxDuration != null && currentElapsed >= _maxDuration) {
          stop();
        }
      }
    });
  }

  void _stopDurationTicker() {
    _durationTimer?.cancel();
    _durationTimer = null;
  }

  void _startAmplitudePolling() {
    _amplitudeTimer?.cancel();
    _amplitudeTimer = Timer.periodic(_amplitudeInterval, (_) async {
      if (_state != RecorderState.recording) return;

      try {
        final amp = await _recorder.getAmplitude();
        final rawAmp = AudioAmplitude.fromDecibels(
          current: amp.current,
          max: amp.max,
          minDb: -60.0,
          maxDb: 0.0,
        );

        final smoothed = rawAmp.smooth(
          _lastAmplitude,
          smoothing: _amplitudeSmoothing,
        );
        _lastAmplitude = smoothed;

        if (!_amplitudeController.isClosed) {
          _amplitudeController.add(smoothed);
        }
      } catch (_) {
        // Ignore amplitude poll errors
      }
    });
  }

  void _stopAmplitudePolling() {
    _amplitudeTimer?.cancel();
    _amplitudeTimer = null;
  }

  void _handlePlatformStateChanged(RecordState platformState) {
    switch (platformState) {
      case RecordState.record:
        if (_state != RecorderState.recording) {
          _state = RecorderState.recording;
          _stateController.add(_state);
        }
        break;
      case RecordState.pause:
        if (_state != RecorderState.paused) {
          _state = RecorderState.paused;
          _stateController.add(_state);
        }
        break;
      case RecordState.stop:
        if (_state.isActive) {
          _state = RecorderState.stopped;
          _stateController.add(_state);
        }
        break;
    }
  }
}

/// Custom exception for system / permission errors.
class AudioRecorderPermissionException implements Exception {
  final String message;
  const AudioRecorderPermissionException(this.message);

  @override
  String toString() => 'AudioRecorderPermissionException: $message';
}
