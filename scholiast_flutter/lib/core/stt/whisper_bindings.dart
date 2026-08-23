import 'dart:ffi';
import 'dart:io';
import 'package:ffi/ffi.dart';
import 'package:flutter/foundation.dart';
import 'stt_models.dart';

/// Opaque handle to a whisper context in native memory.
final class WhisperContext extends Opaque {}

/// Sampling strategy for Whisper decoding.
abstract class WhisperSamplingStrategy {
  static const int greedy = 0;
  static const int beamSearch = 1;
}

/// Context initialization parameters.
final class WhisperContextParams extends Struct {
  @Bool()
  external bool useGpu;
}

/// Full inference parameters for whisper_full().
final class WhisperFullParams extends Struct {
  @Int32()
  external int strategy;

  @Int32()
  external int nThreads;

  @Int32()
  external int nMaxTextCtx;

  @Int32()
  external int offsetMs;

  @Int32()
  external int durationMs;

  @Bool()
  external bool translate;

  @Bool()
  external bool noContext;

  @Bool()
  external bool noTimestamps;

  @Bool()
  external bool singleSegment;

  @Bool()
  external bool printSpecial;

  @Bool()
  external bool printProgress;

  @Bool()
  external bool printRealtime;

  @Bool()
  external bool printTimestamps;

  @Bool()
  external bool tokenTimestamps;

  @Float()
  external double tholdPt;

  @Float()
  external double tholdPtsum;

  @Int32()
  external int maxLen;

  @Bool()
  external bool splitOnWord;

  @Int32()
  external int maxTokens;

  @Bool()
  external bool speedUp;

  @Bool()
  external bool debugMode;

  @Int32()
  external int audioCtx;

  @Bool()
  external bool tdrzEnable;

  external Pointer<Utf8> initialPrompt;
  external Pointer<Int32> promptTokens;

  @Int32()
  external int promptNTokens;

  external Pointer<Utf8> language;

  @Bool()
  external bool detectLanguage;

  external Pointer<Int32> allowedLangs;

  @Size()
  external int allowedLangsSize;

  @Bool()
  external bool suppressBlank;

  @Bool()
  external bool suppressNonSpeechTokens;

  @Float()
  external double temperature;

  @Float()
  external double maxInitialTs;

  @Float()
  external double lengthPenalty;

  @Float()
  external double temperatureInc;

  @Float()
  external double entropyThold;

  @Float()
  external double logprobThold;

  @Float()
  external double noSpeechThold;

  @Int32()
  external int greedyBestOf;

  @Int32()
  external int beamSearchBeamSize;

  @Float()
  external double beamSearchPatience;

  external Pointer<Void> newSegmentCallback;
  external Pointer<Void> newSegmentCallbackUserData;

  external Pointer<Void> partialTextCallback;
  external Pointer<Void> partialTextCallbackUserData;

  external Pointer<Void> progressCallback;
  external Pointer<Void> progressCallbackUserData;

  external Pointer<Void> encoderBeginCallback;
  external Pointer<Void> encoderBeginCallbackUserData;

  external Pointer<Void> abortCallback;
  external Pointer<Void> abortCallbackUserData;

  external Pointer<Void> logitsFilterCallback;
  external Pointer<Void> logitsFilterCallbackUserData;

  external Pointer<Pointer> grammarRules;

  @Size()
  external int nGrammarRules;

  @Size()
  external int iStartRule;

  @Float()
  external double grammarPenalty;
}

// --- Native FFI Typedefs ---

typedef _WhisperInitFromFileNative = Pointer<WhisperContext> Function(
    Pointer<Utf8> pathModel);
typedef _WhisperInitFromFileDart = Pointer<WhisperContext> Function(
    Pointer<Utf8> pathModel);

typedef _WhisperInitFromFileWithParamsNative = Pointer<WhisperContext> Function(
    Pointer<Utf8> pathModel, WhisperContextParams params);
typedef _WhisperInitFromFileWithParamsDart = Pointer<WhisperContext> Function(
    Pointer<Utf8> pathModel, WhisperContextParams params);

typedef _WhisperContextDefaultParamsByRefNative = Pointer<WhisperContextParams>
    Function();
typedef _WhisperContextDefaultParamsByRefDart = Pointer<WhisperContextParams>
    Function();

typedef _WhisperFullDefaultParamsByRefNative = Pointer<WhisperFullParams>
    Function(Int32 strategy);
typedef _WhisperFullDefaultParamsByRefDart = Pointer<WhisperFullParams> Function(
    int strategy);

typedef _WhisperFreeParamsNative = Void Function(
    Pointer<WhisperFullParams> params);
typedef _WhisperFreeParamsDart = void Function(
    Pointer<WhisperFullParams> params);

typedef _WhisperFreeContextParamsNative = Void Function(
    Pointer<WhisperContextParams> params);
typedef _WhisperFreeContextParamsDart = void Function(
    Pointer<WhisperContextParams> params);

typedef _WhisperFullNative = Int32 Function(
    Pointer<WhisperContext> ctx,
    WhisperFullParams params,
    Pointer<Float> samples,
    Int32 nSamples);
typedef _WhisperFullDart = int Function(
    Pointer<WhisperContext> ctx,
    WhisperFullParams params,
    Pointer<Float> samples,
    int nSamples);

typedef _WhisperFullNSegmentsNative = Int32 Function(
    Pointer<WhisperContext> ctx);
typedef _WhisperFullNSegmentsDart = int Function(Pointer<WhisperContext> ctx);

typedef _WhisperFullGetSegmentTextNative = Pointer<Utf8> Function(
    Pointer<WhisperContext> ctx, Int32 iSegment);
typedef _WhisperFullGetSegmentTextDart = Pointer<Utf8> Function(
    Pointer<WhisperContext> ctx, int iSegment);

typedef _WhisperFullGetSegmentT0Native = Int64 Function(
    Pointer<WhisperContext> ctx, Int32 iSegment);
typedef _WhisperFullGetSegmentT0Dart = int Function(
    Pointer<WhisperContext> ctx, int iSegment);

typedef _WhisperFullGetSegmentT1Native = Int64 Function(
    Pointer<WhisperContext> ctx, Int32 iSegment);
typedef _WhisperFullGetSegmentT1Dart = int Function(
    Pointer<WhisperContext> ctx, int iSegment);

typedef _WhisperFreeNative = Void Function(Pointer<WhisperContext> ctx);
typedef _WhisperFreeDart = void Function(Pointer<WhisperContext> ctx);

typedef _WhisperPrintSystemInfoNative = Pointer<Utf8> Function();
typedef _WhisperPrintSystemInfoDart = Pointer<Utf8> Function();

/// High-level Dart FFI bindings for `libwhisper.so` / `libscholiast_whisper.so`.
class WhisperBindings {
  final DynamicLibrary _lib;

  late final _WhisperInitFromFileDart? _whisperInitFromFile;
  late final _WhisperInitFromFileWithParamsDart? _whisperInitFromFileWithParams;
  late final _WhisperContextDefaultParamsByRefDart?
      _whisperContextDefaultParamsByRef;
  late final _WhisperFullDefaultParamsByRefDart _whisperFullDefaultParamsByRef;
  late final _WhisperFreeParamsDart? _whisperFreeParams;
  late final _WhisperFreeContextParamsDart? _whisperFreeContextParams;
  late final _WhisperFullDart _whisperFull;
  late final _WhisperFullNSegmentsDart _whisperFullNSegments;
  late final _WhisperFullGetSegmentTextDart _whisperFullGetSegmentText;
  late final _WhisperFullGetSegmentT0Dart? _whisperFullGetSegmentT0;
  late final _WhisperFullGetSegmentT1Dart? _whisperFullGetSegmentT1;
  late final _WhisperFreeDart _whisperFree;
  late final _WhisperPrintSystemInfoDart? _whisperPrintSystemInfo;

  WhisperBindings._(this._lib) {
    try {
      _whisperInitFromFile = _lib.lookupFunction<
          _WhisperInitFromFileNative,
          _WhisperInitFromFileDart>('whisper_init_from_file');
    } catch (_) {
      _whisperInitFromFile = null;
    }

    try {
      _whisperInitFromFileWithParams = _lib.lookupFunction<
          _WhisperInitFromFileWithParamsNative,
          _WhisperInitFromFileWithParamsDart>(
          'whisper_init_from_file_with_params');
    } catch (_) {
      _whisperInitFromFileWithParams = null;
    }

    try {
      _whisperContextDefaultParamsByRef = _lib.lookupFunction<
          _WhisperContextDefaultParamsByRefNative,
          _WhisperContextDefaultParamsByRefDart>(
          'whisper_context_default_params_by_ref');
    } catch (_) {
      _whisperContextDefaultParamsByRef = null;
    }

    _whisperFullDefaultParamsByRef = _lib.lookupFunction<
        _WhisperFullDefaultParamsByRefNative,
        _WhisperFullDefaultParamsByRefDart>('whisper_full_default_params_by_ref');

    try {
      _whisperFreeParams = _lib.lookupFunction<
          _WhisperFreeParamsNative,
          _WhisperFreeParamsDart>('whisper_free_params');
    } catch (_) {
      _whisperFreeParams = null;
    }

    try {
      _whisperFreeContextParams = _lib.lookupFunction<
          _WhisperFreeContextParamsNative,
          _WhisperFreeContextParamsDart>('whisper_free_context_params');
    } catch (_) {
      _whisperFreeContextParams = null;
    }

    _whisperFull = _lib.lookupFunction<_WhisperFullNative, _WhisperFullDart>(
        'whisper_full');

    _whisperFullNSegments = _lib.lookupFunction<
        _WhisperFullNSegmentsNative,
        _WhisperFullNSegmentsDart>('whisper_full_n_segments');

    _whisperFullGetSegmentText = _lib.lookupFunction<
        _WhisperFullGetSegmentTextNative,
        _WhisperFullGetSegmentTextDart>('whisper_full_get_segment_text');

    try {
      _whisperFullGetSegmentT0 = _lib.lookupFunction<
          _WhisperFullGetSegmentT0Native,
          _WhisperFullGetSegmentT0Dart>('whisper_full_get_segment_t0');
    } catch (_) {
      _whisperFullGetSegmentT0 = null;
    }

    try {
      _whisperFullGetSegmentT1 = _lib.lookupFunction<
          _WhisperFullGetSegmentT1Native,
          _WhisperFullGetSegmentT1Dart>('whisper_full_get_segment_t1');
    } catch (_) {
      _whisperFullGetSegmentT1 = null;
    }

    _whisperFree = _lib.lookupFunction<_WhisperFreeNative, _WhisperFreeDart>(
        'whisper_free');

    try {
      _whisperPrintSystemInfo = _lib.lookupFunction<
          _WhisperPrintSystemInfoNative,
          _WhisperPrintSystemInfoDart>('whisper_print_system_info');
    } catch (_) {
      _whisperPrintSystemInfo = null;
    }
  }

  /// Whether the native library is loaded and ready for inference.
  bool get isAvailable => true;

  /// Loads Whisper native bindings with platform library candidate fallbacks.
  /// Returns null if the library cannot be opened dynamically.
  static WhisperBindings? load({
    String? customLibraryPath,
    DynamicLibrary? dynamicLibrary,
  }) {
    if (dynamicLibrary != null) {
      try {
        return WhisperBindings._(dynamicLibrary);
      } catch (e) {
        debugPrint('WhisperBindings: Failed to init from provided library: $e');
        return null;
      }
    }

    final candidates = <String>[];
    if (customLibraryPath != null && customLibraryPath.isNotEmpty) {
      candidates.add(customLibraryPath);
    }

    if (Platform.isAndroid) {
      candidates.addAll([
        'libscholiast_whisper.so',
        'libwhisper.so',
      ]);
    } else if (Platform.isLinux) {
      candidates.addAll([
        'libscholiast_whisper.so',
        'libwhisper.so',
        './libscholiast_whisper.so',
        './libwhisper.so',
        '/usr/local/lib/libwhisper.so',
        '/usr/lib/libwhisper.so',
      ]);
    } else if (Platform.isMacOS || Platform.isIOS) {
      candidates.addAll([
        'libscholiast_whisper.dylib',
        'libwhisper.dylib',
        'whisper.framework/whisper',
      ]);
    } else if (Platform.isWindows) {
      candidates.addAll([
        'scholiast_whisper.dll',
        'whisper.dll',
        'libwhisper.dll',
      ]);
    }

    for (final candidate in candidates) {
      try {
        final lib = DynamicLibrary.open(candidate);
        return WhisperBindings._(lib);
      } catch (_) {
        // Try next candidate
      }
    }

    // Try process lookup fallback (e.g. if statically or globally linked)
    try {
      final lib = DynamicLibrary.process();
      return WhisperBindings._(lib);
    } catch (_) {
      // Library not available
    }

    return null;
  }

  /// Initializes a Whisper context from a GGML model file on disk.
  Pointer<WhisperContext>? initFromFile(String modelPath) {
    final pathPtr = modelPath.toNativeUtf8();
    try {
      final initWithParams = _whisperInitFromFileWithParams;
      final defaultContextParams = _whisperContextDefaultParamsByRef;
      final freeContextParams = _whisperFreeContextParams;

      if (initWithParams != null && defaultContextParams != null) {
        final cparamsPtr = defaultContextParams();
        try {
          final ctx = initWithParams(pathPtr, cparamsPtr.ref);
          return ctx.address == 0 ? null : ctx;
        } finally {
          if (freeContextParams != null) {
            freeContextParams(cparamsPtr);
          } else {
            calloc.free(cparamsPtr);
          }
        }
      } else {
        final initFunc = _whisperInitFromFile;
        if (initFunc != null) {
          final ctx = initFunc(pathPtr);
          return ctx.address == 0 ? null : ctx;
        }
      }
      return null;
    } catch (e) {
      debugPrint('WhisperBindings: initFromFile failed: $e');
      return null;
    } finally {
      calloc.free(pathPtr);
    }
  }

  /// Runs inference on 16kHz float32 audio samples.
  /// Returns 0 on success, non-zero error code on failure.
  int full(
    Pointer<WhisperContext> ctx,
    Float32List samples, {
    String? language,
    int nThreads = 4,
    bool translate = false,
  }) {
    if (ctx.address == 0 || samples.isEmpty) return -1;

    final paramsPtr =
        _whisperFullDefaultParamsByRef(WhisperSamplingStrategy.greedy);
    Pointer<Utf8>? langPtr;
    Pointer<Float>? samplesPtr;

    try {
      paramsPtr.ref.nThreads = nThreads;
      paramsPtr.ref.translate = translate;
      paramsPtr.ref.printSpecial = false;
      paramsPtr.ref.printProgress = false;
      paramsPtr.ref.printRealtime = false;
      paramsPtr.ref.printTimestamps = false;
      paramsPtr.ref.noTimestamps = false;

      if (language != null && language.isNotEmpty && language != 'auto') {
        langPtr = language.toNativeUtf8();
        paramsPtr.ref.language = langPtr;
        paramsPtr.ref.detectLanguage = false;
      } else {
        paramsPtr.ref.detectLanguage = true;
      }

      samplesPtr = calloc<Float>(samples.length);
      final sampleList = samplesPtr.asTypedList(samples.length);
      sampleList.setAll(0, samples);

      return _whisperFull(ctx, paramsPtr.ref, samplesPtr, samples.length);
    } finally {
      if (langPtr != null) calloc.free(langPtr);
      if (samplesPtr != null) calloc.free(samplesPtr);
      final freeParams = _whisperFreeParams;
      if (freeParams != null) {
        freeParams(paramsPtr);
      } else {
        calloc.free(paramsPtr);
      }
    }
  }

  /// Number of text segments produced by the last full inference.
  int getNumSegments(Pointer<WhisperContext> ctx) {
    if (ctx.address == 0) return 0;
    return _whisperFullNSegments(ctx);
  }

  /// Text content of the [iSegment] segment.
  String getSegmentText(Pointer<WhisperContext> ctx, int iSegment) {
    if (ctx.address == 0) return '';
    final textPtr = _whisperFullGetSegmentText(ctx, iSegment);
    if (textPtr.address == 0) return '';
    return textPtr.toDartString().trim();
  }

  /// Start time in milliseconds of segment [iSegment].
  int getSegmentT0(Pointer<WhisperContext> ctx, int iSegment) {
    final getT0 = _whisperFullGetSegmentT0;
    if (ctx.address == 0 || getT0 == null) return 0;
    return (getT0(ctx, iSegment) * 10).toInt();
  }

  /// End time in milliseconds of segment [iSegment].
  int getSegmentT1(Pointer<WhisperContext> ctx, int iSegment) {
    final getT1 = _whisperFullGetSegmentT1;
    if (ctx.address == 0 || getT1 == null) return 0;
    return (getT1(ctx, iSegment) * 10).toInt();
  }

  /// Transcribes audio samples and returns full aggregated text.
  String transcribeText(
    Pointer<WhisperContext> ctx,
    Float32List samples, {
    String? language,
    int nThreads = 4,
    bool translate = false,
  }) {
    final status = full(
      ctx,
      samples,
      language: language,
      nThreads: nThreads,
      translate: translate,
    );
    if (status != 0) {
      throw SttException(
        SttErrorType.unknown,
        'Whisper inference failed with exit code $status',
        provider: SttProvider.localWhisper,
      );
    }

    final nSegments = getNumSegments(ctx);
    final buffer = StringBuffer();
    for (var i = 0; i < nSegments; i++) {
      final text = getSegmentText(ctx, i);
      if (text.isNotEmpty) {
        if (buffer.isNotEmpty) buffer.write(' ');
        buffer.write(text);
      }
    }
    return buffer.toString().trim();
  }

  /// Transcribes audio samples and extracts segment timestamps.
  List<SttWordTimestamp> getSegments(Pointer<WhisperContext> ctx) {
    final nSegments = getNumSegments(ctx);
    final segments = <SttWordTimestamp>[];
    for (var i = 0; i < nSegments; i++) {
      final text = getSegmentText(ctx, i);
      if (text.isNotEmpty) {
        segments.add(
          SttWordTimestamp(
            startMs: getSegmentT0(ctx, i),
            endMs: getSegmentT1(ctx, i),
            text: text,
          ),
        );
      }
    }
    return segments;
  }

  /// Frees the native whisper context and its memory.
  void freeContext(Pointer<WhisperContext> ctx) {
    if (ctx.address != 0) {
      _whisperFree(ctx);
    }
  }

  /// Returns system diagnostic and hardware acceleration info from whisper.cpp.
  String getSystemInfo() {
    final printSysInfo = _whisperPrintSystemInfo;
    if (printSysInfo != null) {
      final infoPtr = printSysInfo();
      if (infoPtr.address != 0) {
        return infoPtr.toDartString();
      }
    }
    return 'whisper.cpp (dynamic FFI)';
  }
}
