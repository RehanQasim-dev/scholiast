import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:scholiast_flutter/core/models/models.dart';

void main() {
  group('PageRecord & PageTombstones Serialization', () {
    test('empty page record serializes to the exact TS shape', () {
      final expectedJson = jsonDecode(
        '{"version":2,"url":"https://example.com","highlights":[],"drawings":[],"videoItems":[],"diagrams":[],"tombstones":{"highlights":{},"drawings":{},"comments":{},"videoItems":{},"diagrams":{}}}',
      );
      final emptyRecord = PageRecord.empty('https://example.com');
      expect(emptyRecord.toJson(), equals(expectedJson));

      final emptyVideoPage = VideoPage.empty('https://example.com');
      expect(emptyVideoPage.toJson(), equals(expectedJson));
    });

    test('parses a merge-shaped record with desktop highlight and stroke fields', () {
      const tsJson = '''
      {"version":2,"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","title":"A lecture","videoId":"dQw4w9WgXcQ","highlights":[{"id":"hl1","updatedAt":1712345678901,"notes":["n1<!--timestamp:1712345600000-->"],"color":"yellow","xpath":"/div[1]","groupId":"g1"}],"drawings":[{"id":"dr1","updatedAt":1712345678901,"color":"yellow","width":3,"points":[0.1,0.2]}],"videoItems":[{"id":"vi1","kind":"transcript","videoTime":268,"notes":[],"updatedAt":1712345679999,"timeEnd":271.5,"quote":"The gradient flows backward.","color":"green","anchor":{"startCue":3,"startOffset":0,"endCue":3,"endOffset":54}}],"diagrams":[{"id":"dg1","updatedAt":1712345678000,"driveId":"1Dg","sceneDriveId":"1Sc"}],"tombstones":{"highlights":{"hl1":1712345600000},"drawings":{},"comments":{"hl1:1712345600000":1712345670000},"videoItems":{},"diagrams":{}}}
      ''';

      final page = PageRecord.fromJson(jsonDecode(tsJson) as Map<String, dynamic>);

      expect(page.version, 2);
      expect(page.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(page.title, 'A lecture');
      expect(page.videoId, 'dQw4w9WgXcQ');

      final hl = page.highlights.single;
      expect(hl.id, 'hl1');
      expect(hl.updatedAt, 1712345678901);
      expect(hl.notes, ['n1<!--timestamp:1712345600000-->']);
      expect(hl.color, 'yellow');
      expect(hl.extras['xpath'], '/div[1]');
      expect(hl.extras['groupId'], 'g1');

      final stroke = page.drawings.single;
      expect(stroke.id, 'dr1');
      expect(stroke.updatedAt, 1712345678901);
      expect(stroke.color, 'yellow');
      expect(stroke.width, 3.0);
      expect(stroke.points, [0.1, 0.2]);

      final item = page.videoItems.single;
      expect(item.id, 'vi1');
      expect(item.kind, 'transcript');
      expect(item.videoTime, 268.0);
      expect(item.timeEnd, 271.5);
      expect(item.anchor, const TranscriptAnchor(startCue: 3, startOffset: 0, endCue: 3, endOffset: 54));

      final diagram = page.diagrams.single;
      expect(diagram.id, 'dg1');
      expect(diagram.driveId, '1Dg');
      expect(diagram.sceneDriveId, '1Sc');

      expect(page.tombstones.highlights, {'hl1': 1712345600000});
      expect(page.tombstones.comments, {'hl1:1712345600000': 1712345670000});
      expect(page.deletedAt, isNull);
    });

    test('unknown fields survive a round-trip (extras preservation)', () {
      const tsJson = '''
      {"version":2,"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","highlights":[{"type":"text","id":"hl1","xpath":"/div[1]/p[2]","startOffset":3,"endOffset":10,"content":"some words","notes":[],"color":"red","groupId":"g7","updatedAt":1712345678901,"anchor":{"quote":"some words","surface":"web"}}],"drawings":[{"id":"dr1","updatedAt":1712345678901,"color":"blue","width":4,"points":[0.1,0.2,0.3,0.4]}],"videoItems":[],"diagrams":[],"tombstones":{"highlights":{},"drawings":{},"comments":{},"videoItems":{},"diagrams":{}}}
      ''';

      final decoded = PageRecord.fromJson(jsonDecode(tsJson) as Map<String, dynamic>);
      final reencoded = jsonEncode(decoded.toJson());

      final expected = jsonDecode(tsJson);
      final actual = jsonDecode(reencoded);
      expect(actual, equals(expected));

      expect(decoded.highlights.single.extras['type'], 'text');
      expect((decoded.highlights.single.extras['anchor'] as Map)['surface'], 'web');
      expect(decoded.drawings.single.width, 4.0);
    });

    test('deletedAt round-trips when set and is omitted when absent', () {
      final withoutDeleted = PageRecord.fromJson(jsonDecode(
        '{"version":2,"url":"u","highlights":[],"drawings":[],"videoItems":[],"diagrams":[],"tombstones":{"highlights":{},"drawings":{},"comments":{},"videoItems":{},"diagrams":{}}}',
      ) as Map<String, dynamic>);
      expect(withoutDeleted.deletedAt, isNull);
      expect(withoutDeleted.toJson().containsKey('deletedAt'), isFalse);

      final withFlag = PageRecord.empty('u').copyWith(deletedAt: 1712345678000);
      final jsonMap = withFlag.toJson();
      expect(jsonMap['deletedAt'], 1712345678000);
      expect(PageRecord.fromJson(jsonMap).deletedAt, 1712345678000);
    });
  });

  group('VideoItem & VideoMarkup Serialization', () {
    VideoItem frameItem() => const VideoItem(
          id: 'lq7x2abcde',
          kind: 'frame',
          videoTime: 124.5,
          frame: VideoFrame(driveId: '1AbCdrXyZ0123456789', w: 1280, h: 720),
          markup: VideoMarkup(
            strokes: [MarkupStroke(id: 's1', color: 'yellow', points: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6], weight: 'thin')],
            lines: [MarkupLine(id: 'l1', color: 'red', x1: 0.0, y1: 0.0, x2: 1.0, y2: 1.0)],
            texts: [MarkupText(id: 't1', color: 'green', x: 0.25, y: 0.5, w: 0.28, size: 1.5, text: "Maxwell's equations")],
            rects: [MarkupRect(id: 'r1', color: 'black', x: 0.1, y: 0.1, w: 0.2, h: 0.3, weight: 'thick')],
            arrows: [MarkupArrow(id: 'a1', color: 'yellow', x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.9, weight: 'medium')],
          ),
          notes: ['The divergence theorem applies here<!--timestamp:1712345678901-->'],
          updatedAt: 1712345678901,
        );

    VideoItem transcriptItem() => const VideoItem(
          id: 'mn8x3fghij',
          kind: 'transcript',
          videoTime: 268.0,
          notes: ['Key point to remember<!--timestamp:1712345679000--><!--edited:1712345679999-->'],
          updatedAt: 1712345679999,
          timeEnd: 271.5,
          quote: 'The gradient flows backward through the residual connection.',
          color: 'yellow',
          anchor: TranscriptAnchor(startCue: 3, startOffset: 0, endCue: 3, endOffset: 54),
        );

    VideoItem noteItem() => const VideoItem(
          id: 'op9x4jklmn',
          kind: 'note',
          videoTime: 512.0,
          notes: [
            'First pass at the proof<!--timestamp:1712345679100-->',
            'Second thought: the base case fails<!--timestamp:1712345679200--><!--edited:1712345679300-->',
          ],
          updatedAt: 1712345679300,
        );

    test('frame item serializes to the exact TS JSON', () {
      const expectedStr = '''
      {"id":"lq7x2abcde","kind":"frame","videoTime":124.5,"frame":{"driveId":"1AbCdrXyZ0123456789","w":1280,"h":720},"markup":{"strokes":[{"id":"s1","color":"yellow","points":[0.1,0.2,0.3,0.4,0.5,0.6],"weight":"thin"}],"lines":[{"id":"l1","color":"red","x1":0,"y1":0,"x2":1,"y2":1}],"texts":[{"id":"t1","color":"green","x":0.25,"y":0.5,"w":0.28,"size":1.5,"text":"Maxwell's equations"}],"rects":[{"id":"r1","color":"black","x":0.1,"y":0.1,"w":0.2,"h":0.3,"weight":"thick"}],"arrows":[{"id":"a1","color":"yellow","x1":0.1,"y1":0.2,"x2":0.8,"y2":0.9,"weight":"medium"}]},"notes":["The divergence theorem applies here<!--timestamp:1712345678901-->"],"updatedAt":1712345678901}
      ''';
      expect(jsonEncode(frameItem().toJson()), jsonEncode(jsonDecode(expectedStr)));
    });

    test('transcript item serializes to the exact TS JSON', () {
      const expectedStr = '''
      {"id":"mn8x3fghij","kind":"transcript","videoTime":268,"notes":["Key point to remember<!--timestamp:1712345679000--><!--edited:1712345679999-->"],"updatedAt":1712345679999,"timeEnd":271.5,"quote":"The gradient flows backward through the residual connection.","color":"yellow","anchor":{"startCue":3,"startOffset":0,"endCue":3,"endOffset":54}}
      ''';
      expect(jsonEncode(transcriptItem().toJson()), jsonEncode(jsonDecode(expectedStr)));
    });

    test('note item serializes to the exact TS JSON', () {
      const expectedStr = '''
      {"id":"op9x4jklmn","kind":"note","videoTime":512,"notes":["First pass at the proof<!--timestamp:1712345679100-->","Second thought: the base case fails<!--timestamp:1712345679200--><!--edited:1712345679300-->"],"updatedAt":1712345679300}
      ''';
      expect(jsonEncode(noteItem().toJson()), jsonEncode(jsonDecode(expectedStr)));
    });

    test('minimal item emits notes array but omits every optional field', () {
      const item = VideoItem(id: 'mi1', kind: 'note', videoTime: 0.0);
      expect(
        jsonEncode(item.toJson()),
        '{"id":"mi1","kind":"note","videoTime":0,"notes":[]}',
      );
    });

    test('encode-decode round-trips all three fixtures', () {
      for (final item in [frameItem(), transcriptItem(), noteItem()]) {
        final encoded = item.toJson();
        final decoded = VideoItem.fromJson(encoded);
        expect(decoded, equals(item));
      }
    });

    test('decodes a TS-ordered JSON object regardless of key order', () {
      const tsJson = '''
      {"id":"x9","kind":"frame","videoTime":10,"frame":{"dataUrl":"data:image/jpeg;base64,abc","driveId":"1D","w":640,"h":360},"markup":{"strokes":[],"lines":[],"texts":[]},"notes":[],"updatedAt":1712345678901,"excalidrawScene":{"elements":[],"appState":{}},"futureField":42}
      ''';
      final item = VideoItem.fromJson(jsonDecode(tsJson) as Map<String, dynamic>);
      expect(item.id, 'x9');
      expect(item.videoTime, 10.0);
      expect(item.frame?.dataUrl, 'data:image/jpeg;base64,abc');
      expect(item.frame?.driveId, '1D');
      expect(item.frame?.w, 640);
      expect(item.frame?.h, 360);
      expect(item.updatedAt, 1712345678901);
      expect(item.excalidrawScene, <String, dynamic>{'elements': <dynamic>[], 'appState': <String, dynamic>{}});
      expect(item.ocrText, isNull);
    });

    test('ocrText is additive - absent in desktop JSON, round-trips when set', () {
      const desktop = '{"id":"o1","kind":"frame","videoTime":1.5,"notes":[]}';
      final item = VideoItem.fromJson(jsonDecode(desktop) as Map<String, dynamic>);
      expect(item.ocrText, isNull);

      final withOcr = item.copyWith(ocrText: 'E = mc^2');
      final jsonMap = withOcr.toJson();
      expect(jsonMap['ocrText'], 'E = mc^2');
      expect(VideoItem.fromJson(jsonMap).ocrText, 'E = mc^2');
    });

    test('emptyMarkup mirrors the TS emptyMarkup shape', () {
      final markup = VideoMarkup.empty();
      expect(
        markup.toJson(),
        <String, dynamic>{
          'strokes': <dynamic>[],
          'lines': <dynamic>[],
          'texts': <dynamic>[],
          'rects': <dynamic>[],
          'arrows': <dynamic>[],
        },
      );
    });
  });

  group('LinearArticle Serialization', () {
    test('round-trips losslessly through fromJson / toJson', () {
      const article = LinearArticle(
        url: 'https://example.com/essay',
        title: 'An essay',
        byline: 'By Someone',
        blocks: [
          LinearBlock(
            kind: 'p',
            text: 'A bold idea with a link and code.',
            annotations: [
              LinearAnn(kind: 'bold', start: 2, end: 6, target: ''),
              LinearAnn(kind: 'link', start: 18, end: 22, target: 'https://example.com/x'),
              LinearAnn(kind: 'code', start: 27, end: 31, target: ''),
            ],
          ),
          LinearBlock(kind: 'h2', text: 'Section'),
          LinearBlock(kind: 'img', text: '', imgUrl: 'https://example.com/i.png', imgAlt: 'a picture'),
          LinearBlock(kind: 'blockquote', text: 'Quoted words.'),
        ],
        wordCount: 1234,
        fetchedAt: 1712345678901,
        truncated: true,
      );

      final encoded = article.toJson();
      final decoded = LinearArticle.fromJson(encoded);
      expect(decoded, equals(article));
      expect(decoded.capturedAt, 1712345678901);

      // Defaults written, nulls omitted
      const minimal = LinearArticle(url: 'https://e.com', title: null, fetchedAt: 7);
      final minJson = minimal.toJson();
      expect(minJson['fetchedAt'], 7);
      expect(minJson.containsKey('title'), isFalse);
      expect(minJson['blocks'], isEmpty);
      expect(minJson['truncated'], isFalse);

      final withUnknown = {'url': 'u', 'title': 't', 'fetchedAt': 9, 'futureField': true};
      final decodedUnknown = LinearArticle.fromJson(withUnknown);
      expect(decodedUnknown.url, 'u');
      expect(decodedUnknown.title, 't');
      expect(decodedUnknown.fetchedAt, 9);
    });
  });
}
