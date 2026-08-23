import 'dart:convert';
import 'dart:typed_data';

/// Encapsulates metadata parsed from a WAV header.
class WavHeaderInfo {
  /// Total file size reported in RIFF header (chunkSize + 8).
  final int fileSize;

  /// Audio format code (1 = uncompressed PCM).
  final int audioFormat;

  /// Number of channels (1 = mono, 2 = stereo).
  final int numChannels;

  /// Sample rate in Hz (e.g. 16000).
  final int sampleRate;

  /// Byte rate in bytes per second (sampleRate * numChannels * bitsPerSample / 8).
  final int byteRate;

  /// Block alignment in bytes (numChannels * bitsPerSample / 8).
  final int blockAlign;

  /// Bits per sample (e.g. 16).
  final int bitsPerSample;

  /// Size of the raw PCM audio data chunk in bytes.
  final int dataSize;

  const WavHeaderInfo({
    required this.fileSize,
    required this.audioFormat,
    required this.numChannels,
    required this.sampleRate,
    required this.byteRate,
    required this.blockAlign,
    required this.bitsPerSample,
    required this.dataSize,
  });

  /// Whether this WAV is in canonical 16kHz 16-bit mono PCM format for Whisper STT.
  bool get isCanonical16kMonoPcm =>
      audioFormat == 1 &&
      numChannels == 1 &&
      sampleRate == 16000 &&
      bitsPerSample == 16;

  /// Total duration of the audio stream based on sample rate and data size.
  Duration get duration {
    if (byteRate <= 0) return Duration.zero;
    final ms = (dataSize * 1000) ~/ byteRate;
    return Duration(milliseconds: ms);
  }

  @override
  String toString() =>
      'WavHeaderInfo(format: $audioFormat, channels: $numChannels, sampleRate: ${sampleRate}Hz, bits: $bitsPerSample, dataSize: ${dataSize}B)';
}

/// Utility for creating, parsing, and validating canonical WAV headers and streams.
///
/// Designed for 16kHz 16-bit mono PCM audio consumed by Whisper STT.
abstract final class WavEncoder {
  /// Standard 44-byte WAV header size for uncompressed PCM.
  static const int headerSize = 44;

  /// Default sample rate for speech recognition (16 kHz).
  static const int defaultSampleRate = 16000;

  /// Default mono channel count.
  static const int defaultNumChannels = 1;

  /// Default 16-bit depth per sample.
  static const int defaultBitsPerSample = 16;

  /// Creates a canonical 44-byte WAV header for the given [dataSize] in bytes.
  ///
  /// Defaults to 16000 Hz, mono (1 channel), 16-bit PCM.
  static Uint8List createHeader({
    required int dataSize,
    int sampleRate = defaultSampleRate,
    int numChannels = defaultNumChannels,
    int bitsPerSample = defaultBitsPerSample,
  }) {
    final bytesPerSample = bitsPerSample ~/ 8;
    final byteRate = sampleRate * numChannels * bytesPerSample;
    final blockAlign = numChannels * bytesPerSample;
    final chunkSize = 36 + dataSize;

    final header = Uint8List(headerSize);
    final byteData = ByteData.sublistView(header);

    // 0..3: "RIFF"
    header.setRange(0, 4, ascii.encode('RIFF'));

    // 4..7: ChunkSize (36 + dataSize) in uint32 little-endian
    byteData.setUint32(4, chunkSize, Endian.little);

    // 8..11: "WAVE"
    header.setRange(8, 12, ascii.encode('WAVE'));

    // 12..15: "fmt "
    header.setRange(12, 16, ascii.encode('fmt '));

    // 16..19: Subchunk1Size = 16 for PCM
    byteData.setUint32(16, 16, Endian.little);

    // 20..21: AudioFormat = 1 (PCM)
    byteData.setUint16(20, 1, Endian.little);

    // 22..23: NumChannels
    byteData.setUint16(22, numChannels, Endian.little);

    // 24..27: SampleRate
    byteData.setUint32(24, sampleRate, Endian.little);

    // 28..31: ByteRate
    byteData.setUint32(28, byteRate, Endian.little);

    // 32..33: BlockAlign
    byteData.setUint16(32, blockAlign, Endian.little);

    // 34..35: BitsPerSample
    byteData.setUint16(34, bitsPerSample, Endian.little);

    // 36..39: "data"
    header.setRange(36, 40, ascii.encode('data'));

    // 40..43: Subchunk2Size = dataSize
    byteData.setUint32(40, dataSize, Endian.little);

    return header;
  }

  /// Encodes raw PCM bytes into a complete canonical WAV byte buffer.
  static Uint8List encodePcm({
    required Uint8List pcmBytes,
    int sampleRate = defaultSampleRate,
    int numChannels = defaultNumChannels,
    int bitsPerSample = defaultBitsPerSample,
  }) {
    final header = createHeader(
      dataSize: pcmBytes.length,
      sampleRate: sampleRate,
      numChannels: numChannels,
      bitsPerSample: bitsPerSample,
    );

    final wav = Uint8List(headerSize + pcmBytes.length);
    wav.setRange(0, headerSize, header);
    wav.setRange(headerSize, wav.length, pcmBytes);
    return wav;
  }

  /// Quantizes normalized floating-point audio samples (range [-1.0, 1.0])
  /// into 16-bit signed little-endian PCM bytes and prepends a WAV header.
  static Uint8List encodeFloats(
    List<double> samples, {
    int sampleRate = defaultSampleRate,
    int numChannels = defaultNumChannels,
  }) {
    final pcmBytes = floatsToPcm16(samples);
    return encodePcm(
      pcmBytes: pcmBytes,
      sampleRate: sampleRate,
      numChannels: numChannels,
      bitsPerSample: defaultBitsPerSample,
    );
  }

  /// Encodes signed 16-bit integer samples into a complete WAV byte buffer.
  static Uint8List encodeInt16(
    List<int> samples, {
    int sampleRate = defaultSampleRate,
    int numChannels = defaultNumChannels,
  }) {
    final pcmBytes = Uint8List(samples.length * 2);
    final byteData = ByteData.sublistView(pcmBytes);
    for (var i = 0; i < samples.length; i++) {
      final clamped = samples[i].clamp(-32768, 32767);
      byteData.setInt16(i * 2, clamped, Endian.little);
    }
    return encodePcm(
      pcmBytes: pcmBytes,
      sampleRate: sampleRate,
      numChannels: numChannels,
      bitsPerSample: defaultBitsPerSample,
    );
  }

  /// Converts float samples [-1.0, 1.0] to 16-bit signed integer little-endian PCM bytes.
  static Uint8List floatsToPcm16(List<double> samples) {
    final pcmBytes = Uint8List(samples.length * 2);
    final byteData = ByteData.sublistView(pcmBytes);
    for (var i = 0; i < samples.length; i++) {
      final sample = samples[i];
      final clamped = (sample * 32767.0).round().clamp(-32768, 32767);
      byteData.setInt16(i * 2, clamped, Endian.little);
    }
    return pcmBytes;
  }

  /// Converts 16-bit signed integer little-endian PCM bytes to float samples [-1.0, 1.0].
  static List<double> pcm16ToFloats(Uint8List pcmBytes) {
    final count = pcmBytes.length ~/ 2;
    final byteData = ByteData.sublistView(pcmBytes);
    final floats = List<double>.filled(count, 0.0);
    for (var i = 0; i < count; i++) {
      final s16 = byteData.getInt16(i * 2, Endian.little);
      floats[i] = (s16 / 32768.0).clamp(-1.0, 1.0);
    }
    return floats;
  }

  /// Parses and validates the 44-byte WAV header from a byte buffer.
  ///
  /// Returns `null` if the buffer is smaller than 44 bytes or is not a valid RIFF/WAVE stream.
  static WavHeaderInfo? parseHeader(Uint8List bytes) {
    if (bytes.length < headerSize) return null;

    final riffTag = ascii.decode(bytes.sublist(0, 4), allowInvalid: true);
    final waveTag = ascii.decode(bytes.sublist(8, 12), allowInvalid: true);
    final fmtTag = ascii.decode(bytes.sublist(12, 16), allowInvalid: true);

    if (riffTag != 'RIFF' || waveTag != 'WAVE' || fmtTag != 'fmt ') {
      return null;
    }

    final byteData = ByteData.sublistView(bytes);
    final chunkSize = byteData.getUint32(4, Endian.little);
    final audioFormat = byteData.getUint16(20, Endian.little);
    final numChannels = byteData.getUint16(22, Endian.little);
    final sampleRate = byteData.getUint32(24, Endian.little);
    final byteRate = byteData.getUint32(28, Endian.little);
    final blockAlign = byteData.getUint16(32, Endian.little);
    final bitsPerSample = byteData.getUint16(34, Endian.little);

    // Look for data subchunk tag starting at offset 36
    final dataTag = ascii.decode(bytes.sublist(36, 40), allowInvalid: true);
    if (dataTag != 'data') {
      return null;
    }
    final dataSize = byteData.getUint32(40, Endian.little);

    return WavHeaderInfo(
      fileSize: chunkSize + 8,
      audioFormat: audioFormat,
      numChannels: numChannels,
      sampleRate: sampleRate,
      byteRate: byteRate,
      blockAlign: blockAlign,
      bitsPerSample: bitsPerSample,
      dataSize: dataSize,
    );
  }

  /// Checks if [bytes] starts with a valid WAV header and represents a valid WAV stream.
  static bool isValidWav(Uint8List bytes) {
    final info = parseHeader(bytes);
    if (info == null) return false;
    return bytes.length >= headerSize + info.dataSize;
  }

  /// Extracts the raw PCM payload from a WAV byte buffer.
  ///
  /// Throws [FormatException] if the header is invalid.
  static Uint8List extractPcm(Uint8List wavBytes) {
    final info = parseHeader(wavBytes);
    if (info == null) {
      throw const FormatException('Invalid WAV header: unable to extract PCM payload');
    }
    final end = (headerSize + info.dataSize).clamp(headerSize, wavBytes.length);
    return Uint8List.sublistView(wavBytes, headerSize, end);
  }

  /// Extracts normalized floating-point samples from a 16-bit PCM WAV byte buffer.
  static List<double> extractFloats(Uint8List wavBytes) {
    final pcm = extractPcm(wavBytes);
    return pcm16ToFloats(pcm);
  }
}
