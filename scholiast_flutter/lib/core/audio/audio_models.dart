import 'dart:math' as math;

/// Represents the lifecycle state of the audio recorder.
enum RecorderState {
  /// Recorder is idle and ready to record.
  idle,

  /// Recorder is actively capturing audio.
  recording,

  /// Recording is temporarily paused.
  paused,

  /// Recording has ended or is finalizing.
  stopped;

  /// Whether the recorder is currently idle.
  bool get isIdle => this == RecorderState.idle;

  /// Whether the recorder is actively recording audio.
  bool get isRecording => this == RecorderState.recording;

  /// Whether the recorder is currently paused.
  bool get isPaused => this == RecorderState.paused;

  /// Whether the recorder is stopped.
  bool get isStopped => this == RecorderState.stopped;

  /// Whether the recorder has an active session (either recording or paused).
  bool get isActive => this == RecorderState.recording || this == RecorderState.paused;
}

/// Represents audio amplitude and volume levels for visualizers, wave meters, and animations.
class AudioAmplitude {
  /// Current audio amplitude level in decibels (dBFS, typically -160.0 to 0.0) or raw level.
  final double current;

  /// Peak amplitude level recorded during the session.
  final double max;

  /// Normalized amplitude value in the range [0.0, 1.0] for UI wave animations.
  final double normalized;

  /// Default silent amplitude.
  static const zero = AudioAmplitude(
    current: -160.0,
    max: -160.0,
    normalized: 0.0,
  );

  const AudioAmplitude({
    required this.current,
    required this.max,
    required this.normalized,
  });

  /// Constructs an [AudioAmplitude] from dBFS values.
  ///
  /// [minDb] is the noise floor / silence threshold (default: -60.0 dBFS).
  /// [maxDb] is the full scale ceiling (default: 0.0 dBFS).
  factory AudioAmplitude.fromDecibels({
    required double current,
    required double max,
    double minDb = -60.0,
    double maxDb = 0.0,
  }) {
    if (minDb >= maxDb) {
      throw ArgumentError('minDb must be strictly less than maxDb');
    }
    if (current.isNaN || current.isInfinite || current <= minDb) {
      return AudioAmplitude(
        current: current,
        max: max,
        normalized: 0.0,
      );
    }
    final clampedCurrent = current.clamp(minDb, maxDb);
    final norm = (clampedCurrent - minDb) / (maxDb - minDb);
    return AudioAmplitude(
      current: current,
      max: max,
      normalized: norm.clamp(0.0, 1.0),
    );
  }

  /// Constructs an [AudioAmplitude] from a raw RMS value in [0.0, 1.0]
  /// using the FUTO magnitude formula: `magnitude = 1.0 - 0.1^(24 * rms)`.
  factory AudioAmplitude.fromRms({
    required double rms,
    double max = 1.0,
  }) {
    if (rms.isNaN || rms <= 0.0) {
      return AudioAmplitude(current: 0.0, max: max, normalized: 0.0);
    }
    final clampedRms = rms.clamp(0.0, 1.0);
    final magnitude = (1.0 - math.pow(0.1, 24.0 * clampedRms)).clamp(0.0, 1.0);
    return AudioAmplitude(
      current: rms,
      max: max,
      normalized: magnitude.toDouble(),
    );
  }

  /// Returns a smoothed copy of this amplitude using exponential moving average.
  ///
  /// [smoothing] factor in [0.0, 1.0]:
  /// - 0.0: no smoothing (pure instantaneous value).
  /// - 0.25 - 0.5: smooth and responsive for UI waveforms.
  /// - 1.0: completely frozen to previous value.
  AudioAmplitude smooth(AudioAmplitude previous, {double smoothing = 0.25}) {
    final factor = smoothing.clamp(0.0, 1.0);
    final smoothedNorm = previous.normalized * factor + normalized * (1.0 - factor);
    final smoothedCurrent = (previous.current.isFinite ? previous.current : current) * factor +
        (current.isFinite ? current : previous.current) * (1.0 - factor);
    final peakMax = math.max(max, previous.max);
    return AudioAmplitude(
      current: smoothedCurrent,
      max: peakMax,
      normalized: smoothedNorm.clamp(0.0, 1.0),
    );
  }

  AudioAmplitude copyWith({
    double? current,
    double? max,
    double? normalized,
  }) {
    return AudioAmplitude(
      current: current ?? this.current,
      max: max ?? this.max,
      normalized: normalized ?? this.normalized,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AudioAmplitude &&
          runtimeType == other.runtimeType &&
          current == other.current &&
          max == other.max &&
          normalized == other.normalized;

  @override
  int get hashCode => Object.hash(current, max, normalized);

  @override
  String toString() =>
      'AudioAmplitude(current: ${current.toStringAsFixed(2)}, max: ${max.toStringAsFixed(2)}, normalized: ${normalized.toStringAsFixed(3)})';
}

/// Information about a completed audio recording session.
class AudioRecordingResult {
  /// File system path to the recorded audio file (e.g. WAV).
  final String filePath;

  /// Total duration of recorded audio.
  final Duration duration;

  /// Sample rate in Hz (e.g. 16000).
  final int sampleRate;

  /// Number of channels (1 for mono, 2 for stereo).
  final int numChannels;

  /// Bit depth per sample (typically 16-bit).
  final int bitsPerSample;

  /// Total size in bytes of the audio file.
  final int fileSizeBytes;

  const AudioRecordingResult({
    required this.filePath,
    required this.duration,
    this.sampleRate = 16000,
    this.numChannels = 1,
    this.bitsPerSample = 16,
    required this.fileSizeBytes,
  });

  @override
  String toString() =>
      'AudioRecordingResult(path: $filePath, duration: ${duration.inMilliseconds}ms, size: ${fileSizeBytes}B, ${sampleRate}Hz mono)';
}
