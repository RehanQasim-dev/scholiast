import 'dart:io';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// Abstract storage contract for video frame JPEG blobs on local storage.
abstract class FrameStore {
  /// Resolves the on-disk File for an item's JPEG.
  File fileFor(String itemId);

  /// Saves or overwrites the JPEG image bytes for [itemId].
  Future<File> save(String itemId, List<int> bytes);

  /// Loads the JPEG image bytes for [itemId], returning null if absent.
  Future<List<int>?> load(String itemId);

  /// Checks whether a JPEG exists for [itemId].
  Future<bool> has(String itemId);

  /// Deletes the JPEG for [itemId], returning true if it existed.
  Future<bool> delete(String itemId);

  /// Clears all stored frame images.
  Future<void> clearAll();
}

/// Filesystem-backed [FrameStore] storing frames under `<baseDir>/frames/<itemId>.jpg`.
class LocalFrameStore implements FrameStore {
  final Directory dir;

  LocalFrameStore(this.dir);

  static Future<LocalFrameStore> createDefault() async {
    final docsDir = await getApplicationDocumentsDirectory();
    final framesDir = Directory(p.join(docsDir.path, 'frames'));
    if (!framesDir.existsSync()) {
      framesDir.createSync(recursive: true);
    }
    return LocalFrameStore(framesDir);
  }

  @override
  File fileFor(String itemId) => File(p.join(dir.path, '$itemId.jpg'));

  @override
  Future<File> save(String itemId, List<int> bytes) async {
    final file = fileFor(itemId);
    if (!file.parent.existsSync()) {
      await file.parent.create(recursive: true);
    }
    await file.writeAsBytes(bytes, flush: true);
    return file;
  }

  @override
  Future<List<int>?> load(String itemId) async {
    final file = fileFor(itemId);
    if (!await file.exists()) return null;
    return file.readAsBytes();
  }

  @override
  Future<bool> has(String itemId) async {
    final file = fileFor(itemId);
    return file.exists();
  }

  @override
  Future<bool> delete(String itemId) async {
    final file = fileFor(itemId);
    if (!await file.exists()) return false;
    await file.delete();
    return true;
  }

  @override
  Future<void> clearAll() async {
    if (await dir.exists()) {
      final entities = dir.listSync();
      for (final e in entities) {
        if (e is File) {
          try {
            e.deleteSync();
          } catch (_) {}
        }
      }
    }
  }
}

/// In-memory [FrameStore] for tests.
class MemoryFrameStore implements FrameStore {
  final Map<String, List<int>> _storage = {};

  @override
  File fileFor(String itemId) => File('/memory/frames/$itemId.jpg');

  @override
  Future<File> save(String itemId, List<int> bytes) async {
    _storage[itemId] = List<int>.from(bytes);
    return fileFor(itemId);
  }

  @override
  Future<List<int>?> load(String itemId) async {
    final data = _storage[itemId];
    return data != null ? List<int>.from(data) : null;
  }

  @override
  Future<bool> has(String itemId) async {
    return _storage.containsKey(itemId);
  }

  @override
  Future<bool> delete(String itemId) async {
    return _storage.remove(itemId) != null;
  }

  @override
  Future<void> clearAll() async {
    _storage.clear();
  }
}
