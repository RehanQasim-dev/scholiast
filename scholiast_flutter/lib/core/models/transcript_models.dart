import 'package:flutter/foundation.dart';
import 'video_item.dart' show jsNum;

/// A single caption cue: one timestamped segment from the caption track.
///
/// [cueIndex] is the cue's position in the events array — the stable anchor key
/// for `TranscriptAnchor(startCue, startOffset, endCue, endOffset)`.
/// [start] and [duration] are in seconds (floating point).
@immutable
class Cue {
  final double start;
  final double duration;
  final String text;
  final int cueIndex;

  const Cue({
    required this.start,
    required this.duration,
    required this.text,
    required this.cueIndex,
  });

  /// End timestamp in seconds (millisecond precision).
  double get end => ((start + duration) * 1000).round() / 1000.0;

  /// Alias for [cueIndex] matching Kotlin / TS index naming.
  int get index => cueIndex;

  /// Start timestamp in milliseconds.
  int get startMs => (start * 1000).round();

  /// End timestamp in milliseconds.
  int get endMs => (end * 1000).round();

  /// Duration in milliseconds.
  int get durationMs => (duration * 1000).round();

  Cue copyWith({
    double? start,
    double? duration,
    String? text,
    int? cueIndex,
  }) {
    return Cue(
      start: start ?? this.start,
      duration: duration ?? this.duration,
      text: text ?? this.text,
      cueIndex: cueIndex ?? this.cueIndex,
    );
  }

  factory Cue.fromJson(Map<String, dynamic> json) {
    final startVal = (json['start'] as num?)?.toDouble() ??
        ((json['startMs'] as num?)?.toDouble() ?? 0.0) / 1000.0;
    final durVal = (json['duration'] as num?)?.toDouble() ??
        ((json['durationMs'] as num?)?.toDouble() ??
            (((json['endMs'] as num?)?.toDouble() ?? (startVal * 1000.0)) -
                    (startVal * 1000.0)) /
                1000.0);
    return Cue(
      start: startVal,
      duration: durVal,
      text: json['text'] as String? ?? '',
      cueIndex: (json['cueIndex'] as num?)?.toInt() ??
          (json['index'] as num?)?.toInt() ??
          0,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'start': jsNum(start),
        'duration': jsNum(duration),
        'text': text,
        'cueIndex': cueIndex,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is Cue &&
          runtimeType == other.runtimeType &&
          start == other.start &&
          duration == other.duration &&
          text == other.text &&
          cueIndex == other.cueIndex;

  @override
  int get hashCode => Object.hash(start, duration, text, cueIndex);

  @override
  String toString() =>
      'Cue(index: $cueIndex, start: ${start}s, dur: ${duration}s, text: "$text")';
}

/// The TS name for [Cue], for code that ports `video-transcript.ts` verbatim.
typedef TranscriptCue = Cue;

/// A readable paragraph: a run of consecutive cues grouped by [TranscriptChunker].
///
/// [start] is the start time in seconds (matching the first cue).
/// [text] is the joined text of the cues for display/search.
/// [cues] preserves individual cue timestamps and boundaries for offset anchoring.
@immutable
class CueParagraph {
  final double start;
  final String text;
  final List<Cue> cues;

  const CueParagraph({
    required this.start,
    required this.text,
    this.cues = const <Cue>[],
  });

  /// End timestamp in seconds (from the last cue, or [start] if empty).
  double get end => cues.isNotEmpty ? cues.last.end : start;

  /// Duration in seconds (millisecond precision).
  double get duration => ((end - start) * 1000).round() / 1000.0;

  /// Index of the first cue in this paragraph.
  int get cueIndex => cues.isNotEmpty ? cues.first.cueIndex : 0;

  /// Alias for [cueIndex].
  int get index => cueIndex;

  /// Start timestamp in milliseconds.
  int get startMs => (start * 1000).round();

  /// End timestamp in milliseconds.
  int get endMs => (end * 1000).round();

  /// Cue index range (first cue index to last cue index).
  (int, int) get cueRange => cues.isNotEmpty
      ? (cues.first.cueIndex, cues.last.cueIndex)
      : (0, 0);

  /// Number of cues in this paragraph.
  int get cueCount => cues.length;

  CueParagraph copyWith({
    double? start,
    String? text,
    List<Cue>? cues,
  }) {
    return CueParagraph(
      start: start ?? this.start,
      text: text ?? this.text,
      cues: cues ?? this.cues,
    );
  }

  factory CueParagraph.fromJson(Map<String, dynamic> json) {
    final startVal = (json['start'] as num?)?.toDouble() ??
        ((json['startMs'] as num?)?.toDouble() ?? 0.0) / 1000.0;
    return CueParagraph(
      start: startVal,
      text: json['text'] as String? ?? '',
      cues: (json['cues'] as List<dynamic>?)
              ?.map((e) => Cue.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const <Cue>[],
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'start': jsNum(start),
        'text': text,
        'cues': cues.map((c) => c.toJson()).toList(),
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CueParagraph &&
          runtimeType == other.runtimeType &&
          start == other.start &&
          text == other.text &&
          listEquals(cues, other.cues);

  @override
  int get hashCode => Object.hash(start, text, Object.hashAll(cues));

  @override
  String toString() =>
      'CueParagraph(start: ${start}s, cues: ${cues.length}, text: "$text")';
}

/// The TS name for [CueParagraph], for code that ports `video-transcript.ts` verbatim.
typedef TranscriptParagraph = CueParagraph;

/// One entry of the player response captionTracks list.
@immutable
class CaptionTrack {
  final String languageCode;
  final String name;
  final String baseUrl;
  final bool isAsr;

  const CaptionTrack({
    required this.languageCode,
    required this.name,
    required this.baseUrl,
    this.isAsr = false,
  });

  CaptionTrack copyWith({
    String? languageCode,
    String? name,
    String? baseUrl,
    bool? isAsr,
  }) {
    return CaptionTrack(
      languageCode: languageCode ?? this.languageCode,
      name: name ?? this.name,
      baseUrl: baseUrl ?? this.baseUrl,
      isAsr: isAsr ?? this.isAsr,
    );
  }

  factory CaptionTrack.fromJson(Map<String, dynamic> json) => CaptionTrack(
        languageCode: json['languageCode'] as String? ?? '',
        name: json['name'] as String? ?? '',
        baseUrl: json['baseUrl'] as String? ?? '',
        isAsr: json['isAsr'] as bool? ?? json['isASR'] as bool? ?? false,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'languageCode': languageCode,
        'name': name,
        'baseUrl': baseUrl,
        'isAsr': isAsr,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CaptionTrack &&
          runtimeType == other.runtimeType &&
          languageCode == other.languageCode &&
          name == other.name &&
          baseUrl == other.baseUrl &&
          isAsr == other.isAsr;

  @override
  int get hashCode => Object.hash(languageCode, name, baseUrl, isAsr);

  @override
  String toString() =>
      'CaptionTrack(lang: $languageCode, name: "$name", isAsr: $isAsr)';
}

/// Alias for [CaptionTrack] matching TS `TranscriptTrack`.
typedef TranscriptTrack = CaptionTrack;

/// A fully loaded transcript: the track list, the cues, and the chunked paragraphs.
@immutable
class LoadedTranscript {
  final String videoId;
  final String languageCode;
  final List<CaptionTrack> tracks;
  final List<Cue> cues;
  final List<CueParagraph> paragraphs;

  const LoadedTranscript({
    required this.videoId,
    required this.languageCode,
    this.tracks = const <CaptionTrack>[],
    this.cues = const <Cue>[],
    this.paragraphs = const <CueParagraph>[],
  });

  LoadedTranscript copyWith({
    String? videoId,
    String? languageCode,
    List<CaptionTrack>? tracks,
    List<Cue>? cues,
    List<CueParagraph>? paragraphs,
  }) {
    return LoadedTranscript(
      videoId: videoId ?? this.videoId,
      languageCode: languageCode ?? this.languageCode,
      tracks: tracks ?? this.tracks,
      cues: cues ?? this.cues,
      paragraphs: paragraphs ?? this.paragraphs,
    );
  }

  factory LoadedTranscript.fromJson(Map<String, dynamic> json) =>
      LoadedTranscript(
        videoId: json['videoId'] as String? ?? '',
        languageCode: json['languageCode'] as String? ?? '',
        tracks: (json['tracks'] as List<dynamic>?)
                ?.map((e) => CaptionTrack.fromJson(e as Map<String, dynamic>))
                .toList() ??
            const <CaptionTrack>[],
        cues: (json['cues'] as List<dynamic>?)
                ?.map((e) => Cue.fromJson(e as Map<String, dynamic>))
                .toList() ??
            const <Cue>[],
        paragraphs: (json['paragraphs'] as List<dynamic>?)
                ?.map((e) => CueParagraph.fromJson(e as Map<String, dynamic>))
                .toList() ??
            const <CueParagraph>[],
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'videoId': videoId,
        'languageCode': languageCode,
        'tracks': tracks.map((t) => t.toJson()).toList(),
        'cues': cues.map((c) => c.toJson()).toList(),
        'paragraphs': paragraphs.map((p) => p.toJson()).toList(),
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is LoadedTranscript &&
          runtimeType == other.runtimeType &&
          videoId == other.videoId &&
          languageCode == other.languageCode &&
          listEquals(tracks, other.tracks) &&
          listEquals(cues, other.cues) &&
          listEquals(paragraphs, other.paragraphs);

  @override
  int get hashCode => Object.hash(
        videoId,
        languageCode,
        Object.hashAll(tracks),
        Object.hashAll(cues),
        Object.hashAll(paragraphs),
      );
}

/// Typed outcome of transcript retrieval.
sealed class TranscriptResult {
  const TranscriptResult();
}

class TranscriptSuccess extends TranscriptResult {
  final LoadedTranscript transcript;
  const TranscriptSuccess(this.transcript);

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is TranscriptSuccess &&
          runtimeType == other.runtimeType &&
          transcript == other.transcript;

  @override
  int get hashCode => transcript.hashCode;
}

class TranscriptNoCaptions extends TranscriptResult {
  const TranscriptNoCaptions();

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is TranscriptNoCaptions && runtimeType == other.runtimeType;

  @override
  int get hashCode => runtimeType.hashCode;
}

class TranscriptHttpError extends TranscriptResult {
  final int statusCode;
  const TranscriptHttpError(this.statusCode);

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is TranscriptHttpError &&
          runtimeType == other.runtimeType &&
          statusCode == other.statusCode;

  @override
  int get hashCode => statusCode.hashCode;
}

class TranscriptNetworkError extends TranscriptResult {
  final Object? cause;
  const TranscriptNetworkError([this.cause]);

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is TranscriptNetworkError &&
          runtimeType == other.runtimeType &&
          cause == other.cause;

  @override
  int get hashCode => cause.hashCode;
}

class TranscriptParseError extends TranscriptResult {
  final String message;
  final Object? cause;
  const TranscriptParseError(this.message, [this.cause]);

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is TranscriptParseError &&
          runtimeType == other.runtimeType &&
          message == other.message &&
          cause == other.cause;

  @override
  int get hashCode => Object.hash(message, cause);
}

/// Exception thrown when caption payload parsing fails.
class ParseException implements Exception {
  final String message;
  final Object? cause;

  const ParseException(this.message, [this.cause]);

  @override
  String toString() =>
      cause != null ? 'ParseException: $message ($cause)' : 'ParseException: $message';
}
