import 'package:flutter/foundation.dart';

/// Available Speech-to-Text inference backends in Scholiast.
enum SttProvider {
  localWhisper,
  groq,
  openAi,
  gemini;

  bool get isLocal => this == SttProvider.localWhisper;
  bool get isCloud => !isLocal;

  String get id {
    switch (this) {
      case SttProvider.localWhisper:
        return 'local_whisper';
      case SttProvider.groq:
        return 'groq';
      case SttProvider.openAi:
        return 'openai';
      case SttProvider.gemini:
        return 'gemini';
    }
  }

  String get displayName {
    switch (this) {
      case SttProvider.localWhisper:
        return 'Local Whisper (On-Device)';
      case SttProvider.groq:
        return 'Groq (Whisper Cloud)';
      case SttProvider.openAi:
        return 'OpenAI (Whisper-1)';
      case SttProvider.gemini:
        return 'Google Gemini Audio';
    }
  }

  static SttProvider fromId(String id) {
    switch (id.toLowerCase().trim()) {
      case 'local_whisper':
      case 'localwhisper':
      case 'whisper':
      case 'local':
        return SttProvider.localWhisper;
      case 'groq':
        return SttProvider.groq;
      case 'openai':
      case 'open_ai':
        return SttProvider.openAi;
      case 'gemini':
      case 'google':
        return SttProvider.gemini;
      default:
        return SttProvider.localWhisper;
    }
  }
}

/// Categorized error types for STT failures.
enum SttErrorType {
  network,
  unauthorized,
  rateLimited,
  notConfigured,
  invalidAudio,
  modelNotLoaded,
  nativeLibraryMissing,
  serverError,
  unknown,
}

/// Exception thrown when Speech-to-Text transcription fails.
class SttException implements Exception {
  final SttErrorType errorType;
  final String message;
  final SttProvider? provider;
  final dynamic cause;

  const SttException(
    this.errorType,
    this.message, {
    this.provider,
    this.cause,
  });

  @override
  String toString() =>
      'SttException(${errorType.name}, provider: ${provider?.id ?? "unknown"}): $message${cause != null ? " (cause: $cause)" : ""}';
}

/// Word- or segment-level timestamp entry from STT transcription.
@immutable
class SttWordTimestamp {
  final int startMs;
  final int endMs;
  final String text;
  final double? confidence;

  const SttWordTimestamp({
    required this.startMs,
    required this.endMs,
    required this.text,
    this.confidence,
  });

  factory SttWordTimestamp.fromJson(Map<String, dynamic> json) {
    return SttWordTimestamp(
      startMs: (json['startMs'] as num?)?.toInt() ??
          ((json['start'] as num?)?.toDouble() != null
              ? ((json['start'] as num).toDouble() * 1000).toInt()
              : 0),
      endMs: (json['endMs'] as num?)?.toInt() ??
          ((json['end'] as num?)?.toDouble() != null
              ? ((json['end'] as num).toDouble() * 1000).toInt()
              : 0),
      text: json['text'] as String? ?? '',
      confidence: (json['confidence'] as num?)?.toDouble(),
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'startMs': startMs,
        'endMs': endMs,
        'text': text,
        if (confidence != null) 'confidence': confidence,
      };

  SttWordTimestamp copyWith({
    int? startMs,
    int? endMs,
    String? text,
    double? confidence,
  }) {
    return SttWordTimestamp(
      startMs: startMs ?? this.startMs,
      endMs: endMs ?? this.endMs,
      text: text ?? this.text,
      confidence: confidence ?? this.confidence,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SttWordTimestamp &&
          runtimeType == other.runtimeType &&
          startMs == other.startMs &&
          endMs == other.endMs &&
          text == other.text &&
          confidence == other.confidence;

  @override
  int get hashCode => Object.hash(startMs, endMs, text, confidence);

  @override
  String toString() =>
      'SttWordTimestamp($startMs-$endMs ms: "$text"${confidence != null ? " [$confidence]" : ""})';
}

/// Unified transcription result returned by STT engines.
@immutable
class SttResult {
  final String text;
  final String? language;
  final Duration? duration;
  final bool isFinal;
  final SttProvider provider;
  final List<SttWordTimestamp>? timestamps;
  final double? confidence;
  final Map<String, dynamic>? rawMetadata;

  const SttResult({
    required this.text,
    this.language,
    this.duration,
    this.isFinal = true,
    required this.provider,
    this.timestamps,
    this.confidence,
    this.rawMetadata,
  });

  factory SttResult.fromJson(Map<String, dynamic> json) {
    return SttResult(
      text: json['text'] as String? ?? '',
      language: json['language'] as String?,
      duration: json['durationMs'] != null
          ? Duration(milliseconds: (json['durationMs'] as num).toInt())
          : null,
      isFinal: json['isFinal'] as bool? ?? true,
      provider: SttProvider.fromId(json['provider'] as String? ?? 'local_whisper'),
      timestamps: (json['timestamps'] as List<dynamic>?)
          ?.map((e) => SttWordTimestamp.fromJson(e as Map<String, dynamic>))
          .toList(),
      confidence: (json['confidence'] as num?)?.toDouble(),
      rawMetadata: json['rawMetadata'] as Map<String, dynamic>?,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'text': text,
        if (language != null) 'language': language,
        if (duration != null) 'durationMs': duration!.inMilliseconds,
        'isFinal': isFinal,
        'provider': provider.id,
        if (timestamps != null)
          'timestamps': timestamps!.map((t) => t.toJson()).toList(),
        if (confidence != null) 'confidence': confidence,
        if (rawMetadata != null) 'rawMetadata': rawMetadata,
      };

  SttResult copyWith({
    String? text,
    String? language,
    Duration? duration,
    bool? isFinal,
    SttProvider? provider,
    List<SttWordTimestamp>? timestamps,
    double? confidence,
    Map<String, dynamic>? rawMetadata,
  }) {
    return SttResult(
      text: text ?? this.text,
      language: language ?? this.language,
      duration: duration ?? this.duration,
      isFinal: isFinal ?? this.isFinal,
      provider: provider ?? this.provider,
      timestamps: timestamps ?? this.timestamps,
      confidence: confidence ?? this.confidence,
      rawMetadata: rawMetadata ?? this.rawMetadata,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SttResult &&
          runtimeType == other.runtimeType &&
          text == other.text &&
          language == other.language &&
          duration == other.duration &&
          isFinal == other.isFinal &&
          provider == other.provider &&
          listEquals(timestamps, other.timestamps) &&
          confidence == other.confidence;

  @override
  int get hashCode => Object.hash(
        text,
        language,
        duration,
        isFinal,
        provider,
        timestamps == null ? null : Object.hashAll(timestamps!),
        confidence,
      );

  @override
  String toString() =>
      'SttResult(provider: ${provider.id}, text: "$text", lang: $language, isFinal: $isFinal)';
}

/// Metadata and state for a local GGML Whisper model file.
@immutable
class WhisperModelInfo {
  final String id;
  final String name;
  final String url;
  final String fileName;
  final int sizeBytes;
  final bool isDownloaded;
  final String? localPath;
  final String? sha256;
  final bool isEnglishOnly;

  const WhisperModelInfo({
    required this.id,
    required this.name,
    required this.url,
    required this.fileName,
    required this.sizeBytes,
    this.isDownloaded = false,
    this.localPath,
    this.sha256,
    this.isEnglishOnly = false,
  });

  static const String huggingFaceBase =
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';

  static const WhisperModelInfo tinyEn = WhisperModelInfo(
    id: 'tiny.en',
    name: 'Tiny (English) — Fastest (~78MB)',
    url: '${huggingFaceBase}ggml-tiny.en.bin',
    fileName: 'ggml-tiny.en.bin',
    sizeBytes: 77700000,
    isEnglishOnly: true,
  );

  static const WhisperModelInfo tiny = WhisperModelInfo(
    id: 'tiny',
    name: 'Tiny (Multilingual) — Fast (~78MB)',
    url: '${huggingFaceBase}ggml-tiny.bin',
    fileName: 'ggml-tiny.bin',
    sizeBytes: 77700000,
    isEnglishOnly: false,
  );

  static const WhisperModelInfo baseEn = WhisperModelInfo(
    id: 'base.en',
    name: 'Base (English) — Balanced (~148MB)',
    url: '${huggingFaceBase}ggml-base.en.bin',
    fileName: 'ggml-base.en.bin',
    sizeBytes: 148000000,
    isEnglishOnly: true,
  );

  static const WhisperModelInfo base = WhisperModelInfo(
    id: 'base',
    name: 'Base (Multilingual) — Balanced (~148MB)',
    url: '${huggingFaceBase}ggml-base.bin',
    fileName: 'ggml-base.bin',
    sizeBytes: 148000000,
    isEnglishOnly: false,
  );

  static const WhisperModelInfo smallEn = WhisperModelInfo(
    id: 'small.en',
    name: 'Small (English) — High Accuracy (~488MB)',
    url: '${huggingFaceBase}ggml-small.en.bin',
    fileName: 'ggml-small.en.bin',
    sizeBytes: 488000000,
    isEnglishOnly: true,
  );

  static const WhisperModelInfo small = WhisperModelInfo(
    id: 'small',
    name: 'Small (Multilingual) — High Accuracy (~488MB)',
    url: '${huggingFaceBase}ggml-small.bin',
    fileName: 'ggml-small.bin',
    sizeBytes: 488000000,
    isEnglishOnly: false,
  );

  /// Default model catalogue shipped with Scholiast.
  static const List<WhisperModelInfo> standardModels = [
    tinyEn,
    tiny,
    baseEn,
    base,
    smallEn,
    small,
  ];

  static const WhisperModelInfo defaultModel = tinyEn;

  WhisperModelInfo copyWith({
    String? id,
    String? name,
    String? url,
    String? fileName,
    int? sizeBytes,
    bool? isDownloaded,
    String? localPath,
    String? sha256,
    bool? isEnglishOnly,
  }) {
    return WhisperModelInfo(
      id: id ?? this.id,
      name: name ?? this.name,
      url: url ?? this.url,
      fileName: fileName ?? this.fileName,
      sizeBytes: sizeBytes ?? this.sizeBytes,
      isDownloaded: isDownloaded ?? this.isDownloaded,
      localPath: localPath ?? this.localPath,
      sha256: sha256 ?? this.sha256,
      isEnglishOnly: isEnglishOnly ?? this.isEnglishOnly,
    );
  }

  factory WhisperModelInfo.fromJson(Map<String, dynamic> json) {
    return WhisperModelInfo(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      url: json['url'] as String? ?? '',
      fileName: json['fileName'] as String? ?? '',
      sizeBytes: (json['sizeBytes'] as num?)?.toInt() ?? 0,
      isDownloaded: json['isDownloaded'] as bool? ?? false,
      localPath: json['localPath'] as String?,
      sha256: json['sha256'] as String?,
      isEnglishOnly: json['isEnglishOnly'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'name': name,
        'url': url,
        'fileName': fileName,
        'sizeBytes': sizeBytes,
        'isDownloaded': isDownloaded,
        if (localPath != null) 'localPath': localPath,
        if (sha256 != null) 'sha256': sha256,
        'isEnglishOnly': isEnglishOnly,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is WhisperModelInfo &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          name == other.name &&
          url == other.url &&
          fileName == other.fileName &&
          sizeBytes == other.sizeBytes &&
          isDownloaded == other.isDownloaded &&
          localPath == other.localPath &&
          sha256 == other.sha256 &&
          isEnglishOnly == other.isEnglishOnly;

  @override
  int get hashCode => Object.hash(
        id,
        name,
        url,
        fileName,
        sizeBytes,
        isDownloaded,
        localPath,
        sha256,
        isEnglishOnly,
      );

  @override
  String toString() =>
      'WhisperModelInfo($id, downloaded: $isDownloaded, path: $localPath)';
}
