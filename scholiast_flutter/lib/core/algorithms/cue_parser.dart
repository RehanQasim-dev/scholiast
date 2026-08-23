import 'dart:convert';
import '../models/transcript_models.dart';

/// Parses YouTube caption track payloads into [Cue]s.
///
/// Supports two input formats mirroring the desktop `video-transcript.ts`:
/// 1. **JSON3** (`baseUrl&fmt=json3`): Events with `tStartMs` start a cue;
///    `aAppend` events (no `tStartMs`) accumulate their segments into the
///    previous cue's text and never create a cue of their own.
/// 2. **XML**: srv3 `<p t="ms" d="ms">` with `<s>` word segments, and the
///    simple `<text start="s" dur="s">` format.
class CueParser {
  const CueParser._();

  static final RegExp _srv3P =
      RegExp(r'<p\s+t="(\d+)"(?:[^>]*?\sd="(\d+)")?[^>]*>([\s\S]*?)</p>');
  static final RegExp _srv3S = RegExp(r'<s[^>]*>([^<]*)</s>');
  static final RegExp _stripTags = RegExp(r'<[^>]+>');
  static final RegExp _textTag = RegExp(
      r'<text\s+start="([^"]*)"(?:[^>]*?\sdur="([^"]*)")?[^>]*>([\s\S]*?)</text>');
  static final RegExp _collapseWs = RegExp(r'\s{2,}');
  static final RegExp _hexEntity = RegExp(r'&#x([0-9a-fA-F]+);');
  static final RegExp _decEntity = RegExp(r'&#(\d+);');

  /// Auto-detects format: XML payloads start with `<`; JSON3 is a JSON object.
  static List<Cue> parse(String raw) {
    if (raw.trimLeft().startsWith('<')) {
      return parseXml(raw);
    } else {
      return parseJson3(raw);
    }
  }

  // --- JSON3 ----------------------------------------------------------------

  /// Parses YouTube `&fmt=json3` caption payloads.
  ///
  /// A cue's [Cue.cueIndex] is its start event's position in `events`
  /// (`aAppend` events leave gaps).
  static List<Cue> parseJson3(String raw) {
    final dynamic decoded;
    try {
      decoded = jsonDecode(raw);
    } catch (e) {
      throw ParseException('malformed JSON3 caption payload', e);
    }

    if (decoded is! Map<String, dynamic>) {
      return const [];
    }

    final events = decoded['events'];
    if (events is! List) {
      return const [];
    }

    final cues = <Cue>[];
    var startIndex = -1;
    var startMs = -1.0;
    var endMs = -1.0;
    final textBuf = StringBuffer();

    void flush() {
      final textStr = textBuf.toString().trim();
      if (startIndex >= 0 && textStr.isNotEmpty) {
        final startSec = startMs / 1000.0;
        final durationSec = (endMs - startMs) / 1000.0;
        cues.add(Cue(
          start: startSec,
          duration: durationSec,
          text: textStr,
          cueIndex: startIndex,
        ));
      }
      textBuf.clear();
    }

    for (var eventIndex = 0; eventIndex < events.length; eventIndex++) {
      final element = events[eventIndex];
      if (element is! Map<String, dynamic>) continue;

      final tStart = element['tStartMs'];
      if (tStart is num) {
        flush();
        startIndex = eventIndex;
        startMs = tStart.toDouble();
        final dur = (element['dDurationMs'] as num?)?.toDouble() ?? 0.0;
        endMs = startMs + dur;
        textBuf.write(_segsUtf8(element));
      } else if (startIndex >= 0) {
        // aAppend (or unknown non-start event): accumulate into previous cue;
        // extend end if a duration is given.
        textBuf.write(_segsUtf8(element));
        final dur = (element['dDurationMs'] as num?)?.toDouble();
        if (dur != null && dur > 0) {
          endMs = startMs + dur;
        }
      }
    }
    flush();
    return cues;
  }

  static String _segsUtf8(Map<String, dynamic> obj) {
    final segs = obj['segs'];
    if (segs is! List) return '';
    final buf = StringBuffer();
    for (final seg in segs) {
      if (seg is Map<String, dynamic>) {
        final utf8 = seg['utf8'];
        if (utf8 != null) {
          buf.write(utf8.toString());
        }
      }
    }
    return buf.toString();
  }

  // --- XML (parseCuesXml port) -----------------------------------------------

  /// Parses XML caption formats: tries srv3 format first, then simple format.
  static List<Cue> parseXml(String xml) {
    final srv3 = _parseSrv3(xml);
    if (srv3.isNotEmpty) return srv3;
    return _parseTextFormat(xml);
  }

  // srv3: <p t="ms" d="ms"><s>word</s>…</p> — one line = one cue.
  static List<Cue> _parseSrv3(String xml) {
    final cues = <Cue>[];
    for (final m in _srv3P.allMatches(xml)) {
      final startMsStr = m.group(1);
      if (startMsStr == null) continue;
      final startMs = int.tryParse(startMsStr);
      if (startMs == null) continue;

      final durMsStr = m.group(2);
      final durMs = durMsStr != null ? (int.tryParse(durMsStr) ?? 0) : 0;

      final inner = m.group(3) ?? '';
      final sMatches = _srv3S.allMatches(inner).toList();
      var text = '';
      if (sMatches.isNotEmpty) {
        text = sMatches.map((s) => s.group(1) ?? '').join();
      }
      if (text.isEmpty) {
        text = inner.replaceAll(_stripTags, '');
      }
      text = clean(text);
      if (text.isNotEmpty) {
        cues.add(Cue(
          start: startMs / 1000.0,
          duration: durMs / 1000.0,
          text: text,
          cueIndex: cues.length,
        ));
      }
    }
    return cues;
  }

  // Simple format: <text start="s" dur="s">…</text> — timestamps in seconds.
  static List<Cue> _parseTextFormat(String xml) {
    final cues = <Cue>[];
    for (final m in _textTag.allMatches(xml)) {
      final startStr = m.group(1) ?? '0';
      final durStr = m.group(2);
      final start = double.tryParse(startStr) ?? 0.0;
      final dur = durStr != null ? (double.tryParse(durStr) ?? 0.0) : 0.0;
      final inner = m.group(3) ?? '';
      final text = clean(inner.replaceAll(_stripTags, ''));
      if (text.isNotEmpty) {
        cues.add(Cue(
          start: start,
          duration: dur,
          text: text,
          cueIndex: cues.length,
        ));
      }
    }
    return cues;
  }

  /// Collapses whitespace and decodes XML/HTML entities.
  static String clean(String text) {
    final collapsed =
        text.replaceAll('\n', ' ').replaceAll(_collapseWs, ' ');
    return decodeEntities(collapsed).trim();
  }

  /// Decodes named, decimal, and hex XML entities.
  static String decodeEntities(String text) {
    var s = text
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'")
        .replaceAll('&apos;', "'");

    s = s.replaceAllMapped(_hexEntity, (m) {
      final hexStr = m.group(1);
      if (hexStr == null) return m.group(0)!;
      final cp = int.tryParse(hexStr, radix: 16);
      if (cp != null && cp >= 0 && cp <= 0x10FFFF) {
        return String.fromCharCode(cp);
      }
      return m.group(0)!;
    });

    s = s.replaceAllMapped(_decEntity, (m) {
      final decStr = m.group(1);
      if (decStr == null) return m.group(0)!;
      final cp = int.tryParse(decStr, radix: 10);
      if (cp != null && cp >= 0 && cp <= 0x10FFFF) {
        return String.fromCharCode(cp);
      }
      return m.group(0)!;
    });

    return s;
  }
}
