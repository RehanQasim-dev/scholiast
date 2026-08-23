import 'package:flutter_test/flutter_test.dart';
import 'package:scholiast_flutter/core/algorithms/anchor.dart';

void main() {
  group('Anchor - text-quote core (pure) — parity with AnchorKtTest', () {
    const text =
        'The quick brown fox jumps over the lazy dog. The fox is quick.';

    test('builds quote with surrounding context', () {
      final start = text.indexOf('brown fox');
      final q = buildTextQuoteAnchor(text, start, start + 'brown fox'.length);
      expect(q.quote, 'brown fox');
      expect(q.prefix.endsWith('quick '), isTrue);
      expect(q.suffix.startsWith(' jumps'), isTrue);
      expect(q.occurrence, 0);
    });

    test('round-trips a unique quote', () {
      final start = text.indexOf('lazy dog');
      final q = buildTextQuoteAnchor(text, start, start + 'lazy dog'.length);
      expect(findTextQuote(text, q), start);
    });

    test('disambiguates a repeated quote by context and occurrence', () {
      final first = text.indexOf('fox');
      final second = text.indexOf('fox', first + 1);
      final q1 = buildTextQuoteAnchor(text, first, first + 3);
      final q2 = buildTextQuoteAnchor(text, second, second + 3);
      expect(findTextQuote(text, q1), first);
      expect(findTextQuote(text, q2), second);
    });

    test('returns null when the quote is absent', () {
      expect(findTextQuote(text, buildTextQuoteAnchor('cat', 0, 3)), isNull);
    });
  });

  group('Anchor - whitespace collapse — parity with AnchorKtTest', () {
    test('whitespace-insensitive match reports real span', () {
      // Captured on clean single-spaced Markdown (Obsidian's rendered note).
      const clean = 'Intro. The shared sentence lives here.';
      final start = clean.indexOf('shared sentence lives');
      final q = buildTextQuoteAnchor(
        clean,
        start,
        start + 'shared sentence lives'.length,
      );

      // Live page: same words but raw newlines, indentation, and run-together spaces.
      const messy = 'Intro. The   shared\n    sentence lives here.';
      final r = findTextQuoteRange(q, messy)!;
      // The resolved span covers the original (messy) text for those words,
      // at its REAL offsets — not start + normalized length.
      expect(r.first, messy.indexOf('shared'));
      expect(r.last, messy.indexOf('lives') + 'lives'.length - 1);
      expect(
        collapseWs(messy.substring(r.first, r.last + 1)),
        'shared sentence lives',
      );
    });
  });

  group('Anchor - fuzzy fallback (findTextQuoteRange) — parity with AnchorKtTest', () {
    const original =
        'The quick brown fox jumps over the lazy dog near the river bank.';

    test('still exact matches an unchanged quote', () {
      final start = original.indexOf('brown fox jumps');
      final q = buildTextQuoteAnchor(
        original,
        start,
        start + 'brown fox jumps'.length,
      );
      final r = findTextQuoteRange(q, original)!;
      expect(original.substring(r.first, r.last + 1), 'brown fox jumps');
    });

    test('recovers a quote after a single character edit', () {
      final start = original.indexOf('brown fox jumps');
      final q = buildTextQuoteAnchor(
        original,
        start,
        start + 'brown fox jumps'.length,
      );
      // Page later "fixes" a character: fox -> box.
      final edited = original.replaceAll('brown fox jumps', 'brown box jumps');
      final r = findTextQuoteRange(q, edited)!;
      expect(edited.substring(r.first, r.last + 1), 'brown box jumps');
    });

    test('rejects an unrelated passage below the quality threshold', () {
      final start = original.indexOf('lazy dog');
      final q = buildTextQuoteAnchor(
        original,
        start,
        start + 'lazy dog'.length,
      );
      const elsewhere =
          'Completely different content with no similar words at all here.';
      expect(findTextQuoteRange(q, elsewhere), isNull);
    });
  });

  group('Anchor - Task 29 selection hygiene & grouping semantics', () {
    test('trimRange and mergeOverlappingRanges semantics', () {
      expect(trimRange('  hello world  ', 0, 15), const IntRange(2, 12));
      expect(trimRange('abc   def', 3, 8), const IntRange(6, 7)); // leading ws only
      expect(trimRange('   ', 0, 3), IntRange.empty);

      expect(
        mergeOverlappingRanges([
          const IntRange(5, 9),
          const IntRange(0, 4),
          const IntRange(20, 25),
          const IntRange(8, 12),
        ]),
        [const IntRange(0, 12), const IntRange(20, 25)],
      );
      expect(
        mergeOverlappingRanges([const IntRange(0, 4), const IntRange(5, 9)]),
        [const IntRange(0, 9)], // adjacent merges
      );
      expect(
        mergeOverlappingRanges([const IntRange(0, 2), IntRange.empty]),
        [const IntRange(0, 2)],
      );
    });

    test('trimRange edge cases', () {
      expect(trimRange('test', 0, 0), IntRange.empty);
      expect(trimRange('test', 2, 1), IntRange.empty);
      expect(trimRange('test', -1, 3), IntRange.empty);
      expect(trimRange('test', 0, 10), IntRange.empty);
      expect(trimRange('word', 0, 4), const IntRange(0, 3));
    });
  });

  group('Anchor - TextQuoteAnchor model and serialization', () {
    test('toJson and fromJson round-trip', () {
      const anchor = TextQuoteAnchor(
        quote: 'hello world',
        prefix: 'before ',
        suffix: ' after',
        occurrence: 2,
      );
      final json = anchor.toJson();
      expect(json, {
        'quote': 'hello world',
        'prefix': 'before ',
        'suffix': ' after',
        'occurrence': 2,
      });
      final deserialized = TextQuoteAnchor.fromJson(json);
      expect(deserialized, anchor);
      expect(deserialized.hashCode, anchor.hashCode);
    });

    test('toJson omits default empty/zero fields', () {
      const anchor = TextQuoteAnchor(quote: 'standalone');
      expect(anchor.toJson(), {'quote': 'standalone'});
      expect(TextQuoteAnchor.fromJson({'quote': 'standalone'}), anchor);
    });

    test('copyWith updates specified fields', () {
      const anchor = TextQuoteAnchor(quote: 'foo', prefix: 'p', occurrence: 1);
      final updated = anchor.copyWith(suffix: 's', occurrence: 0);
      expect(updated.quote, 'foo');
      expect(updated.prefix, 'p');
      expect(updated.suffix, 's');
      expect(updated.occurrence, 0);
    });

    test('toString formatting', () {
      const anchor = TextQuoteAnchor(
        quote: 'q',
        prefix: 'p',
        suffix: 's',
        occurrence: 1,
      );
      expect(
        anchor.toString(),
        'TextQuoteAnchor(quote: q, prefix: p, suffix: s, occurrence: 1)',
      );
    });
  });

  group('Anchor - IntRange model', () {
    test('properties and helper getters', () {
      const range = IntRange(3, 7);
      expect(range.start, 3);
      expect(range.endInclusive, 7);
      expect(range.first, 3);
      expect(range.last, 7);
      expect(range.endExclusive, 8);
      expect(range.length, 5);
      expect(range.isEmpty, isFalse);
      expect(range.isNotEmpty, isTrue);
      expect(range.toString(), 'IntRange(3..7)');
    });

    test('empty range behavior', () {
      expect(IntRange.empty.isEmpty, isTrue);
      expect(IntRange.empty.isNotEmpty, isFalse);
      expect(IntRange.empty.length, 0);
      expect(IntRange.empty.toString(), 'IntRange.empty');
      expect(const IntRange(5, 4), IntRange.empty);
      expect(const IntRange(5, 4).hashCode, IntRange.empty.hashCode);
    });
  });

  group('Anchor - Sentence boundaries and whitespace', () {
    test('sentenceStartBefore and sentenceEndAfter with punctuation', () {
      const doc = 'First sentence! Second sentence? Third sentence.\n\nFourth.';
      final secondStart = doc.indexOf('Second');
      expect(sentenceStartBefore(doc, secondStart), secondStart);

      final thirdStart = doc.indexOf('Third');
      expect(sentenceStartBefore(doc, thirdStart), thirdStart);

      final fourthStart = doc.indexOf('Fourth');
      expect(sentenceStartBefore(doc, fourthStart), fourthStart);

      final firstStart = doc.indexOf('sentence!');
      expect(sentenceEndAfter(doc, firstStart), doc.indexOf('!') + 1);

      final thirdPos = doc.indexOf('sentence.');
      expect(sentenceEndAfter(doc, thirdPos), doc.indexOf('Third sentence.') + 'Third sentence.'.length);
    });

    test('isJsWhitespace recognizes unicode whitespace and control chars', () {
      expect(isJsWhitespace(' '), isTrue);
      expect(isJsWhitespace('\t'), isTrue);
      expect(isJsWhitespace('\n'), isTrue);
      expect(isJsWhitespace('\r'), isTrue);
      expect(isJsWhitespace('\u00A0'), isTrue); // NBSP
      expect(isJsWhitespace('\u2000'), isTrue); // EN QUAD
      expect(isJsWhitespace('\u3000'), isTrue); // IDEOGRAPHIC SPACE
      expect(isJsWhitespace('\uFEFF'), isTrue); // BOM
      expect(isJsWhitespace('a'), isFalse);
      expect(isJsWhitespace(''), isFalse);
    });

    test('commonPrefixLen and commonSuffixLen', () {
      expect(commonPrefixLen('abcdef', 'abcxyz'), 3);
      expect(commonPrefixLen('hello', 'world'), 0);
      expect(commonPrefixLen('', 'abc'), 0);

      expect(commonSuffixLen('abcdef', 'xyzdef'), 3);
      expect(commonSuffixLen('hello', 'world'), 0);
      expect(commonSuffixLen('abc', ''), 0);
    });
  });

  group('Anchor - approxMatch fuzzy search direct tests', () {
    test('exact substring match with 0 errors', () {
      final matches = approxMatch('the quick brown fox', 'brown', 0);
      expect(matches.length, 1);
      expect(matches.first.start, 10);
      expect(matches.first.end, 15);
      expect(matches.first.errors, 0);
    });

    test('approximate match with 1 substitution error', () {
      final matches = approxMatch('the quick brown fox', 'brxwn', 1);
      expect(matches.length, 1);
      expect(matches.first.start, 10);
      expect(matches.first.end, 15);
      expect(matches.first.errors, 1);
    });

    test('returns empty when errors exceed maxErrors or strings empty', () {
      expect(approxMatch('the quick brown fox', 'brxxn', 1), isEmpty);
      expect(approxMatch('', 'abc', 1), isEmpty);
      expect(approxMatch('abc', '', 1), isEmpty);
      expect(approxMatch('abc', 'abc', -1), isEmpty);
    });
  });
}
