import 'package:flutter_test/flutter_test.dart';
import 'package:scholiast_flutter/core/algorithms/cue_parser.dart';
import 'package:scholiast_flutter/core/algorithms/transcript_chunker.dart';
import 'package:scholiast_flutter/core/models/transcript_models.dart';

void main() {
  const json3Fixture = '''
  {
    "wireMagic": "pb3",
    "pens": [{"w": 0, "a": 1, "f": 6}],
    "wsWinStyles": [{"fo": true, "pc": 6710886, "ms": 6710886}],
    "wpWinPositions": [{"ap": 168, "ah": 34}],
    "events": [
      {"tStartMs": 0, "dDurationMs": 2680, "segs": [{"utf8": "Welcome back to lecture "}, {"tOffsetMs": 900, "acAsrConf": 0.91, "utf8": "twelve."}]},
      {"aAppend": 0, "segs": [{"utf8": " Today we cover "}, {"utf8": "transformer architectures."}]},
      {"tStartMs": 2680, "dDurationMs": 2210, "segs": [{"utf8": "First, the attention mechanism."}]},
      {"tStartMs": 4890, "dDurationMs": 1900, "segs": [{"utf8": "Every token gets a query, key, and value."}]},
      {"tStartMs": 6790, "dDurationMs": 2130, "segs": [{"utf8": "Now let's talk about training stability."}]},
      {"aAppend": 4, "segs": [{"utf8": " It matters a lot in practice."}]},
      {"tStartMs": 8920, "dDurationMs": 1750, "segs": [{"utf8": "Gradients can vanish without care."}]},
      {"tStartMs": 10670, "dDurationMs": 2030, "segs": [{"utf8": "So we add residual connections."}]}
    ]
  }
  ''';

  group('CueParser JSON3 parsing', () {
    test('parseJson3 handles aAppend events without creating spurious cues', () {
      final cues = CueParser.parseJson3(json3Fixture);

      expect(cues.length, 6);
      // Index = position of the tStartMs event in the events array (1 and 5 are appends).
      expect(cues.map((c) => c.cueIndex).toList(), [0, 2, 3, 4, 6, 7]);
      expect(cues.map((c) => c.index).toList(), [0, 2, 3, 4, 6, 7]);

      // aAppend text accumulated into the previous cue, trimmed.
      expect(
        cues[0].text,
        'Welcome back to lecture twelve. Today we cover transformer architectures.',
      );
      expect(
        cues[3].text,
        "Now let's talk about training stability. It matters a lot in practice.",
      );

      // start/end from tStartMs + dDurationMs (in seconds and ms).
      expect(cues[0].start, 0.0);
      expect(cues[0].startMs, 0);
      expect(cues[0].duration, 2.68);
      expect(cues[0].end, 2.68);
      expect(cues[0].endMs, 2680);

      expect(cues[1].start, 2.68);
      expect(cues[1].startMs, 2680);
      expect(cues[1].duration, 2.21);
      expect(cues[1].end, 4.89);
      expect(cues[1].endMs, 4890);

      expect(cues[5].start, 10.67);
      expect(cues[5].startMs, 10670);
      expect(cues[5].duration, 2.03);
      expect(cues[5].end, 12.7);
      expect(cues[5].endMs, 12700);
    });

    test('parseJson3 with no events returns empty', () {
      expect(CueParser.parseJson3('{"wireMagic": "pb3", "events": []}'), isEmpty);
      expect(CueParser.parseJson3('{"wireMagic": "pb3"}'), isEmpty);
    });

    test('parseJson3 with malformed json throws ParseException', () {
      expect(
        () => CueParser.parseJson3('{oops not json'),
        throwsA(isA<ParseException>()),
      );
    });
  });

  group('CueParser XML parsing', () {
    test('parseXml srv3 format', () {
      const xml = '''
        <?xml version="1.0" encoding="utf-8" ?>
        <transcript>
          <p t="0" d="2680"><s>Welcome back </s><s>to lecture </s><s>twelve.</s></p>
          <p t="2680" d="2210"><s>First, the attention mechanism.</s></p>
          <p t="4890"><s>No duration attribute here.</s></p>
        </transcript>
      ''';
      final cues = CueParser.parseXml(xml);
      expect(cues.length, 3);
      expect(cues[0].cueIndex, 0);
      expect(cues[0].text, 'Welcome back to lecture twelve.');
      expect(cues[0].start, 0.0);
      expect(cues[0].startMs, 0);
      expect(cues[0].duration, 2.68);
      expect(cues[0].end, 2.68);
      expect(cues[0].endMs, 2680);

      expect(cues[1].cueIndex, 1);
      expect(cues[1].text, 'First, the attention mechanism.');
      expect(cues[1].start, 2.68);
      expect(cues[1].end, 4.89);

      expect(cues[2].cueIndex, 2);
      expect(cues[2].text, 'No duration attribute here.');
      expect(cues[2].start, 4.89);
      expect(cues[2].duration, 0.0);
      expect(cues[2].end, 4.89);
    });

    test('parseXml text format with entity decoding', () {
      const xml = '''
        <?xml version="1.0" encoding="utf-8" ?>
        <transcript>
          <text start="0" dur="2.68">Welcome &amp; thanks, it&#39;s great &#x1F600;</text>
          <text start="2.68" dur="2.21">Second line &lt;tag&gt; &#38; &quot;quotes&quot;</text>
        </transcript>
      ''';
      final cues = CueParser.parseXml(xml);
      expect(cues.length, 2);
      expect(cues[0].text, "Welcome & thanks, it's great 😀");
      expect(cues[0].start, 0.0);
      expect(cues[0].duration, 2.68);
      expect(cues[0].end, 2.68);
      expect(cues[0].startMs, 0);
      expect(cues[0].endMs, 2680);

      expect(cues[1].text, 'Second line <tag> & "quotes"');
      expect(cues[1].start, 2.68);
      expect(cues[1].duration, 2.21);
      expect(cues[1].end, 4.89);
      expect(cues[1].startMs, 2680);
      expect(cues[1].endMs, 4890);
    });

    test('parse auto-detects xml vs json3', () {
      expect(CueParser.parse('<transcript></transcript>'), isEmpty);
      expect(CueParser.parse(json3Fixture).length, 6);
    });
  });

  group('TranscriptChunker', () {
    test('semanticChunk matches TS behavior on the json3 fixture', () {
      final cues = CueParser.parseJson3(json3Fixture);
      final paragraphs = TranscriptChunker.semanticChunk(cues);

      // Every cue ends a sentence → one paragraph per cue, in order.
      expect(paragraphs.length, 6);
      expect(paragraphs.map((p) => p.cueRange.$1).toList(), [0, 2, 3, 4, 6, 7]);
      expect(paragraphs.map((p) => p.cueRange.$2).toList(), [0, 2, 3, 4, 6, 7]);
      expect(paragraphs[0].start, 0.0);
      expect(paragraphs[0].startMs, 0);
      expect(paragraphs[0].end, 2.68);
      expect(paragraphs[0].endMs, 2680);
      expect(
        paragraphs[0].text,
        'Welcome back to lecture twelve. Today we cover transformer architectures.',
      );
      expect(paragraphs[5].text, 'So we add residual connections.');
    });

    test('semanticChunk flushes on a long gap between consecutive cue starts', () {
      const cues = [
        Cue(cueIndex: 0, start: 0.0, duration: 3.0, text: 'Opening sentence.'),
        Cue(cueIndex: 1, start: 5.0, duration: 2.0, text: 'second cue'),
        Cue(cueIndex: 2, start: 26.0, duration: 2.0, text: 'after a long pause'), // gap 21s > 20s
        Cue(cueIndex: 3, start: 30.0, duration: 2.0, text: 'tail'),
      ];
      final paragraphs = TranscriptChunker.semanticChunk(cues);
      expect(paragraphs.length, 3);
      expect(paragraphs[0].text, 'Opening sentence.');
      expect(paragraphs[1].text, 'second cue');
      expect(paragraphs[2].text, 'after a long pause tail');
      expect(paragraphs[2].start, 26.0);
      expect(paragraphs[2].startMs, 26000);
      expect(paragraphs[2].end, 32.0);
      expect(paragraphs[2].endMs, 32000);
      expect(paragraphs[2].cueRange, (2, 3));
      expect(paragraphs[2].cueCount, 2);
    });

    test('semanticChunk flushes an unpunctuated run at 30 seconds', () {
      const cues = [
        Cue(cueIndex: 0, start: 0.0, duration: 5.0, text: 'alpha'),
        Cue(cueIndex: 1, start: 10.0, duration: 5.0, text: 'beta'),
        Cue(cueIndex: 2, start: 20.0, duration: 5.0, text: 'gamma'),
        Cue(cueIndex: 3, start: 31.0, duration: 5.0, text: 'delta'), // 31s from para start → flush
        Cue(cueIndex: 4, start: 41.0, duration: 5.0, text: 'epsilon'),
      ];
      final paragraphs = TranscriptChunker.semanticChunk(cues);
      expect(paragraphs.length, 2);
      // The 30s rule flushes AFTER pushing the triggering cue (TS behavior):
      // delta belongs to the flushed paragraph.
      expect(paragraphs[0].text, 'alpha beta gamma delta');
      expect(paragraphs[0].cueRange, (0, 3));
      expect(paragraphs[0].end, 36.0);
      expect(paragraphs[0].endMs, 36000);

      expect(paragraphs[1].text, 'epsilon');
      expect(paragraphs[1].cueRange, (4, 4));
      expect(paragraphs[1].start, 41.0);
      expect(paragraphs[1].startMs, 41000);
      expect(paragraphs[1].end, 46.0);
      expect(paragraphs[1].endMs, 46000);
    });

    test('splitOnInternalSentences splits a two-sentence cue', () {
      const cues = [
        Cue(
          cueIndex: 0,
          start: 0.0,
          duration: 2.68,
          text: 'Welcome back to lecture twelve. Today we cover transformer architectures.',
        ),
        Cue(
          cueIndex: 2,
          start: 2.68,
          duration: 2.21,
          text: 'First, the attention mechanism.',
        ),
      ];
      final split = TranscriptChunker.splitOnInternalSentences(cues);
      expect(split.length, 3);
      expect(split[0].text, 'Welcome back to lecture twelve.');
      expect(split[1].text, 'Today we cover transformer architectures.');
      // Both halves keep the original cue's timing.
      expect(split[0].start, 0.0);
      expect(split[1].start, 0.0);
      expect(split[1].end, 2.68);
      // Unsplit cues keep their text and renumber sequentially.
      expect(split[2].text, 'First, the attention mechanism.');
      expect(split[2].cueIndex, 2);
    });

    test('chunk full pipeline splits internal sentences and chunks paragraphs', () {
      final cues = CueParser.parseJson3(json3Fixture);
      final paragraphs = TranscriptChunker.chunk(cues);

      // The two 2-sentence cues split, producing 8 paragraphs
      expect(paragraphs.length, 8);
      expect(paragraphs[0].text, 'Welcome back to lecture twelve.');
      expect(paragraphs[1].text, 'Today we cover transformer architectures.');
      expect(paragraphs[2].text, 'First, the attention mechanism.');
      expect(paragraphs[3].text, 'Every token gets a query, key, and value.');
      expect(paragraphs[4].text, "Now let's talk about training stability.");
      expect(paragraphs[5].text, 'It matters a lot in practice.');
      expect(paragraphs[6].text, 'Gradients can vanish without care.');
      expect(paragraphs[7].text, 'So we add residual connections.');
    });
  });

  group('Transcript Models Serialization & Equality', () {
    test('Cue json round-trip', () {
      const cue = Cue(start: 1.5, duration: 2.5, text: 'Hello world', cueIndex: 3);
      final jsonMap = cue.toJson();
      final decoded = Cue.fromJson(jsonMap);
      expect(decoded, equals(cue));
      expect(decoded.end, 4.0);
      expect(decoded.startMs, 1500);
      expect(decoded.endMs, 4000);
    });

    test('Cue decodes legacy / Kotlin startMs & endMs json format', () {
      final legacyJson = {'startMs': 1000, 'endMs': 3500, 'text': 'Legacy cue', 'index': 5};
      final cue = Cue.fromJson(legacyJson);
      expect(cue.start, 1.0);
      expect(cue.duration, 2.5);
      expect(cue.text, 'Legacy cue');
      expect(cue.cueIndex, 5);
    });

    test('CueParagraph json round-trip', () {
      const cues = [
        Cue(start: 0.0, duration: 2.0, text: 'First part.', cueIndex: 0),
        Cue(start: 2.0, duration: 2.0, text: 'Second part.', cueIndex: 1),
      ];
      const para = CueParagraph(start: 0.0, text: 'First part. Second part.', cues: cues);
      final jsonMap = para.toJson();
      final decoded = CueParagraph.fromJson(jsonMap);
      expect(decoded, equals(para));
      expect(decoded.cueRange, (0, 1));
      expect(decoded.cueCount, 2);
    });

    test('CaptionTrack and LoadedTranscript json round-trip', () {
      const track = CaptionTrack(
        languageCode: 'en',
        name: 'English (auto-generated)',
        baseUrl: 'https://youtube.com/api/timedtext',
        isAsr: true,
      );
      final trackJson = track.toJson();
      expect(CaptionTrack.fromJson(trackJson), equals(track));

      const loaded = LoadedTranscript(
        videoId: 'dQw4w9WgXcQ',
        languageCode: 'en',
        tracks: [track],
        cues: [Cue(start: 0.0, duration: 2.0, text: 'Hi', cueIndex: 0)],
        paragraphs: [
          CueParagraph(
            start: 0.0,
            text: 'Hi',
            cues: [Cue(start: 0.0, duration: 2.0, text: 'Hi', cueIndex: 0)],
          ),
        ],
      );
      final loadedJson = loaded.toJson();
      expect(LoadedTranscript.fromJson(loadedJson), equals(loaded));
    });
  });
}
