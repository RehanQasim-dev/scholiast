import 'dart:async';
import 'package:sqlite3/sqlite3.dart';
import '../entities/video_page_entity.dart';

/// Data Access Object for `video_pages` table with reactive streams.
class VideoPageDao {
  final Database _db;
  final StreamController<void> _changeController =
      StreamController<void>.broadcast();

  VideoPageDao(this._db);

  void _notify() {
    if (!_changeController.isClosed) {
      _changeController.add(null);
    }
  }

  void dispose() {
    _changeController.close();
  }

  /// Inserts or updates a complete [VideoPageEntity] record.
  Future<void> upsertPage(VideoPageEntity entity) async {
    final stmt = _db.prepare('''
      INSERT INTO video_pages (
        urlHash, url, videoId, title, itemsJson, updatedAt,
        snapJson, fileId, headRevisionId, highlightsJson, readerJson
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(urlHash) DO UPDATE SET
        url = excluded.url,
        videoId = excluded.videoId,
        title = excluded.title,
        itemsJson = excluded.itemsJson,
        updatedAt = excluded.updatedAt,
        snapJson = excluded.snapJson,
        fileId = excluded.fileId,
        headRevisionId = excluded.headRevisionId,
        highlightsJson = excluded.highlightsJson,
        readerJson = excluded.readerJson
    ''');
    try {
      stmt.execute([
        entity.urlHash,
        entity.url,
        entity.videoId,
        entity.title,
        entity.itemsJson,
        entity.updatedAt,
        entity.snapJson,
        entity.fileId,
        entity.headRevisionId,
        entity.highlightsJson,
        entity.readerJson,
      ]);
      _notify();
    } finally {
      stmt.dispose();
    }
  }

  /// Fetches a single page by its [urlHash].
  Future<VideoPageEntity?> getPage(String urlHash) async {
    final ResultSet results = _db.select(
      'SELECT * FROM video_pages WHERE urlHash = ?',
      [urlHash],
    );
    if (results.isEmpty) return null;
    return VideoPageEntity.fromRow(results.first);
  }

  /// Observes a single page by its [urlHash] reactively.
  Stream<VideoPageEntity?> watchPage(String urlHash) {
    late StreamController<VideoPageEntity?> controller;
    StreamSubscription<void>? sub;

    Future<void> emitValue() async {
      final page = await getPage(urlHash);
      if (!controller.isClosed) {
        controller.add(page);
      }
    }

    controller = StreamController<VideoPageEntity?>.broadcast(
      onListen: () {
        emitValue();
        sub = _changeController.stream.listen((_) => emitValue());
      },
      onCancel: () {
        sub?.cancel();
      },
    );

    return controller.stream;
  }

  /// Fetches all pages ordered by most recently updated first.
  Future<List<VideoPageEntity>> getAllPages() async {
    final ResultSet results = _db.select(
      'SELECT * FROM video_pages ORDER BY updatedAt DESC',
    );
    return results.map((row) => VideoPageEntity.fromRow(row)).toList();
  }

  /// Observes all pages reactively ordered by most recently updated first.
  Stream<List<VideoPageEntity>> watchAllPages() {
    late StreamController<List<VideoPageEntity>> controller;
    StreamSubscription<void>? sub;

    Future<void> emitValue() async {
      final pages = await getAllPages();
      if (!controller.isClosed) {
        controller.add(pages);
      }
    }

    controller = StreamController<List<VideoPageEntity>>.broadcast(
      onListen: () {
        emitValue();
        sub = _changeController.stream.listen((_) => emitValue());
      },
      onCancel: () {
        sub?.cancel();
      },
    );

    return controller.stream;
  }

  /// Lists the most recent pages with an optional [limit].
  Future<List<VideoPageEntity>> listRecent({int limit = 50}) async {
    final ResultSet results = _db.select(
      'SELECT * FROM video_pages ORDER BY updatedAt DESC LIMIT ?',
      [limit],
    );
    return results.map((row) => VideoPageEntity.fromRow(row)).toList();
  }

  /// Observes recent pages reactively with an optional [limit].
  Stream<List<VideoPageEntity>> watchRecent({int limit = 50}) {
    late StreamController<List<VideoPageEntity>> controller;
    StreamSubscription<void>? sub;

    Future<void> emitValue() async {
      final pages = await listRecent(limit: limit);
      if (!controller.isClosed) {
        controller.add(pages);
      }
    }

    controller = StreamController<List<VideoPageEntity>>.broadcast(
      onListen: () {
        emitValue();
        sub = _changeController.stream.listen((_) => emitValue());
      },
      onCancel: () {
        sub?.cancel();
      },
    );

    return controller.stream;
  }

  /// Observes pages that have webpage annotations or reader content.
  Stream<List<VideoPageEntity>> watchPagesWithHighlights() {
    late StreamController<List<VideoPageEntity>> controller;
    StreamSubscription<void>? sub;

    Future<void> emitValue() async {
      final ResultSet results = _db.select(
        "SELECT * FROM video_pages WHERE (highlightsJson != '[]' OR readerJson IS NOT NULL) ORDER BY updatedAt DESC",
      );
      final pages =
          results.map((row) => VideoPageEntity.fromRow(row)).toList();
      if (!controller.isClosed) {
        controller.add(pages);
      }
    }

    controller = StreamController<List<VideoPageEntity>>.broadcast(
      onListen: () {
        emitValue();
        sub = _changeController.stream.listen((_) => emitValue());
      },
      onCancel: () {
        sub?.cancel();
      },
    );

    return controller.stream;
  }

  /// Deletes a single page by [urlHash].
  Future<int> deletePage(String urlHash) async {
    final stmt = _db.prepare('DELETE FROM video_pages WHERE urlHash = ?');
    try {
      stmt.execute([urlHash]);
      final changes = _db.updatedRows;
      if (changes > 0) _notify();
      return changes;
    } finally {
      stmt.dispose();
    }
  }

  /// Deletes all pages in the table.
  Future<int> deleteAllPages() async {
    _db.execute('DELETE FROM video_pages');
    final changes = _db.updatedRows;
    _notify();
    return changes;
  }

  /// Updates the [updatedAt] timestamp for a given [urlHash].
  Future<int> touch(String urlHash, int updatedAt) async {
    final stmt = _db.prepare(
      'UPDATE video_pages SET updatedAt = ? WHERE urlHash = ?',
    );
    try {
      stmt.execute([updatedAt, urlHash]);
      final changes = _db.updatedRows;
      if (changes > 0) _notify();
      return changes;
    } finally {
      stmt.dispose();
    }
  }

  /// Updates sync metadata fields for a given [urlHash].
  Future<int> updateSyncMeta({
    required String urlHash,
    String? snapJson,
    String? fileId,
    String? headRevisionId,
  }) async {
    final stmt = _db.prepare('''
      UPDATE video_pages SET
        snapJson = ?,
        fileId = ?,
        headRevisionId = ?
      WHERE urlHash = ?
    ''');
    try {
      stmt.execute([snapJson, fileId, headRevisionId, urlHash]);
      final changes = _db.updatedRows;
      if (changes > 0) _notify();
      return changes;
    } finally {
      stmt.dispose();
    }
  }
}
