import 'dart:async';
import 'dart:convert';
import '../algorithms/merge_page_record.dart';
import '../algorithms/normalize.dart';
import '../database/daos/sync_meta_dao.dart';
import '../database/daos/video_page_dao.dart';
import '../database/entities/video_page_entity.dart';
import '../models/models.dart';
import 'frame_store.dart';
import 'google_drive_client.dart';
import 'sync_models.dart';

/// The core synchronization state machine reconciling web and video annotation
/// pages with Google Drive's `appDataFolder`.
///
/// Implements 3-way merge (`mergePageRecord`), local SQLite persistence,
/// optimistic CAS concurrency control (`If-Match: headRevisionId`), and
/// image blob synchronization.
class SyncEngine {
  final GoogleDriveClient driveClient;
  final VideoPageDao videoPageDao;
  final SyncMetaDao? syncMetaDao;
  final FrameStore frameStore;
  final int Function() now;

  final StreamController<SyncStatus> _statusController =
      StreamController<SyncStatus>.broadcast();

  SyncStatus _currentStatus = const SyncStatus();
  Future<void> _lock = Future.value();

  SyncEngine({
    required this.driveClient,
    required this.videoPageDao,
    this.syncMetaDao,
    required this.frameStore,
    int Function()? now,
  }) : now = now ?? (() => DateTime.now().millisecondsSinceEpoch);

  /// Stream of live sync state updates.
  Stream<SyncStatus> get statusStream => _statusController.stream;

  /// Current snapshot of sync engine status.
  SyncStatus get currentStatus => _currentStatus;

  void dispose() {
    _statusController.close();
  }

  void _setStatus(SyncStatus status) {
    _currentStatus = status;
    if (!_statusController.isClosed) {
      _statusController.add(status);
    }
  }

  /// Serializes operations so background pushes and full syncs never interleave.
  Future<T> _synchronized<T>(Future<T> Function() operation) {
    final completer = Completer<T>();
    _lock = _lock.then((_) async {
      try {
        final result = await operation();
        completer.complete(result);
      } catch (e, st) {
        completer.completeError(e, st);
      }
    });
    return completer.future;
  }

  // --- Public Sync Operations ------------------------------------------------

  /// Targeted reconcile for specific URLs (unconditional, does not skip).
  Future<SyncResult> syncChanged(
    List<String> urls, {
    bool interactive = false,
  }) {
    return _synchronized(() async {
      _setStatus(SyncStatus.syncing(
        connected: true,
        lastSyncedAt: _currentStatus.lastSyncedAt,
        progress: SyncProgress(
          phase: 'page',
          done: 0,
          total: urls.length,
        ),
      ));

      final targetUrls = urls
          .map((u) => normalizeUrl(u))
          .where((u) => u.isNotEmpty)
          .toSet()
          .toList();

      var reconciled = 0;
      final errors = <String>[];

      for (var i = 0; i < targetUrls.length; i++) {
        final url = targetUrls[i];
        final hash = urlHash(url);
        final localEntity = await videoPageDao.getPage(hash);

        _setStatus(SyncStatus.syncing(
          connected: true,
          lastSyncedAt: _currentStatus.lastSyncedAt,
          progress: SyncProgress(
            phase: 'page',
            done: i,
            total: targetUrls.length,
            url: url,
            title: localEntity?.title,
          ),
        ));

        try {
          await syncPage(url, interactive: interactive);
          reconciled++;
        } catch (e) {
          errors.add('$url: $e');
        }
      }

      final nowMs = now();
      if (errors.isEmpty) {
        _setStatus(SyncStatus.idle(
          connected: true,
          lastSyncedAt: nowMs,
        ));
      } else {
        _setStatus(SyncStatus.error(
          error: errors.join('; '),
          connected: true,
          lastSyncedAt: nowMs,
        ));
      }

      return SyncResult(
        reconciled: reconciled,
        skipped: 0,
        errors: errors,
      );
    });
  }

  /// Full library reconciliation against Google Drive.
  ///
  /// Discovers remote-only pages, checks in-sync state to skip unchanged pages
  /// with zero network overhead, and reconciles the rest.
  Future<SyncResult> syncAll({bool interactive = false}) {
    return _synchronized(() async {
      _setStatus(SyncStatus.syncing(
        connected: true,
        lastSyncedAt: _currentStatus.lastSyncedAt,
        progress: const SyncProgress(
          phase: 'discovering',
          done: 0,
          total: 0,
        ),
      ));

      try {
        // Collect all local URLs
        final localPages = await videoPageDao.getAllPages();
        final urlSet = <String>{};
        final localNames = <String>{};

        for (final p in localPages) {
          if (p.url.isNotEmpty) {
            final normalized = normalizeUrl(p.url);
            urlSet.add(normalized);
            localNames.add(pageFileName(normalized));
          }
        }

        // Fetch remote pages list from Drive
        final remoteFiles = <DriveFileInfo>[];
        String? pageToken;
        do {
          final page = await driveClient.listFolder(
            DriveFolder.pages,
            pageToken: pageToken,
            interactive: interactive,
          );
          remoteFiles.addAll(page.files);
          pageToken = page.nextPageToken;
        } while (pageToken != null && pageToken.isNotEmpty);

        final metaByName = <String, DriveFileInfo>{};
        for (final f in remoteFiles) {
          if (f.name != null) {
            metaByName[f.name!] = f;
            // Discover remote-only pages
            if (!localNames.contains(f.name)) {
              try {
                final jsonStr = await driveClient.getFileJson(
                  f.fileId,
                  interactive: interactive,
                );
                final decoded = jsonDecode(jsonStr) as Map<String, dynamic>;
                final remoteRec = PageRecord.fromJson(decoded);
                if (remoteRec.url.isNotEmpty) {
                  urlSet.add(normalizeUrl(remoteRec.url));
                }
              } catch (_) {
                // Skip corrupt file
              }
            }
          }
        }

        var reconciled = 0;
        var skipped = 0;
        final errors = <String>[];
        final allUrls = urlSet.toList();

        for (var i = 0; i < allUrls.length; i++) {
          final url = allUrls[i];
          final fileName = pageFileName(url);
          final remoteMeta = metaByName[fileName];

          // Check if already in sync
          if (await isPageInSync(url, remoteMeta)) {
            skipped++;
            continue;
          }

          final hash = urlHash(url);
          final localEntity = await videoPageDao.getPage(hash);

          _setStatus(SyncStatus.syncing(
            connected: true,
            lastSyncedAt: _currentStatus.lastSyncedAt,
            progress: SyncProgress(
              phase: 'page',
              done: reconciled + skipped,
              total: allUrls.length,
              url: url,
              title: localEntity?.title,
            ),
          ));

          try {
            await syncPage(url, knownMeta: remoteMeta, interactive: interactive);
            reconciled++;
          } catch (e) {
            errors.add('$url: $e');
          }
        }

        final nowMs = now();
        if (errors.isEmpty) {
          _setStatus(SyncStatus.idle(
            connected: true,
            lastSyncedAt: nowMs,
          ));
        } else {
          _setStatus(SyncStatus.error(
            error: errors.join('; '),
            connected: true,
            lastSyncedAt: nowMs,
          ));
        }

        return SyncResult(
          reconciled: reconciled,
          skipped: skipped,
          errors: errors,
        );
      } catch (e) {
        _setStatus(SyncStatus.error(
          error: e.toString(),
          connected: true,
        ));
        rethrow;
      }
    });
  }

  // --- Single-Page Reconcile -------------------------------------------------

  /// Reconciles a single web or video page record by its URL or URL hash.
  Future<DriveFileInfo> syncPage(
    String urlOrHash, {
    DriveFileInfo? knownMeta,
    bool interactive = false,
  }) async {
    final normalized = normalizeUrl(urlOrHash);
    final hash = urlHash(normalized);
    final fileName = pageFileName(normalized);

    final initialLocal = await videoPageDao.getPage(hash);
    final snap = initialLocal?.snap;

    for (var attempt = 0; attempt < 4; attempt++) {
      final t = now();
      final fileMeta = (attempt == 0 && knownMeta != null)
          ? knownMeta
          : await driveClient.findInFolder(
              DriveFolder.pages,
              fileName,
              interactive: interactive,
            );

      PageRecord? remote;
      if (fileMeta != null) {
        try {
          final jsonStr = await driveClient.getFileJson(
            fileMeta.fileId,
            interactive: interactive,
          );
          remote = PageRecord.fromJson(jsonDecode(jsonStr) as Map<String, dynamic>);
        } catch (_) {
          remote = null;
        }
      }

      final pageEntity = await videoPageDao.getPage(hash);
      final localBefore = assembleLocalPage(normalized, snap, pageEntity);
      final local = await pushImages(localBefore, interactive: interactive);
      final merged = mergePageRecord(snap, local, remote, t);

      final mergedJson = jsonEncode(stripForUpload(merged).toJson());
      final remoteJson =
          remote != null ? jsonEncode(stripForUpload(remote).toJson()) : null;

      DriveFileInfo outMeta;
      if (fileMeta == null) {
        outMeta = await driveClient.uploadFileJson(
          name: fileName,
          jsonContent: mergedJson,
          folder: DriveFolder.pages,
          interactive: interactive,
        );
      } else if (mergedJson == remoteJson) {
        outMeta = fileMeta; // In sync remotely
      } else {
        final fresh = await driveClient.findInFolder(
          DriveFolder.pages,
          fileName,
          interactive: interactive,
        );
        if (fresh != null &&
            fresh.headRevisionId != fileMeta.headRevisionId &&
            attempt < 3) {
          continue; // Remote moved — re-merge
        }

        try {
          outMeta = await driveClient.uploadFileJson(
            name: fileName,
            jsonContent: mergedJson,
            existingFileId: fileMeta.fileId,
            headRevisionId: fileMeta.headRevisionId,
            folder: DriveFolder.pages,
            interactive: interactive,
          );
        } on SyncConflictException {
          if (attempt < 3) continue;
          rethrow;
        }
      }

      // Check if local database was mutated during network I/O
      final pageNow = await videoPageDao.getPage(hash);
      final localNow = assembleLocalPage(normalized, snap, pageNow);
      if (entityFingerprint(localNow) != entityFingerprint(localBefore) &&
          attempt < 3) {
        continue;
      }

      await pullImages(merged, interactive: interactive);

      // Save reconciled state back to SQLite
      final reconciledEntity = VideoPageEntity(
        urlHash: hash,
        url: normalized,
        videoId: merged.videoId ?? pageNow?.videoId,
        title: merged.title ?? pageNow?.title,
        itemsJson: jsonEncode(merged.videoItems.map((e) => e.toJson()).toList()),
        highlightsJson:
            jsonEncode(merged.highlights.map((e) => e.toJson()).toList()),
        updatedAt: t,
        snapJson: jsonEncode(merged.toJson()),
        fileId: outMeta.fileId,
        headRevisionId: outMeta.headRevisionId,
        readerJson: pageNow?.readerJson,
      );

      await videoPageDao.upsertPage(reconciledEntity);
      return outMeta;
    }

    throw PageSyncException(normalized, 'Page did not sync after 4 attempts');
  }

  // --- In-Sync Check & Assembly ----------------------------------------------

  /// Returns true if local data matches the last snapshot and the remote Drive
  /// revision has not changed.
  Future<bool> isPageInSync(String url, DriveFileInfo? remoteMeta) async {
    if (remoteMeta?.headRevisionId == null) return false;
    final normalized = normalizeUrl(url);
    final hash = urlHash(normalized);

    final entity = await videoPageDao.getPage(hash);
    if (entity == null) return false;

    final snap = entity.snap;
    final metaHead = entity.headRevisionId;
    if (snap == null || metaHead == null) return false;
    if (entity.fileId != remoteMeta!.fileId || metaHead != remoteMeta.headRevisionId) {
      return false;
    }

    final local = assembleLocalPage(normalized, snap, entity);
    return entityFingerprint(local) == entityFingerprint(snap);
  }

  /// Builds the local [PageRecord] from SQLite entity and snapshot merge base.
  PageRecord assembleLocalPage(
    String url,
    PageRecord? snap,
    VideoPageEntity? entity,
  ) {
    if (entity == null) {
      return PageRecord.empty(url).copyWith(
        drawings: snap?.drawings,
        diagrams: snap?.diagrams,
      );
    }

    return PageRecord(
      version: 2,
      url: entity.url.isNotEmpty ? entity.url : url,
      title: entity.title ?? snap?.title,
      videoId: entity.videoId ?? snap?.videoId,
      highlights: entity.highlights,
      drawings: snap?.drawings ?? const [],
      videoItems: entity.items,
      diagrams: snap?.diagrams ?? const [],
      tombstones: const PageTombstones(),
    );
  }

  /// Produces a deterministic entity fingerprint JSON string.
  String entityFingerprint(PageRecord rec) {
    final sortedHl = List<PageHighlight>.from(rec.highlights)
      ..sort((a, b) => a.id.compareTo(b.id));
    final sortedDr = List<PageStroke>.from(rec.drawings)
      ..sort((a, b) => a.id.compareTo(b.id));
    final sortedVi = List<VideoItem>.from(stripForUpload(rec).videoItems)
      ..sort((a, b) => a.id.compareTo(b.id));
    final sortedDg = List<PageDiagram>.from(rec.diagrams)
      ..sort((a, b) => a.id.compareTo(b.id));

    final map = <String, dynamic>{
      'title': rec.title ?? '',
      'videoId': rec.videoId ?? '',
      'highlights': sortedHl.map((e) => e.toJson()).toList(),
      'drawings': sortedDr.map((e) => e.toJson()).toList(),
      'videoItems': sortedVi.map((e) => e.toJson()).toList(),
      'diagrams': sortedDg.map((e) => e.toJson()).toList(),
    };

    return jsonEncode(map);
  }

  // --- Blob Push & Pull ------------------------------------------------------

  /// Pushes local video frame JPEG blobs to Drive, updating items with assigned `driveId`.
  Future<PageRecord> pushImages(
    PageRecord local, {
    bool interactive = false,
  }) async {
    var changed = false;
    final items = <VideoItem>[];

    for (final item in local.videoItems) {
      final f = item.frame;
      if (f == null || f.driveId != null) {
        items.add(item);
        continue;
      }

      final bytes = await frameStore.load(item.id);
      if (bytes == null || bytes.isEmpty) {
        items.add(item); // Not on this device
        continue;
      }

      try {
        final meta = await driveClient.uploadBlob(
          name: 'frame-${item.id}.jpg',
          bytes: bytes,
          mimeType: 'image/jpeg',
          folder: DriveFolder.frames,
          interactive: interactive,
        );
        changed = true;
        items.add(item.copyWith(frame: f.copyWith(driveId: meta.fileId)));
      } catch (_) {
        items.add(item); // Retry on next sync
      }
    }

    return changed ? local.copyWith(videoItems: items) : local;
  }

  /// Downloads missing video frame JPEG blobs from Drive into local [FrameStore].
  Future<void> pullImages(
    PageRecord merged, {
    bool interactive = false,
  }) async {
    for (final item in merged.videoItems) {
      final f = item.frame;
      final driveId = f?.driveId;
      if (driveId == null || driveId.isEmpty) continue;

      if (!await frameStore.has(item.id)) {
        try {
          final bytes = await driveClient.downloadBlob(
            driveId,
            interactive: interactive,
          );
          if (bytes.isNotEmpty) {
            await frameStore.save(item.id, bytes);
          }
        } catch (_) {
          // Retry on next sync
        }
      }
    }
  }

  /// Strips runtime-only dataUrl from video frames before serialization.
  PageRecord stripForUpload(PageRecord rec) {
    return rec.copyWith(
      videoItems: rec.videoItems.map((item) {
        final f = item.frame;
        if (f == null) return item;
        return item.copyWith(frame: f.copyWith(dataUrl: null));
      }).toList(),
    );
  }
}
