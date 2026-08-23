import '../models/transcript_models.dart';

/// Semantic chunker for transcript cues.
///
/// Port of `TranscriptChunker.kt` / `video-transcript.ts`: Defuddle's
/// `groupBySentence` algorithm adapted to cue objects. A paragraph is a run of
/// consecutive cues; cues are never split mid-word.
///
/// Break signals, in priority order:
/// 1. Sentence end on the current cue (`.!?` plus CJK punctuation, optionally
///    followed by closing quote/bracket);
/// 2. Long speech pause — gap between consecutive cue starts exceeding 20s;
/// 3. Unpunctuated run whose span from the paragraph's first cue start
///    reaches 30s (flushed at cue boundary).
class TranscriptChunker {
  const TranscriptChunker._();

  static final RegExp _sentEnd = RegExp(r'''[.!?。！？]["')\]’”]?\s*$''');
  static const int groupGapMs = 20000;
  static const int maxGroupMs = 30000;

  static final RegExp _internalSentRe =
      RegExp(r'''([.!?。！？]["')\]’”]?)\s+(?=[A-Z“"‘'])''');

  /// Pre-splits cues that carry a mid-cue sentence boundary into separate cues.
  ///
  /// Both halves keep the original cue's start/duration timing; emitted indexes
  /// are sequential.
  static List<Cue> splitOnInternalSentences(List<Cue> cues) {
    final out = <Cue>[];
    for (final c in cues) {
      final matches = _internalSentRe.allMatches(c.text).toList();
      if (matches.isEmpty) {
        out.add(c.copyWith(cueIndex: out.length));
        continue;
      }
      final positions = <int>[];
      for (final m in matches) {
        positions.add(m.start + m.group(1)!.length);
      }
      var prev = 0;
      for (final pos in positions) {
        final piece = c.text.substring(prev, pos).trim();
        if (piece.isNotEmpty) {
          out.add(Cue(
            start: c.start,
            duration: c.duration,
            text: piece,
            cueIndex: out.length,
          ));
        }
        prev = pos;
      }
      final tail = c.text.substring(prev).trim();
      if (tail.isNotEmpty) {
        out.add(Cue(
          start: c.start,
          duration: c.duration,
          text: tail,
          cueIndex: out.length,
        ));
      }
    }
    return out;
  }

  /// Groups cues into paragraphs based on sentence endings and pauses.
  static List<CueParagraph> semanticChunk(List<Cue> cues) {
    if (cues.isEmpty) return const [];
    final paragraphs = <CueParagraph>[];
    final pending = <Cue>[];

    void flush() {
      if (pending.isNotEmpty) {
        paragraphs.add(_buildParagraph(paragraphs.length, pending));
        pending.clear();
      }
    }

    for (final c in cues) {
      if (pending.isNotEmpty) {
        final prev = pending.last;
        if (c.startMs - prev.startMs > groupGapMs) {
          flush();
        }
      }
      pending.add(c);
      if (_sentEnd.hasMatch(c.text)) {
        flush();
        continue;
      }
      if (c.startMs - pending.first.startMs >= maxGroupMs) {
        flush();
      }
    }
    flush();
    return paragraphs;
  }

  /// Full pipeline: internal-sentence split, then semantic grouping.
  static List<CueParagraph> chunk(List<Cue> cues) =>
      semanticChunk(splitOnInternalSentences(cues));

  static CueParagraph _buildParagraph(int index, List<Cue> cues) {
    return CueParagraph(
      start: cues.first.start,
      text: cues.map((c) => c.text).join(' '),
      cues: List<Cue>.unmodifiable(cues),
    );
  }
}
