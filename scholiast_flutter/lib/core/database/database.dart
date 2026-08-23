import 'dart:ffi';
import 'dart:io';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqlite3/open.dart';
import 'package:sqlite3/sqlite3.dart';

import 'daos/ocr_text_dao.dart';
import 'daos/sync_meta_dao.dart';
import 'daos/video_page_dao.dart';

bool _sqliteInitialized = false;

/// Ensures the dynamic SQLite library is located and loaded across Linux and Android.
void ensureSqliteInitialized() {
  if (_sqliteInitialized) return;
  if (Platform.isLinux) {
    open.overrideFor(OperatingSystem.linux, () {
      try {
        return DynamicLibrary.open('libsqlite3.so.0');
      } catch (_) {
        try {
          return DynamicLibrary.open(
              '/usr/lib/x86_64-linux-gnu/libsqlite3.so.0');
        } catch (_) {
          return DynamicLibrary.open('libsqlite3.so');
        }
      }
    });
  }
  _sqliteInitialized = true;
}

/// The app's single SQLite database (`scholiast.db`), schema v2.
///
/// Implemented using direct `sqlite3` without code generation dependencies.
class AppDatabase {
  final Database db;
  late final VideoPageDao videoPages;
  late final SyncMetaDao syncMeta;
  late final OcrTextDao ocrTexts;

  AppDatabase(this.db) {
    _initSchema();
    videoPages = VideoPageDao(db);
    syncMeta = SyncMetaDao(db);
    ocrTexts = OcrTextDao(db);
  }

  /// In-memory database instance for unit and integration testing.
  factory AppDatabase.inMemory() {
    ensureSqliteInitialized();
    final memDb = sqlite3.openInMemory();
    return AppDatabase(memDb);
  }

  /// Opens the persisted SQLite database file in the application documents directory.
  static Future<AppDatabase> open() async {
    ensureSqliteInitialized();
    final dir = await getApplicationDocumentsDirectory();
    final dbPath = p.join(dir.path, 'scholiast.db');
    final db = sqlite3.open(dbPath);
    return AppDatabase(db);
  }

  int get schemaVersion => 2;

  void _initSchema() {
    db.execute('''
      CREATE TABLE IF NOT EXISTS video_pages (
        urlHash TEXT PRIMARY KEY NOT NULL,
        url TEXT NOT NULL,
        videoId TEXT,
        title TEXT,
        itemsJson TEXT NOT NULL,
        updatedAt INTEGER NOT NULL,
        snapJson TEXT,
        fileId TEXT,
        headRevisionId TEXT,
        highlightsJson TEXT NOT NULL DEFAULT '[]',
        readerJson TEXT
      );

      CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ocr_texts (
        frameId TEXT PRIMARY KEY NOT NULL,
        text TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      );
    ''');
  }

  void close() {
    videoPages.dispose();
    syncMeta.dispose();
    ocrTexts.dispose();
    db.dispose();
  }
}
