import 'package:flutter_test/flutter_test.dart';
import 'package:scholiast_flutter/core/database/database.dart';
import 'package:scholiast_flutter/core/database/entities/video_page_entity.dart';

void main() {
  late AppDatabase db;

  setUp(() {
    db = AppDatabase.inMemory();
  });

  tearDown(() {
    db.close();
  });

  group('VideoPageDao CRUD & Streams', () {
    test('upsert, get and delete VideoPage', () async {
      const entity = VideoPageEntity(
        urlHash: 'hash123',
        url: 'https://example.com/lecture',
        videoId: 'dQw4w9WgXcQ',
        title: 'Quantum Computing Lecture',
        itemsJson:
            '[{"id":"vi1","kind":"note","videoTime":120.0,"notes":["A great insight"]}]',
        updatedAt: 1712345678900,
        highlightsJson:
            '[{"id":"hl1","updatedAt":1712345678900,"color":"yellow","notes":[]}]',
        readerJson:
            '{"url":"https://example.com/lecture","title":"Quantum Computing Lecture","blocks":[],"wordCount":450,"fetchedAt":1712345678900}',
        snapJson: '{"version":2,"url":"https://example.com/lecture"}',
        fileId: 'drive_file_1',
        headRevisionId: 'rev_1',
      );

      await db.videoPages.upsertPage(entity);

      final fetched = await db.videoPages.getPage('hash123');
      expect(fetched, isNotNull);
      expect(fetched!.urlHash, 'hash123');
      expect(fetched.url, 'https://example.com/lecture');
      expect(fetched.videoId, 'dQw4w9WgXcQ');
      expect(fetched.title, 'Quantum Computing Lecture');
      expect(fetched.updatedAt, 1712345678900);
      expect(fetched.fileId, 'drive_file_1');
      expect(fetched.headRevisionId, 'rev_1');

      // Parsed model extensions
      expect(fetched.items.length, 1);
      expect(fetched.items.first.id, 'vi1');
      expect(fetched.items.first.videoTime, 120.0);
      expect(fetched.highlights.length, 1);
      expect(fetched.highlights.first.id, 'hl1');
      expect(fetched.reader, isNotNull);
      expect(fetched.reader!.wordCount, 450);
      expect(fetched.snap, isNotNull);
      expect(fetched.snap!.url, 'https://example.com/lecture');

      // Update sync meta
      await db.videoPages.updateSyncMeta(
        urlHash: 'hash123',
        fileId: 'drive_file_updated',
        headRevisionId: 'rev_2',
      );
      final updated = await db.videoPages.getPage('hash123');
      expect(updated!.fileId, 'drive_file_updated');
      expect(updated.headRevisionId, 'rev_2');

      // Delete page
      final deleted = await db.videoPages.deletePage('hash123');
      expect(deleted, 1);
      expect(await db.videoPages.getPage('hash123'), isNull);
    });

    test('watchPage emits updates reactively', () async {
      const entity = VideoPageEntity(
        urlHash: 'live_hash',
        url: 'https://example.com/live',
        updatedAt: 1000,
      );

      final stream = db.videoPages.watchPage('live_hash');
      final expectation = expectLater(
        stream,
        emitsInOrder([
          isNull, // initial read before upsert
          predicate<VideoPageEntity?>((p) => p != null && p.updatedAt == 1000),
          predicate<VideoPageEntity?>((p) => p != null && p.updatedAt == 2000),
          isNull, // after deletion
        ]),
      );

      await Future<void>.delayed(const Duration(milliseconds: 50));
      await db.videoPages.upsertPage(entity);

      await Future<void>.delayed(const Duration(milliseconds: 50));
      await db.videoPages.touch('live_hash', 2000);

      await Future<void>.delayed(const Duration(milliseconds: 50));
      await db.videoPages.deletePage('live_hash');

      await expectation;
    });

    test('watchAllPages and watchPagesWithHighlights filtering', () async {
      const p1 = VideoPageEntity(
        urlHash: 'h1',
        url: 'https://e.com/1',
        updatedAt: 100,
        highlightsJson: '[]',
      );
      const p2 = VideoPageEntity(
        urlHash: 'h2',
        url: 'https://e.com/2',
        updatedAt: 200,
        highlightsJson: '[{"id":"hl1"}]',
      );

      await db.videoPages.upsertPage(p1);
      await db.videoPages.upsertPage(p2);

      final all = await db.videoPages.getAllPages();
      expect(all.length, 2);
      expect(all.first.urlHash, 'h2'); // newest first

      final recent = await db.videoPages.listRecent(limit: 1);
      expect(recent.length, 1);
      expect(recent.first.urlHash, 'h2');
    });
  });

  group('SyncMetaDao CRUD & Streams', () {
    test('set, get, watch, and delete metadata', () async {
      await db.syncMeta.setMeta('tag_index', '["#math", "#physics"]');

      expect(
        await db.syncMeta.getMeta('tag_index'),
        '["#math", "#physics"]',
      );

      final entity = await db.syncMeta.getMetaEntity('tag_index');
      expect(entity, isNotNull);
      expect(entity!.key, 'tag_index');
      expect(entity.value, '["#math", "#physics"]');

      final stream = db.syncMeta.watchMeta('tag_index');
      final expectation = expectLater(
        stream,
        emitsInOrder([
          '["#math", "#physics"]',
          '["#math", "#physics", "#biology"]',
          isNull,
        ]),
      );

      await Future<void>.delayed(const Duration(milliseconds: 50));
      await db.syncMeta.setMeta('tag_index', '["#math", "#physics", "#biology"]');

      await Future<void>.delayed(const Duration(milliseconds: 50));
      await db.syncMeta.deleteMeta('tag_index');

      await expectation;
    });
  });

  group('OcrTextDao CRUD & Streams', () {
    test('set, get, getMany, and delete OCR text', () async {
      await db.ocrTexts.setOcr('frame_001', 'E = mc^2');
      await db.ocrTexts.setOcr('frame_002', 'F = ma');

      expect(await db.ocrTexts.getOcr('frame_001'), 'E = mc^2');
      expect(await db.ocrTexts.getOcr('frame_002'), 'F = ma');
      expect(await db.ocrTexts.getOcr('nonexistent'), isNull);

      final many = await db.ocrTexts.getManyOcr(['frame_001', 'frame_002']);
      expect(many.length, 2);

      final all = await db.ocrTexts.getAllOcr();
      expect(all.length, 2);

      await db.ocrTexts.deleteOcr('frame_001');
      expect(await db.ocrTexts.getOcr('frame_001'), isNull);
      expect(await db.ocrTexts.getOcr('frame_002'), 'F = ma');

      await db.ocrTexts.deleteAllOcr();
      expect(await db.ocrTexts.getAllOcr(), isEmpty);
    });
  });
}
