import 'dart:io';
import 'package:flutter/foundation.dart';
import '../auth/secure_token_store.dart';
import 'cloud_stt_service.dart';
import 'stt_models.dart';
import 'whisper_bindings.dart';
import 'whisper_isolate_worker.dart';
import 'whisper_model_manager.dart';

/// Unified Speech-to-Text coordinator for Scholiast.
/// Routes audio transcription between on-device Whisper (via FFI & background Isolate)
/// and Cloud AI transcribers (Groq, OpenAI, Gemini) with configurable automatic fallbacks.
class SttService {
  final WhisperModelManager _modelManager;
  final CloudSttService _cloudStt;
  final WhisperIsolateWorker _isolateWorker;
  final SecureTokenStore? _tokenStore;

  SttProvider preferredProvider;
  List<SttProvider> _fallbackChain;
  String? _activeModelId;
  String? defaultLanguage;

  SttService({
    WhisperModelManager? modelManager,
    CloudSttService? cloudStt,
    WhisperIsolateWorker? isolateWorker,
    SecureTokenStore? tokenStore,
    this.preferredProvider = SttProvider.localWhisper,
    List<SttProvider>? fallbackChain,
    this.defaultLanguage,
  })  : _modelManager = modelManager ?? WhisperModelManager(),
        _cloudStt = cloudStt ?? CloudSttService(tokenStore: tokenStore),
        _isolateWorker = isolateWorker ?? WhisperIsolateWorker(),
        _tokenStore = tokenStore,
        _fallbackChain = fallbackChain ??
            [
              SttProvider.localWhisper,
              SttProvider.groq,
              SttProvider.openAi,
              SttProvider.gemini,
            ];

  // --- Getters & Configuration ---

  List<SttProvider> get fallbackChain => List.unmodifiable(_fallbackChain);
  set fallbackChain(List<SttProvider> chain) =>
      _fallbackChain = List.from(chain);

  String? get activeModelId => _activeModelId;
  SecureTokenStore? get tokenStore => _tokenStore;

  WhisperModelManager get modelManager => _modelManager;
  CloudSttService get cloudStt => _cloudStt;
  WhisperIsolateWorker get isolateWorker => _isolateWorker;

  /// Checks whether local Whisper inference is loaded and ready to transcribe.
  bool isLocalWhisperReady() => _isolateWorker.isReady;

  /// Checks whether the native Whisper dynamic library is present on this platform.
  bool isLocalWhisperAvailable({String? customLibraryPath}) {
    final bindings = WhisperBindings.load(customLibraryPath: customLibraryPath);
    return bindings != null && bindings.isAvailable;
  }

  /// Initializes the local Whisper background isolate with the model specified by [modelId].
  /// If the model is not yet downloaded, returns false or throws [SttException].
  Future<bool> initLocalWhisper(
    String modelId, {
    String? customLibraryPath,
  }) async {
    final modelPath = await _modelManager.getDownloadedModelPath(modelId);
    if (modelPath == null) {
      throw SttException(
        SttErrorType.modelNotLoaded,
        'Model $modelId is not downloaded on this device',
        provider: SttProvider.localWhisper,
      );
    }

    final success = await _isolateWorker.init(
      modelPath: modelPath,
      customLibraryPath: customLibraryPath,
    );

    if (success) {
      _activeModelId = modelId;
    }
    return success;
  }

  // --- Core Transcription APIs ---

  /// Transcribes audio from a raw Float32 PCM sample buffer (16kHz mono).
  Future<SttResult> transcribeFloatPcm(
    Float32List samples, {
    SttProvider? preferredProvider,
    String? language,
    int sampleRate = 16000,
    int nThreads = 4,
    bool enableFallback = true,
  }) async {
    final lang = language ?? defaultLanguage;
    final primary = preferredProvider ?? this.preferredProvider;
    final chain = _buildExecutionChain(primary, enableFallback);

    final errors = <String>[];

    for (final provider in chain) {
      try {
        if (provider == SttProvider.localWhisper) {
          if (!_isolateWorker.isReady) {
            // Attempt auto-init if an active model was previously chosen or default is downloaded
            final targetModelId = _activeModelId ?? WhisperModelInfo.defaultModel.id;
            final path = await _modelManager.getDownloadedModelPath(targetModelId);
            if (path != null) {
              await _isolateWorker.init(modelPath: path);
              _activeModelId = targetModelId;
            } else {
              throw const SttException(
                SttErrorType.modelNotLoaded,
                'Local Whisper model is not loaded and default model is not downloaded.',
                provider: SttProvider.localWhisper,
              );
            }
          }

          return await _isolateWorker.transcribe(
            samples,
            language: lang,
            nThreads: nThreads,
          );
        } else {
          // Cloud providers require WAV bytes
          final wavBytes = pcmFloat32ToWavBytes(samples, sampleRate: sampleRate);
          return await _cloudStt.transcribe(
            wavBytes,
            provider,
            language: lang,
          );
        }
      } catch (e) {
        debugPrint('SttService: Provider ${provider.id} failed: $e');
        errors.add('${provider.id}: $e');
        if (!enableFallback) rethrow;
      }
    }

    throw SttException(
      SttErrorType.unknown,
      'All Speech-to-Text providers in the fallback chain failed:\n${errors.join('\n')}',
    );
  }

  /// Transcribes audio bytes (e.g. WAV, MP3, M4A format).
  Future<SttResult> transcribeAudioBytes(
    Uint8List audioBytes, {
    SttProvider? preferredProvider,
    String? language,
    String mimeType = 'audio/wav',
    String fileName = 'audio.wav',
    int nThreads = 4,
    bool enableFallback = true,
  }) async {
    final lang = language ?? defaultLanguage;
    final primary = preferredProvider ?? this.preferredProvider;
    final chain = _buildExecutionChain(primary, enableFallback);

    final errors = <String>[];

    for (final provider in chain) {
      try {
        if (provider == SttProvider.localWhisper) {
          final samples = wavBytesToPcmFloat32(audioBytes);
          return await transcribeFloatPcm(
            samples,
            preferredProvider: SttProvider.localWhisper,
            language: lang,
            nThreads: nThreads,
            enableFallback: false,
          );
        } else {
          return await _cloudStt.transcribe(
            audioBytes,
            provider,
            language: lang,
            mimeType: mimeType,
            fileName: fileName,
          );
        }
      } catch (e) {
        debugPrint('SttService: Provider ${provider.id} failed: $e');
        errors.add('${provider.id}: $e');
        if (!enableFallback) rethrow;
      }
    }

    throw SttException(
      SttErrorType.unknown,
      'All Speech-to-Text providers in the fallback chain failed:\n${errors.join('\n')}',
    );
  }

  /// Transcribes an audio file on disk from [filePath].
  Future<SttResult> transcribeAudioFile(
    String filePath, {
    SttProvider? preferredProvider,
    String? language,
    int nThreads = 4,
    bool enableFallback = true,
  }) async {
    final file = File(filePath);
    if (!await file.exists()) {
      throw SttException(
        SttErrorType.invalidAudio,
        'Audio file does not exist: $filePath',
      );
    }

    final bytes = await file.readAsBytes();
    final fileName = file.uri.pathSegments.last;
    final mimeType = fileName.endsWith('.mp3')
        ? 'audio/mp3'
        : (fileName.endsWith('.m4a') ? 'audio/m4a' : 'audio/wav');

    return transcribeAudioBytes(
      bytes,
      preferredProvider: preferredProvider,
      language: language,
      mimeType: mimeType,
      fileName: fileName,
      nThreads: nThreads,
      enableFallback: enableFallback,
    );
  }

  /// Cleans up worker isolates and resources.
  Future<void> dispose() async {
    await _isolateWorker.dispose();
  }

  // --- Helper Methods ---

  List<SttProvider> _buildExecutionChain(
    SttProvider primary,
    bool enableFallback,
  ) {
    if (!enableFallback) return [primary];
    final chain = <SttProvider>[primary];
    for (final p in _fallbackChain) {
      if (!chain.contains(p)) {
        chain.add(p);
      }
    }
    return chain;
  }

  // --- Audio Format Conversion Utilities ---

  /// Encodes 16kHz mono Float32 PCM samples into a standard 16-bit PCM WAV byte buffer.
  static Uint8List pcmFloat32ToWavBytes(
    Float32List samples, {
    int sampleRate = 16000,
    int numChannels = 1,
  }) {
    final numSamples = samples.length;
    const bitsPerSample = 16;
    final byteRate = sampleRate * numChannels * (bitsPerSample ~/ 8);
    final blockAlign = numChannels * (bitsPerSample ~/ 8);
    final dataSize = numSamples * (bitsPerSample ~/ 8);
    final totalSize = 36 + dataSize;

    final bytes = Uint8List(44 + dataSize);
    final bd = ByteData.sublistView(bytes);

    // RIFF chunk descriptor
    bd.setUint8(0, 0x52); // 'R'
    bd.setUint8(1, 0x49); // 'I'
    bd.setUint8(2, 0x46); // 'F'
    bd.setUint8(3, 0x46); // 'F'
    bd.setUint32(4, totalSize, Endian.little);
    bd.setUint8(8, 0x57); // 'W'
    bd.setUint8(9, 0x41); // 'A'
    bd.setUint8(10, 0x56); // 'V'
    bd.setUint8(11, 0x45); // 'E'

    // "fmt " sub-chunk
    bd.setUint8(12, 0x66); // 'f'
    bd.setUint8(13, 0x6D); // 'm'
    bd.setUint8(14, 0x74); // 't'
    bd.setUint8(15, 0x20); // ' '
    bd.setUint32(16, 16, Endian.little); // Subchunk1Size (16 for PCM)
    bd.setUint16(20, 1, Endian.little); // AudioFormat (1 = PCM)
    bd.setUint16(22, numChannels, Endian.little);
    bd.setUint32(24, sampleRate, Endian.little);
    bd.setUint32(28, byteRate, Endian.little);
    bd.setUint16(32, blockAlign, Endian.little);
    bd.setUint16(34, bitsPerSample, Endian.little);

    // "data" sub-chunk
    bd.setUint8(36, 0x64); // 'd'
    bd.setUint8(37, 0x61); // 'a'
    bd.setUint8(38, 0x74); // 't'
    bd.setUint8(39, 0x61); // 'a'
    bd.setUint32(40, dataSize, Endian.little);

    // Write 16-bit PCM audio samples
    var offset = 44;
    for (var i = 0; i < numSamples; i++) {
      final clamped = samples[i].clamp(-1.0, 1.0);
      final intSample = (clamped * 32767).toInt();
      bd.setInt16(offset, intSample, Endian.little);
      offset += 2;
    }

    return bytes;
  }

  /// Decodes 16-bit PCM WAV bytes into normalized Float32 samples.
  static Float32List wavBytesToPcmFloat32(Uint8List wavBytes) {
    if (wavBytes.length < 44) {
      throw const SttException(
        SttErrorType.invalidAudio,
        'WAV byte buffer is too short to contain a valid header',
      );
    }

    final bd = ByteData.sublistView(wavBytes);

    // Look for 'data' chunk in WAV header
    var dataOffset = 12;
    var dataLength = 0;

    while (dataOffset < wavBytes.length - 8) {
      final chunkId = String.fromCharCodes(
        wavBytes.sublist(dataOffset, dataOffset + 4),
      );
      final chunkSize = bd.getUint32(dataOffset + 4, Endian.little);

      if (chunkId == 'data') {
        dataOffset += 8;
        dataLength = chunkSize > (wavBytes.length - dataOffset)
            ? (wavBytes.length - dataOffset)
            : chunkSize;
        break;
      }

      dataOffset += 8 + chunkSize;
    }

    if (dataLength == 0 || dataOffset >= wavBytes.length) {
      // Fallback: assume raw 16-bit PCM after standard 44-byte header
      dataOffset = 44;
      dataLength = wavBytes.length - 44;
    }

    final numSamples = dataLength ~/ 2;
    final samples = Float32List(numSamples);

    for (var i = 0; i < numSamples; i++) {
      final intSample = bd.getInt16(dataOffset + (i * 2), Endian.little);
      samples[i] = intSample / 32768.0;
    }

    return samples;
  }
}
