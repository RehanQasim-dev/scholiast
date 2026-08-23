import 'dart:async';
import 'package:sqlite3/sqlite3.dart';
import '../entities/ocr_text_entity.dart';

/// Data Access Object for `ocr_texts` table with reactive streams.
class OcrTextDao {
  final Database _db;
  final StreamController<void> _changeController =
      StreamController<void>.broadcast();

  OcrTextDao(this._db);

  void _notify() {
    if (!_changeController.isClosed) {
      _changeController.add(null);
    }
  }

  void dispose() {
    _changeController.close();
  }

  /// Sets or updates the extracted OCR text for [frameId].
  Future<void> setOcr(String frameId, String text, [int? updatedAt]) async {
    final timestamp =
        updatedAt ?? DateTime.now().millisecondsSinceEpoch;
    final stmt = _db.prepare('''
      INSERT INTO ocr_texts (frameId, text, updatedAt)
      VALUES (?, ?, ?)
      ON CONFLICT(frameId) DO UPDATE SET
        text = excluded.text,
        updatedAt = excluded.updatedAt
    ''');
    try {
      stmt.execute([frameId, text, timestamp]);
      _notify();
    } finally {
      stmt.dispose();
    }
  }

  /// Retrieves the extracted OCR text for [frameId], or null if not found.
  Future<String?> getOcr(String frameId) async {
    final ResultSet results = _db.select(
      'SELECT text FROM ocr_texts WHERE frameId = ?',
      [frameId],
    );
    if (results.isEmpty) return null;
    return results.first['text'] as String?;
  }

  /// Retrieves the complete [OcrTextEntity] for [frameId].
  Future<OcrTextEntity?> getOcrEntity(String frameId) async {
    final ResultSet results = _db.select(
      'SELECT * FROM ocr_texts WHERE frameId = ?',
      [frameId],
    );
    if (results.isEmpty) return null;
    return OcrTextEntity.fromRow(results.first);
  }

  /// Observes the extracted OCR text for [frameId] reactively.
  Stream<String?> watchOcr(String frameId) {
    late StreamController<String?> controller;
    StreamSubscription<void>? sub;

    Future<void> emitValue() async {
      final text = await getOcr(frameId);
      if (!controller.isClosed) {
        controller.add(text);
      }
    }

    controller = StreamController<String?>.broadcast(
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

  /// Retrieves multiple OCR records matching [frameIds].
  Future<List<OcrTextEntity>> getManyOcr(List<String> frameIds) async {
    if (frameIds.isEmpty) return const [];
    final placeholders = List.filled(frameIds.length, '?').join(',');
    final ResultSet results = _db.select(
      'SELECT * FROM ocr_texts WHERE frameId IN ($placeholders)',
      frameIds,
    );
    return results.map((row) => OcrTextEntity.fromRow(row)).toList();
  }

  /// Retrieves all OCR records ordered by newest first.
  Future<List<OcrTextEntity>> getAllOcr() async {
    final ResultSet results = _db.select(
      'SELECT * FROM ocr_texts ORDER BY updatedAt DESC',
    );
    return results.map((row) => OcrTextEntity.fromRow(row)).toList();
  }

  /// Deletes the OCR record for [frameId].
  Future<int> deleteOcr(String frameId) async {
    final stmt = _db.prepare('DELETE FROM ocr_texts WHERE frameId = ?');
    try {
      stmt.execute([frameId]);
      final changes = _db.updatedRows;
      if (changes > 0) _notify();
      return changes;
    } finally {
      stmt.dispose();
    }
  }

  /// Deletes all OCR records.
  Future<int> deleteAllOcr() async {
    _db.execute('DELETE FROM ocr_texts');
    final changes = _db.updatedRows;
    _notify();
    return changes;
  }
}
