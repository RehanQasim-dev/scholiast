import 'dart:async';
import 'package:sqlite3/sqlite3.dart';
import '../entities/sync_meta_entity.dart';

/// Data Access Object for `sync_meta` table with reactive streams.
class SyncMetaDao {
  final Database _db;
  final StreamController<void> _changeController =
      StreamController<void>.broadcast();

  SyncMetaDao(this._db);

  void _notify() {
    if (!_changeController.isClosed) {
      _changeController.add(null);
    }
  }

  void dispose() {
    _changeController.close();
  }

  /// Sets or updates metadata for a given [key].
  Future<void> setMeta(String key, String value, [int? updatedAt]) async {
    final timestamp =
        updatedAt ?? DateTime.now().millisecondsSinceEpoch;
    final stmt = _db.prepare('''
      INSERT INTO sync_meta (key, value, updatedAt)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updatedAt = excluded.updatedAt
    ''');
    try {
      stmt.execute([key, value, timestamp]);
      _notify();
    } finally {
      stmt.dispose();
    }
  }

  /// Retrieves the metadata string value for [key], or null if not found.
  Future<String?> getMeta(String key) async {
    final ResultSet results = _db.select(
      'SELECT value FROM sync_meta WHERE key = ?',
      [key],
    );
    if (results.isEmpty) return null;
    return results.first['value'] as String?;
  }

  /// Retrieves the complete [SyncMetaEntity] for [key].
  Future<SyncMetaEntity?> getMetaEntity(String key) async {
    final ResultSet results = _db.select(
      'SELECT * FROM sync_meta WHERE key = ?',
      [key],
    );
    if (results.isEmpty) return null;
    return SyncMetaEntity.fromRow(results.first);
  }

  /// Observes the metadata string value for [key] reactively.
  Stream<String?> watchMeta(String key) {
    late StreamController<String?> controller;
    StreamSubscription<void>? sub;

    Future<void> emitValue() async {
      final val = await getMeta(key);
      if (!controller.isClosed) {
        controller.add(val);
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

  /// Retrieves all metadata entries.
  Future<List<SyncMetaEntity>> getAllMeta() async {
    final ResultSet results = _db.select('SELECT * FROM sync_meta');
    return results.map((row) => SyncMetaEntity.fromRow(row)).toList();
  }

  /// Deletes the metadata entry for [key].
  Future<int> deleteMeta(String key) async {
    final stmt = _db.prepare('DELETE FROM sync_meta WHERE key = ?');
    try {
      stmt.execute([key]);
      final changes = _db.updatedRows;
      if (changes > 0) _notify();
      return changes;
    } finally {
      stmt.dispose();
    }
  }

  /// Deletes all metadata entries.
  Future<int> deleteAllMeta() async {
    _db.execute('DELETE FROM sync_meta');
    final changes = _db.updatedRows;
    _notify();
    return changes;
  }
}
