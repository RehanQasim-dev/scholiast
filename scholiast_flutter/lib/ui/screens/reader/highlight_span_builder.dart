import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

import 'package:scholiast_flutter/core/algorithms/anchor.dart';
import 'package:scholiast_flutter/core/models/linear_article.dart';
import 'package:scholiast_flutter/core/models/page_highlight.dart';
import 'package:scholiast_flutter/core/theme/app_colors.dart';

/// A highlight interval localised to a single block.
class BlockHighlightSpan {
  final int start; // inclusive char offset in block text
  final int endInclusive; // inclusive
  final PageHighlight highlight;
  final bool isActive;

  const BlockHighlightSpan({
    required this.start,
    required this.endInclusive,
    required this.highlight,
    this.isActive = false,
  });
}

/// Build the full concatenated text used for anchoring resolution.
///
/// Blocks are joined with two newlines, mirroring the browser extension's
/// readable extraction.
String buildFullArticleText(LinearArticle article) {
  return article.blocks.map((b) => b.text).join('\n\n');
}

/// Map each block to its start offset in [buildFullArticleText].
List<int> buildBlockOffsets(LinearArticle article) {
  final offsets = <int>[];
  var cursor = 0;
  for (var i = 0; i < article.blocks.length; i++) {
    offsets.add(cursor);
    cursor += article.blocks[i].text.length;
    if (i < article.blocks.length - 1) cursor += 2; // \n\n
  }
  return offsets;
}

/// Resolve a highlight to an [IntRange] in [fullText].
///
/// Tries in order:
/// 1. TextQuoteAnchor from `extras['anchor']` via [findTextQuoteRange] (3-tier)
/// 2. Exact substring search of `extras['content']`
/// 3. Direct `anchor` TextQuoteAnchor field if model carries it
IntRange? resolveHighlightRange(
  PageHighlight highlight,
  String fullText,
) {
  final extras = highlight.extras;

  // Try TextQuoteAnchor stored in extras['anchor']
  if (extras.containsKey('anchor') && extras['anchor'] is Map) {
    try {
      final anchor = TextQuoteAnchor.fromJson(
        Map<String, dynamic>.from(extras['anchor'] as Map),
      );
      final range = findTextQuoteRange(anchor, fullText);
      if (range != null && range.isNotEmpty) return range;
    } catch (_) {
      // fall through
    }
  }

  // Try content string exact search
  final content = extras['content'] as String?;
  if (content != null && content.isNotEmpty) {
    final idx = fullText.indexOf(content);
    if (idx != -1) {
      return IntRange(idx, idx + content.length - 1);
    }
    // Whitespace-insensitive fallback using collapse
    final anchor = TextQuoteAnchor(quote: content);
    final ws = findWhitespaceInsensitive(fullText, anchor);
    if (ws != null) return ws;
  }

  // Try highlight id as quote fallback? Not ideal, but helps tests.
  return null;
}

/// For a given block index, return the intersecting highlight spans.
List<BlockHighlightSpan> highlightSpansForBlock({
  required int blockIndex,
  required LinearArticle article,
  required List<int> blockOffsets,
  required String fullText,
  required List<PageHighlight> highlights,
  String? activeHighlightId,
}) {
  final blockStart = blockOffsets[blockIndex];
  final block = article.blocks[blockIndex];
  final blockEnd = blockStart + block.text.length - 1;
  final out = <BlockHighlightSpan>[];

  for (final h in highlights) {
    final range = resolveHighlightRange(h, fullText);
    if (range == null || range.isEmpty) continue;
    if (range.last < blockStart || range.first > blockEnd) continue;

    final localStart = (range.first - blockStart).clamp(0, block.text.length);
    final localEnd = (range.last - blockStart).clamp(0, block.text.length - 1);
    if (localStart > localEnd) continue;

    out.add(BlockHighlightSpan(
      start: localStart,
      endInclusive: localEnd,
      highlight: h,
      isActive: h.id == activeHighlightId,
    ));
  }

  out.sort((a, b) => a.start.compareTo(b.start));
  return mergeOverlappingSpans(out);
}

/// Merge overlapping spans within a single block; earliest wins.
List<BlockHighlightSpan> mergeOverlappingSpans(
  List<BlockHighlightSpan> spans,
) {
  if (spans.isEmpty) return spans;
  final merged = <BlockHighlightSpan>[spans.first];
  for (var i = 1; i < spans.length; i++) {
    final cur = spans[i];
    final last = merged.last;
    if (cur.start <= last.endInclusive) {
      // Overlapping: keep the first (already sorted), extend if needed but
      // preserve its highlight identity.
      if (cur.endInclusive > last.endInclusive) {
        merged[merged.length - 1] = BlockHighlightSpan(
          start: last.start,
          endInclusive: cur.endInclusive,
          highlight: last.highlight,
          isActive: last.isActive,
        );
      }
    } else {
      merged.add(cur);
    }
  }
  return merged;
}

/// Build [TextSpan] children for a single block's text with highlights.
List<InlineSpan> buildBlockTextSpans({
  required String text,
  required List<BlockHighlightSpan> spans,
  required void Function(PageHighlight) onTapHighlight,
  TextStyle? baseStyle,
}) {
  if (text.isEmpty) return const [];

  final base = baseStyle ??
      const TextStyle(
        fontSize: 16,
        height: 1.6,
        color: AppColors.textPrimary,
      );

  if (spans.isEmpty) {
    return [TextSpan(text: text, style: base)];
  }

  final out = <InlineSpan>[];
  var cursor = 0;

  for (final span in spans) {
    if (span.start > cursor) {
      out.add(TextSpan(text: text.substring(cursor, span.start), style: base));
    }

    final hlText = text.substring(span.start, span.endInclusive + 1);
    final bg = AppColors.getHighlightColor(span.highlight.color);
    final border = AppColors.getHighlightBorderColor(span.highlight.color);

    out.add(
      TextSpan(
        text: hlText,
        style: base.copyWith(
          backgroundColor: span.isActive ? bg : bg.withValues(alpha: 0.85),
          decoration: span.isActive ? TextDecoration.underline : null,
          decorationColor: border,
          decorationThickness: 2,
        ),
        recognizer: TapGestureRecognizer()
          ..onTap = () => onTapHighlight(span.highlight),
      ),
    );

    cursor = span.endInclusive + 1;
  }

  if (cursor < text.length) {
    out.add(TextSpan(text: text.substring(cursor), style: base));
  }

  return out;
}
