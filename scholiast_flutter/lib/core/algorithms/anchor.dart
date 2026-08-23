import 'dart:math' as math;
import 'package:flutter/foundation.dart';

/// Pure-Dart port of the desktop's cross-surface text-quote anchoring
/// (`shared/anchor.ts`) plus its dependency-free fuzzy matcher
/// (`shared/fuzzy-match.ts`) and Kotlin reference (`AnchorKt.kt`).
///
/// Provides a three-tier fallback for resolving anchors:
///   1. exact `indexOf`
///   2. whitespace-insensitive match (reports the *real* span)
///   3. fuzzy edit-distance match, gated by quality thresholds

/// Characters of surrounding context captured on each side of a quote.
const int contextLen = 32;

/// Minimum fraction of the (normalized) quote that must survive a fuzzy match.
const double fuzzyMinQuoteScore = 0.74;

/// Minimum combined (quote + context) weighted score for a fuzzy match.
const double fuzzyMinScore = 0.7;

/// Portable, structure-independent anchor: the quoted text plus up to
/// [contextLen] characters of context on each side, and an `occurrence` index
/// disambiguating identical quote+context repeats within a document.
@immutable
class TextQuoteAnchor {
  final String quote;
  final String prefix;
  final String suffix;
  final int occurrence;

  const TextQuoteAnchor({
    required this.quote,
    this.prefix = '',
    this.suffix = '',
    this.occurrence = 0,
  });

  TextQuoteAnchor copyWith({
    String? quote,
    String? prefix,
    String? suffix,
    int? occurrence,
  }) {
    return TextQuoteAnchor(
      quote: quote ?? this.quote,
      prefix: prefix ?? this.prefix,
      suffix: suffix ?? this.suffix,
      occurrence: occurrence ?? this.occurrence,
    );
  }

  factory TextQuoteAnchor.fromJson(Map<String, dynamic> json) {
    return TextQuoteAnchor(
      quote: json['quote'] as String? ?? '',
      prefix: json['prefix'] as String? ?? '',
      suffix: json['suffix'] as String? ?? '',
      occurrence: (json['occurrence'] as num?)?.toInt() ?? 0,
    );
  }

  Map<String, dynamic> toJson() => {
    'quote': quote,
    if (prefix.isNotEmpty) 'prefix': prefix,
    if (suffix.isNotEmpty) 'suffix': suffix,
    if (occurrence != 0) 'occurrence': occurrence,
  };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is TextQuoteAnchor &&
          runtimeType == other.runtimeType &&
          quote == other.quote &&
          prefix == other.prefix &&
          suffix == other.suffix &&
          occurrence == other.occurrence;

  @override
  int get hashCode => Object.hash(quote, prefix, suffix, occurrence);

  @override
  String toString() =>
      'TextQuoteAnchor(quote: $quote, prefix: $prefix, suffix: $suffix, occurrence: $occurrence)';
}

/// Inclusive integer range representing `[start, endInclusive]`.
@immutable
class IntRange {
  final int start;
  final int endInclusive;

  const IntRange(this.start, this.endInclusive);

  static const empty = IntRange(1, 0);

  int get first => start;
  int get last => endInclusive;
  int get endExclusive => endInclusive + 1;
  int get length => isEmpty ? 0 : (endInclusive - start + 1);

  bool get isEmpty => start > endInclusive;
  bool get isNotEmpty => !isEmpty;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is IntRange &&
          runtimeType == other.runtimeType &&
          ((isEmpty && other.isEmpty) ||
              (start == other.start && endInclusive == other.endInclusive));

  @override
  int get hashCode => isEmpty ? 0 : Object.hash(start, endInclusive);

  @override
  String toString() =>
      isEmpty ? 'IntRange.empty' : 'IntRange($start..$endInclusive)';
}

// ---------------------------------------------------------------------------
// Pure string core
// ---------------------------------------------------------------------------

/// Build a text-quote anchor for the slice `[start, end)` of `fullText`.
///
/// Context extension: sentence boundaries are found by a deterministic scan for
/// `.!?` terminator runs followed by whitespace (or a blank-line paragraph break),
/// capped at 200 chars and floored at [contextLen].
///
/// `occurrence` counts equally-scored matches *before* this position so
/// re-resolution lands back here.
TextQuoteAnchor buildTextQuoteAnchor(String fullText, int start, int end) {
  final quote = fullText.substring(start, end);
  var prefix = fullText.substring(math.max(0, start - contextLen), start);
  var suffix = fullText.substring(
    end,
    math.min(fullText.length, end + contextLen),
  );

  final sentenceStart = sentenceStartBefore(fullText, start);
  if (sentenceStart >= 0) {
    final prefixLen = math.max(
      contextLen,
      math.min(200, start - sentenceStart),
    );
    prefix = fullText.substring(math.max(0, start - prefixLen), start);
  }
  final sentenceEnd = sentenceEndAfter(fullText, end);
  if (sentenceEnd >= 0) {
    final suffixLen = math.max(
      contextLen,
      math.min(200, sentenceEnd - end),
    );
    suffix = fullText.substring(
      end,
      math.min(fullText.length, end + suffixLen),
    );
  }

  // Count how many equally-good (same context score) matches occur before this
  // position — that index is our occurrence.
  final probe = TextQuoteAnchor(
    quote: quote,
    prefix: prefix,
    suffix: suffix,
    occurrence: 0,
  );
  final matches = scoredMatches(fullText, probe);
  final best = matches.isNotEmpty ? matches.first.score : 0;
  final occurrence =
      matches.where((m) => m.score == best && m.index < start).length;
  return TextQuoteAnchor(
    quote: quote,
    prefix: prefix,
    suffix: suffix,
    occurrence: occurrence,
  );
}

class ScoredMatch {
  final int index;
  final int score;
  const ScoredMatch(this.index, this.score);
}

/// All exact-quote positions in `fullText`, scored by how well context matches.
List<ScoredMatch> scoredMatches(String fullText, TextQuoteAnchor anchor) {
  if (anchor.quote.isEmpty) return const [];
  final out = <ScoredMatch>[];
  var from = 0;
  while (true) {
    final index = fullText.indexOf(anchor.quote, from);
    if (index == -1) break;
    out.add(
      ScoredMatch(
        index,
        contextScore(
          fullText,
          index,
          anchor.quote.length,
          anchor.prefix,
          anchor.suffix,
        ),
      ),
    );
    from = index + math.max(1, anchor.quote.length);
  }
  // Highest context score first; stable by position for equal scores.
  out.sort((a, b) {
    final scoreCmp = b.score.compareTo(a.score);
    if (scoreCmp != 0) return scoreCmp;
    return a.index.compareTo(b.index);
  });
  return out;
}

/// Number of matching context characters on both sides (higher = better).
int contextScore(
  String fullText,
  int index,
  int quoteLen,
  String prefix,
  String suffix,
) {
  final before = fullText.substring(math.max(0, index - prefix.length), index);
  final after = fullText.substring(
    math.min(fullText.length, index + quoteLen),
    math.min(fullText.length, index + quoteLen + suffix.length),
  );
  return commonSuffixLen(before, prefix) + commonPrefixLen(after, suffix);
}

int commonPrefixLen(String a, String b) {
  final n = math.min(a.length, b.length);
  var i = 0;
  while (i < n && a.codeUnitAt(i) == b.codeUnitAt(i)) {
    i++;
  }
  return i;
}

int commonSuffixLen(String a, String b) {
  final n = math.min(a.length, b.length);
  var i = 0;
  while (i < n &&
      a.codeUnitAt(a.length - 1 - i) == b.codeUnitAt(b.length - 1 - i)) {
    i++;
  }
  return i;
}

/// Find the start offset of the best match for `anchor` in `fullText`,
/// or `null` when the quote does not occur at all.
int? findTextQuote(String fullText, TextQuoteAnchor anchor) {
  final matches = scoredMatches(fullText, anchor);
  if (matches.isEmpty) return null;
  final best = matches.first.score;
  final equallyGood = matches.where((m) => m.score == best).toList()
    ..sort((a, b) => a.index.compareTo(b.index));
  final pickIndex = math.min(anchor.occurrence, equallyGood.length - 1);
  return equallyGood[pickIndex].index;
}

/// Find the span of the best match for `anchor` in `fullText`:
/// exact -> whitespace-insensitive -> fuzzy. Returned as an inclusive [IntRange].
/// `null` when the quote cannot be located by any tier.
IntRange? findTextQuoteRange(TextQuoteAnchor anchor, String fullText) {
  final exactStart = findTextQuote(fullText, anchor);
  if (exactStart != null) {
    return IntRange(exactStart, exactStart + anchor.quote.length - 1);
  }
  final ws = findWhitespaceInsensitive(fullText, anchor);
  if (ws != null) return ws;

  return findFuzzy(fullText, anchor);
}

/// Whitespace-insensitive search; disambiguates by collapsed context + occurrence,
/// like the exact path, and reports the real original-text span so interior
/// whitespace differences are absorbed without dragging in trailing whitespace.
IntRange? findWhitespaceInsensitive(String fullText, TextQuoteAnchor anchor) {
  final quoteNorm = collapseWs(anchor.quote);
  if (quoteNorm.isEmpty) return null;
  final normMap = normalizeWithMap(fullText);
  final norm = normMap.norm;
  final map = normMap.map;
  final prefixNorm = collapseWs(anchor.prefix);
  final suffixNorm = collapseWs(anchor.suffix);

  final scored = <ScoredMatch>[];
  var from = 0;
  while (true) {
    final index = norm.indexOf(quoteNorm, from);
    if (index == -1) break;
    final before = norm.substring(math.max(0, index - prefixNorm.length), index);
    final after = norm.substring(
      math.min(norm.length, index + quoteNorm.length),
      math.min(norm.length, index + quoteNorm.length + suffixNorm.length),
    );
    scored.add(
      ScoredMatch(
        index,
        commonSuffixLen(before, prefixNorm) + commonPrefixLen(after, suffixNorm),
      ),
    );
    from = index + math.max(1, quoteNorm.length);
  }
  scored.sort((a, b) {
    final scoreCmp = b.score.compareTo(a.score);
    if (scoreCmp != 0) return scoreCmp;
    return a.index.compareTo(b.index);
  });
  if (scored.isEmpty) return null;
  final best = scored.first.score;
  final equallyGood = scored.where((m) => m.score == best).toList()
    ..sort((a, b) => a.index.compareTo(b.index));
  final pick = equallyGood[math.min(anchor.occurrence, equallyGood.length - 1)];

  if (pick.index < 0 || pick.index >= map.length) return null;
  final lastCharIdx = pick.index + quoteNorm.length - 1;
  if (lastCharIdx < 0 || lastCharIdx >= map.length) return null;

  final startIdx = map[pick.index];
  final lastChar = map[lastCharIdx];
  return IntRange(startIdx, lastChar);
}

/// Edit-distance fallback. Operates on whitespace-normalized text, weights the
/// quote 0.6 and prefix/suffix context 0.2 each, and rejects anything below the
/// quality thresholds so a bad guess never displaces an honest "unplaced".
IntRange? findFuzzy(String fullText, TextQuoteAnchor anchor) {
  final quoteNorm = collapseWs(anchor.quote);
  if (quoteNorm.length < 4) return null; // too short to fuzzy-match safely
  final normMap = normalizeWithMap(fullText);
  final norm = normMap.norm;
  final map = normMap.map;
  final prefixNorm = collapseWs(anchor.prefix);
  final suffixNorm = collapseWs(anchor.suffix);

  // Allow up to ~25% of the quote to differ, capped for very long quotes.
  final maxErrors = math.min(64.0, quoteNorm.length * 0.25).toInt();
  if (maxErrors < 1) return null;
  final matches = approxMatch(norm, quoteNorm, maxErrors);
  if (matches.isEmpty) return null;

  int? bestStart;
  int? bestEnd;
  var bestScore = double.negativeInfinity;

  for (final m in matches) {
    final quoteScore = 1.0 - m.errors / quoteNorm.length;
    if (quoteScore < fuzzyMinQuoteScore) continue;
    // Context similarity; collapseWs again on the slices — they can carry a
    // boundary space that prefixNorm/suffixNorm (already trimmed) lack.
    final before = collapseWs(
      norm.substring(math.max(0, m.start - prefixNorm.length - 1), m.start),
    );
    final after = collapseWs(
      norm.substring(
        math.min(norm.length, m.end),
        math.min(norm.length, m.end + suffixNorm.length + 1),
      ),
    );
    final prefixScore = prefixNorm.isEmpty
        ? 1.0
        : commonSuffixLen(before, prefixNorm) / prefixNorm.length;
    final suffixScore = suffixNorm.isEmpty
        ? 1.0
        : commonPrefixLen(after, suffixNorm) / suffixNorm.length;
    final score = 0.6 * quoteScore + 0.2 * prefixScore + 0.2 * suffixScore;
    if (score > bestScore) {
      bestScore = score;
      bestStart = m.start;
      bestEnd = m.end;
    }
  }

  if (bestStart == null || bestEnd == null || bestScore < fuzzyMinScore) {
    return null;
  }

  final bestEndInclusive = bestEnd - 1;
  if (bestStart < 0 || bestStart >= map.length) return null;
  if (bestEndInclusive < 0 || bestEndInclusive >= map.length) return null;

  final startIdx = map[bestStart];
  final lastChar = map[bestEndInclusive];
  return IntRange(startIdx, lastChar);
}

class NormalizedMap {
  final String norm;
  final List<int> map;
  const NormalizedMap(this.norm, this.map);
}

/// Collapse each whitespace run to a single space, recording each output char's original index.
NormalizedMap normalizeWithMap(String s) {
  final sb = StringBuffer();
  final map = <int>[];
  var inWs = false;
  for (var i = 0; i < s.length; i++) {
    final code = s.codeUnitAt(i);
    if (isJsWhitespaceCode(code)) {
      if (!inWs) {
        sb.write(' ');
        map.add(i); // collapsed run -> its first char's original index
        inWs = true;
      }
    } else {
      sb.writeCharCode(code);
      map.add(i);
      inWs = false;
    }
  }
  return NormalizedMap(sb.toString(), map);
}

/// JS `s.replace(/\s+/g, ' ').trim()` without regex.
String collapseWs(String s) {
  final sb = StringBuffer();
  var inWs = false;
  for (var i = 0; i < s.length; i++) {
    final code = s.codeUnitAt(i);
    if (isJsWhitespaceCode(code)) {
      if (!inWs) {
        sb.write(' ');
        inWs = true;
      }
    } else {
      sb.writeCharCode(code);
      inWs = false;
    }
  }
  final str = sb.toString();
  var b = 0;
  var e = str.length;
  while (b < e && str.codeUnitAt(b) == 0x20) {
    b++;
  }
  while (e > b && str.codeUnitAt(e - 1) == 0x20) {
    e--;
  }
  return str.substring(b, e);
}

/// Exactly the character class of the JavaScript `/\s/` regex.
bool isJsWhitespace(String ch) {
  if (ch.isEmpty) return false;
  return isJsWhitespaceCode(ch.codeUnitAt(0));
}

/// Checks whether [code] is a JS `/\s/` character code.
bool isJsWhitespaceCode(int code) {
  switch (code) {
    case 0x0020: // ' '
    case 0x0009: // '\t'
    case 0x000A: // '\n'
    case 0x000B: // '\v'
    case 0x000C: // '\f'
    case 0x000D: // '\r'
    case 0x00A0: // NBSP
    case 0x1680:
    case 0x2000:
    case 0x2001:
    case 0x2002:
    case 0x2003:
    case 0x2004:
    case 0x2005:
    case 0x2006:
    case 0x2007:
    case 0x2008:
    case 0x2009:
    case 0x200A:
    case 0x2028:
    case 0x2029:
    case 0x202F:
    case 0x205F:
    case 0x3000:
    case 0xFEFF:
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Fuzzy matcher — port of shared/fuzzy-match.ts (banded edit-distance scan)
// ---------------------------------------------------------------------------

@immutable
class ApproxMatchResult {
  final int start;
  final int end;
  final int errors;

  const ApproxMatchResult(this.start, this.end, this.errors);

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ApproxMatchResult &&
          runtimeType == other.runtimeType &&
          start == other.start &&
          end == other.end &&
          errors == other.errors;

  @override
  int get hashCode => Object.hash(start, end, errors);

  @override
  String toString() =>
      'ApproxMatchResult(start: $start, end: $end, errors: $errors)';
}

class EndMatch {
  final int end;
  final int errors;
  const EndMatch(this.end, this.errors);
}

/// End offsets in `text` of approximate matches of `pattern` whose edit distance
/// is `<= maxErrors` (fuzzy-match.ts:27–78). When `allPositions` is false,
/// contiguous runs of qualifying end positions collapse to their lowest-error
/// position; when true, every qualifying end is returned (reverse pass).
List<EndMatch> searchEnds(
  String text,
  String pattern,
  int maxErrors, {
  required bool allPositions,
}) {
  final m = pattern.length;
  final n = text.length;
  final out = <EndMatch>[];
  if (m == 0) return out;

  // Rolling columns of the edit-distance matrix. Row 0 pinned to 0 so the
  // match may start anywhere (substring search). Every cell of `cur` is
  // rewritten before it is read on the next pass, so a reference swap is safe.
  var prev = List<int>.generate(m + 1, (i) => i);
  var cur = List<int>.filled(m + 1, 0);

  var runEnd = -1;
  var runErr = 0x7FFFFFFF;

  for (var j = 1; j <= n; j++) {
    cur[0] = 0;
    final tc = text.codeUnitAt(j - 1);
    for (var i = 1; i <= m; i++) {
      final cost = (pattern.codeUnitAt(i - 1) == tc) ? 0 : 1;
      var v = prev[i - 1] + cost; // substitute / match
      final del = prev[i] + 1; // skip a pattern char (insertion in text)
      if (del < v) v = del;
      final ins = cur[i - 1] + 1; // skip a text char (deletion from text)
      if (ins < v) v = ins;
      cur[i] = v;
    }
    final e = cur[m];
    if (allPositions) {
      if (e <= maxErrors) out.add(EndMatch(j, e));
    } else {
      if (e <= maxErrors && e < runErr) {
        runErr = e;
        runEnd = j;
      }
      if (runEnd != -1 && e > runErr) {
        out.add(EndMatch(runEnd, runErr));
        runEnd = -1;
        runErr = 0x7FFFFFFF;
      }
    }
    final tmp = prev;
    prev = cur;
    cur = tmp;
  }
  if (!allPositions && runEnd != -1) {
    out.add(EndMatch(runEnd, runErr));
  }
  return out;
}

/// Find approximate matches of `pattern` in `text` allowing up to `maxErrors`
/// edits (fuzzy-match.ts:91–105). Each result carries `start`, `end`, `errors`;
/// the start is recovered by re-running the scan on a reversed window before the
/// end, choosing the longest span so interior edits don't truncate the match.
List<ApproxMatchResult> approxMatch(
  String text,
  String pattern,
  int maxErrors,
) {
  if (pattern.isEmpty || text.isEmpty || maxErrors < 0) return const [];
  final ends = searchEnds(text, pattern, maxErrors, allPositions: false);
  final patRev = String.fromCharCodes(pattern.codeUnits.reversed);
  return ends.map((m) {
    final minStart = math.max(0, m.end - pattern.length - m.errors);
    final textSlice = text.substring(minStart, m.end);
    final textRev = String.fromCharCodes(textSlice.codeUnits.reversed);
    final revEnds = searchEnds(textRev, patRev, m.errors, allPositions: true);
    var start = m.end;
    for (final re in revEnds) {
      final s = m.end - re.end;
      if (s < start) start = s;
    }
    return ApproxMatchResult(start, m.end, m.errors);
  }).toList();
}

// ---------------------------------------------------------------------------
// Sentence-boundary scan
// ---------------------------------------------------------------------------

/// Offset just after the last sentence terminator before `pos`, or 0.
int sentenceStartBefore(String text, int pos) {
  var i = pos - 1;
  while (i >= 0) {
    final c = text.codeUnitAt(i);
    if (c == 0x2E /* . */ || c == 0x21 /* ! */ || c == 0x3F /* ? */) {
      if (i + 1 >= pos || isJsWhitespaceCode(text.codeUnitAt(i + 1))) {
        var k = i + 1;
        while (k < pos && isJsWhitespaceCode(text.codeUnitAt(k))) {
          k++;
        }
        return k;
      }
    }
    if (c == 0x0A /* \n */ && i > 0 && text.codeUnitAt(i - 1) == 0x0A) {
      var k = i + 1;
      while (k < pos && isJsWhitespaceCode(text.codeUnitAt(k))) {
        k++;
      }
      return k;
    }
    i--;
  }
  return 0;
}

/// Offset just after the first sentence terminator at/after `pos`, or text.length.
int sentenceEndAfter(String text, int pos) {
  var i = pos;
  while (i < text.length) {
    final c = text.codeUnitAt(i);
    if (c == 0x2E /* . */ || c == 0x21 /* ! */ || c == 0x3F /* ? */) {
      if (i + 1 >= text.length || isJsWhitespaceCode(text.codeUnitAt(i + 1))) {
        var j = i + 1;
        while (j < text.length) {
          final nextC = text.codeUnitAt(j);
          if (nextC == 0x2E || nextC == 0x21 || nextC == 0x3F) {
            j++;
          } else {
            break;
          }
        }
        return j;
      }
    }
    if (c == 0x0A /* \n */ &&
        i + 1 < text.length &&
        text.codeUnitAt(i + 1) == 0x0A) {
      return i;
    }
    i++;
  }
  return text.length;
}

// ---------------------------------------------------------------------------
// Selection hygiene + grouping (consumed by Task 29 highlighting)
// ---------------------------------------------------------------------------

/// Tighten `[start, end)` to the nearest non-whitespace characters on both
/// boundaries (flat-text variant of src/utils/trim-range.ts). A triple-click's
/// trailing newline must not get baked into an anchor's quote/offsets.
/// Returns an inclusive [IntRange]; [IntRange.empty] when the span holds no
/// non-whitespace character.
IntRange trimRange(String text, int start, int end) {
  if (start < 0 || end > text.length || start >= end) return IntRange.empty;
  var s = start;
  var e = end - 1;
  while (s <= e && isJsWhitespaceCode(text.codeUnitAt(s))) {
    s++;
  }
  while (e >= s && isJsWhitespaceCode(text.codeUnitAt(e))) {
    e--;
  }
  return s > e ? IntRange.empty : IntRange(s, e);
}

/// Merge overlapping **or adjacent** ranges into a sorted, disjoint list.
/// Empty ranges dropped.
List<IntRange> mergeOverlappingRanges(List<IntRange> ranges) {
  final sorted = ranges.where((r) => r.isNotEmpty).toList()
    ..sort((a, b) => a.first.compareTo(b.first));
  final out = <IntRange>[];
  for (final r in sorted) {
    if (out.isNotEmpty && r.first <= out.last.last + 1) {
      final last = out.last;
      if (r.last > last.last) {
        out[out.length - 1] = IntRange(last.first, r.last);
      }
    } else {
      out.add(r);
    }
  }
  return out;
}
