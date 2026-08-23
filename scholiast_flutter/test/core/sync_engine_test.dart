import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:scholiast_flutter/core/algorithms/normalize.dart';
import 'package:scholiast_flutter/core/auth/secure_token_store.dart';
import 'package:scholiast_flutter/core/database/database.dart';
import 'package:scholiast_flutter/core/database/entities/video_page_entity.dart';
import 'package:scholiast_flutter/core/models/models.dart';
import 'package:scholiast_flutter/core/sync/drive_auth_service.dart';
import 'package:scholiast_flutter/core/sync/frame_store.dart';
import 'package:scholiast_flutter/core/sync/google_drive_client.dart';
import 'package:scholiast_flutter/core/sync/sync_engine.dart';
import 'package:scholiast_flutter/core/sync/sync_models.dart';

/// Test HTTP adapter for Dio allowing deterministic response mocking.
class MockHttpClientAdapter implements HttpClientAdapter {
  Future<ResponseBody> Function(RequestOptions options)? handler;

  MockHttpClientAdapter([this.handler]);

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    if (handler != null) {
      return handler!(options);
    }
    return ResponseBody.fromString('{}', 200, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    });
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  ensureSqliteInitialized();

  group('Sync Models & Exceptions', () {
    test('SyncStatus serialization and factory constructors', () {
      final idle = SyncStatus.idle(connected: true, lastSyncedAt: 1700000000000);
      expect(idle.state, SyncState.idle);
      expect(idle.connected, isTrue);
      expect(idle.syncing, isFalse);
      expect(idle.lastSyncedAt, 1700000000000);

      final json = idle.toJson();
      final roundTrip = SyncStatus.fromJson(json);
      expect(roundTrip, equals(idle));

      final syncing = SyncStatus.syncing(
        connected: true,
        progress: const SyncProgress(
          phase: 'page',
          done: 2,
          total: 5,
          url: 'https://example.com',
          title: 'Example',
        ),
      );
      expect(syncing.state, SyncState.syncing);
      expect(syncing.syncing, isTrue);
      expect(syncing.progress?.current, 2);
      expect(syncing.progress?.step, 2);
      expect(syncing.progress?.total, 5);

      final syncingJson = syncing.toJson();
      expect(SyncStatus.fromJson(syncingJson), equals(syncing));

      final error = SyncStatus.error(error: 'Network timeout');
      expect(error.state, SyncState.error);
      expect(error.lastError, 'Network timeout');

      final unauth = SyncStatus.unauthenticated();
      expect(unauth.state, SyncState.unauthenticated);
      expect(unauth.connected, isFalse);
    });

    test('DriveFileInfo and DriveFilePage serialization', () {
      const file = DriveFileInfo(
        fileId: 'file_123',
        name: 'page-abc.json',
        headRevisionId: 'rev_1',
        modifiedTime: '2026-08-22T12:00:00Z',
        size: 1024,
      );

      expect(file.id, 'file_123');
      expect(file.fileId, 'file_123');
      expect(file.name, 'page-abc.json');
      expect(file.headRevisionId, 'rev_1');
      expect(file.size, 1024);

      final json = file.toJson();
      expect(DriveFileInfo.fromJson(json), equals(file));

      const page = DriveFilePage(
        files: [file],
        nextPageToken: 'token_next',
      );
      final pageJson = page.toJson();
      final pageRoundTrip = DriveFilePage.fromJson(pageJson);
      expect(pageRoundTrip.files.length, 1);
      expect(pageRoundTrip.files.first, equals(file));
      expect(pageRoundTrip.nextPageToken, 'token_next');
    });

    test('SyncResult equality and properties', () {
      const res1 = SyncResult(reconciled: 3, skipped: 1, errors: []);
      expect(res1.ok, isTrue);
      expect(res1.reconciled, 3);
      expect(res1.skipped, 1);

      const res2 = SyncResult(reconciled: 3, skipped: 1, errors: []);
      expect(res1, equals(res2));

      const res3 = SyncResult(reconciled: 2, skipped: 1, errors: ['Failed url']);
      expect(res3.ok, isFalse);
      expect(res1 == res3, isFalse);
    });

    test('Exceptions formatting', () {
      const conflict = SyncConflictException('Conflict on revision', fileId: 'f1');
      expect(conflict.toString(), contains('Conflict on revision'));

      const pageSync = PageSyncException('https://example.com', 'Failed after 4 retries');
      expect(pageSync.toString(), contains('https://example.com'));

      const notConfigured = OAuthNotConfiguredException();
      expect(notConfigured.toString(), contains('OAuth is not configured'));

      const notConnected = OAuthNotConnectedException();
      expect(notConnected.toString(), contains('not connected'));
    });
  });

  group('DriveAuthService & PKCE', () {
    late FlutterSecureStorage secureStorage;
    late SecureTokenStore tokenStore;
    late Dio dio;
    late MockHttpClientAdapter adapter;
    late DriveAuthService authService;

    setUp(() {
      FlutterSecureStorage.setMockInitialValues({});
      secureStorage = const FlutterSecureStorage();
      tokenStore = SecureTokenStore(storage: secureStorage);
      adapter = MockHttpClientAdapter();
      dio = Dio()..httpClientAdapter = adapter;

      authService = DriveAuthService(
        tokenStore: tokenStore,
        config: const OAuthConfig(
          nativeClientId: 'real-client-id.apps.googleusercontent.com',
          nativeClientSecret: 'real-client-secret',
          redirectUri: 'scholiast://oauth2redirect',
        ),
        dio: dio,
        now: () => 1700000000000,
      );
    });

    test('Pkce verifier and challenge generation', () {
      final verifier = Pkce.generateVerifier();
      expect(verifier.length, 128);
      expect(RegExp(r'^[A-Za-z0-9_-]+$').hasMatch(verifier), isTrue);

      final challenge = Pkce.generateChallenge(verifier);
      expect(challenge.length, greaterThanOrEqualTo(43));
      expect(RegExp(r'^[A-Za-z0-9_-]+$').hasMatch(challenge), isTrue);
    });

    test('OAuthConfig isConfigured verification', () {
      const placeholder = OAuthConfig();
      expect(placeholder.isConfigured, isFalse);

      final configured = placeholder.copyWith(
        nativeClientId: '12345-abc.apps.googleusercontent.com',
        nativeClientSecret: 'GOCSPX-real-secret',
      );
      expect(configured.isConfigured, isTrue);
    });

    test('buildAuthUrl builds valid Google OAuth URL', () {
      final url = authService.buildAuthUrl(
        verifier: 'my-verifier',
        challenge: 'my-challenge',
        state: 'my-state',
      );

      final uri = Uri.parse(url);
      expect(uri.scheme, 'https');
      expect(uri.host, 'accounts.google.com');
      expect(uri.queryParameters['client_id'], 'real-client-id.apps.googleusercontent.com');
      expect(uri.queryParameters['response_type'], 'code');
      expect(uri.queryParameters['code_challenge'], 'my-challenge');
      expect(uri.queryParameters['code_challenge_method'], 'S256');
      expect(uri.queryParameters['state'], 'my-state');
      expect(uri.queryParameters['access_type'], 'offline');
    });

    test('exchangeCode exchanges authorization code for tokens and persists', () async {
      adapter.handler = (options) async {
        expect(options.path, 'https://oauth2.googleapis.com/token');
        final data = options.data as Map<String, String>;
        expect(data['grant_type'], 'authorization_code');
        expect(data['code'], 'test-auth-code');
        expect(data['code_verifier'], 'test-verifier');

        return ResponseBody.fromString(
          jsonEncode({
            'access_token': 'access-token-xyz',
            'expires_in': 3600,
            'refresh_token': 'refresh-token-abc',
          }),
          200,
          headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
        );
      };

      final tokens = await authService.exchangeCode(
        code: 'test-auth-code',
        verifier: 'test-verifier',
        redirectUri: 'scholiast://oauth2redirect',
      );

      expect(tokens.accessToken, 'access-token-xyz');
      expect(tokens.refreshToken, 'refresh-token-abc');
      expect(tokens.expiresAt, 1700000000000 + (3600 - 60) * 1000);

      final stored = await tokenStore.loadDriveTokens();
      expect(stored, equals(tokens));
      expect(await authService.isConnected(), isTrue);
    });

    test('getAccessToken refreshes expired access token seamlessly', () async {
      // Seed expired tokens
      await tokenStore.saveDriveTokens(const DriveTokens(
        accessToken: 'old-access-token',
        expiresAt: 1600000000000, // in the past
        refreshToken: 'valid-refresh-token',
      ));

      adapter.handler = (options) async {
        expect(options.path, 'https://oauth2.googleapis.com/token');
        final data = options.data as Map<String, String>;
        expect(data['grant_type'], 'refresh_token');
        expect(data['refresh_token'], 'valid-refresh-token');

        return ResponseBody.fromString(
          jsonEncode({
            'access_token': 'fresh-access-token',
            'expires_in': 3600,
          }),
          200,
          headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
        );
      };

      final token = await authService.getAccessToken();
      expect(token, 'fresh-access-token');

      final updated = await tokenStore.loadDriveTokens();
      expect(updated?.accessToken, 'fresh-access-token');
      expect(updated?.refreshToken, 'valid-refresh-token');
    });

    test('getAccessToken throws OAuthNotConnectedException when invalid_grant', () async {
      await tokenStore.saveDriveTokens(const DriveTokens(
        accessToken: 'expired-token',
        expiresAt: 1000,
        refreshToken: 'revoked-refresh-token',
      ));

      adapter.handler = (options) async {
        return ResponseBody.fromString(
          jsonEncode({
            'error': 'invalid_grant',
            'error_description': 'Token has been revoked.',
          }),
          400,
          headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
        );
      };

      await expectLater(
        () => authService.getAccessToken(),
        throwsA(isA<OAuthNotConnectedException>()),
      );

      // Verify token store was cleared
      expect(await tokenStore.loadDriveTokens(), isNull);
    });

    test('disconnect revokes credentials and clears token store', () async {
      await tokenStore.saveDriveTokens(const DriveTokens(
        accessToken: 'token-to-revoke',
        expiresAt: 1800000000000,
        refreshToken: 'refresh-to-revoke',
      ));

      var revoked = false;
      adapter.handler = (options) async {
        if (options.path.contains('revoke')) {
          revoked = true;
          return ResponseBody.fromString('', 200);
        }
        return ResponseBody.fromString('{}', 200);
      };

      await authService.disconnect();
      expect(revoked, isTrue);
      expect(await tokenStore.loadDriveTokens(), isNull);
      expect(await authService.isConnected(), isFalse);
    });
  });

  group('GoogleDriveClient REST Operations', () {
    late Dio dio;
    late MockHttpClientAdapter adapter;
    late GoogleDriveClient client;

    setUp(() {
      adapter = MockHttpClientAdapter();
      dio = Dio()..httpClientAdapter = adapter;
      client = GoogleDriveClient(
        dio: dio,
        tokenProvider: ({bool interactive = false}) async => 'test-bearer-token',
      );
    });

    test('ensureFolder queries existing folder and caches ID', () async {
      adapter.handler = (options) async {
        expect(options.headers['Authorization'], 'Bearer test-bearer-token');
        expect(options.queryParameters['spaces'], 'appDataFolder');
        expect(options.queryParameters['q'], contains("name='pages'"));

        return ResponseBody.fromString(
          jsonEncode({
            'files': [
              {'id': 'folder_pages_123', 'name': 'pages'}
            ]
          }),
          200,
          headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
        );
      };

      final folderId = await client.ensureFolder(DriveFolder.pages);
      expect(folderId, 'folder_pages_123');

      // Second call uses cache without network
      adapter.handler = (options) => throw Exception('Should use cache');
      final cachedId = await client.ensureFolder(DriveFolder.pages);
      expect(cachedId, 'folder_pages_123');
    });

    test('findInFolder returns DriveFileInfo or null', () async {
      adapter.handler = (options) async {
        if (options.method == 'GET' && options.queryParameters['q']?.contains("name='pages'") == true) {
          return ResponseBody.fromString(
            jsonEncode({'files': [{'id': 'folder_pages_id', 'name': 'pages'}]}),
            200,
            headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
          );
        }

        if (options.queryParameters['q']?.contains("name='page-123.json'") == true) {
          return ResponseBody.fromString(
            jsonEncode({
              'files': [
                {
                  'id': 'file_page_123',
                  'name': 'page-123.json',
                  'headRevisionId': 'rev_42',
                  'modifiedTime': '2026-08-22T10:00:00Z',
                  'size': 512,
                }
              ]
            }),
            200,
            headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
          );
        }

        return ResponseBody.fromString(
          jsonEncode({'files': <Map<String, dynamic>>[]}),
          200,
          headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
        );
      };

      final found = await client.findInFolder(DriveFolder.pages, 'page-123.json');
      expect(found, isNotNull);
      expect(found?.fileId, 'file_page_123');
      expect(found?.headRevisionId, 'rev_42');

      final notFound = await client.findInFolder(DriveFolder.pages, 'page-missing.json');
      expect(notFound, isNull);
    });

    test('uploadFileJson creates new file with multipart body', () async {
      adapter.handler = (options) async {
        if (options.path.endsWith('/files') && options.method == 'GET') {
          return ResponseBody.fromString(
            jsonEncode({'files': [{'id': 'folder_pages_id', 'name': 'pages'}]}),
            200,
            headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
          );
        }

        if (options.path.contains('/upload/drive/v3/files') && options.method == 'POST') {
          expect(options.queryParameters['uploadType'], 'multipart');
          expect(options.headers['Content-Type'], contains('multipart/related'));

          return ResponseBody.fromString(
            jsonEncode({
              'id': 'new_created_file_id',
              'name': 'page-new.json',
              'headRevisionId': 'rev_initial',
              'size': 120,
            }),
            200,
            headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
          );
        }

        return ResponseBody.fromString('{}', 200);
      };

      final meta = await client.uploadFileJson(
        name: 'page-new.json',
        jsonContent: '{"url":"https://example.com"}',
        folder: DriveFolder.pages,
      );

      expect(meta.fileId, 'new_created_file_id');
      expect(meta.headRevisionId, 'rev_initial');
    });

    test('uploadFileJson updates existing file with If-Match revision check', () async {
      adapter.handler = (options) async {
        if (options.method == 'PATCH' && options.path.contains('/files/existing_file_id')) {
          expect(options.headers['If-Match'], 'rev_1');
          expect(options.data, '{"updated":true}');

          return ResponseBody.fromString(
            jsonEncode({
              'id': 'existing_file_id',
              'name': 'page-existing.json',
              'headRevisionId': 'rev_2',
            }),
            200,
            headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
          );
        }
        return ResponseBody.fromString('{}', 200);
      };

      final meta = await client.uploadFileJson(
        name: 'page-existing.json',
        jsonContent: '{"updated":true}',
        existingFileId: 'existing_file_id',
        headRevisionId: 'rev_1',
      );

      expect(meta.fileId, 'existing_file_id');
      expect(meta.headRevisionId, 'rev_2');
    });

    test('uploadFileJson throws SyncConflictException on 412', () async {
      adapter.handler = (options) async {
        return ResponseBody.fromString(
          jsonEncode({'error': {'message': 'Precondition Failed'}}),
          412,
          headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
        );
      };

      await expectLater(
        () => client.uploadFileJson(
          name: 'page.json',
          jsonContent: '{}',
          existingFileId: 'file_id',
          headRevisionId: 'old_rev',
        ),
        throwsA(isA<SyncConflictException>()),
      );
    });

    test('uploadBlob and downloadBlob roundtrip', () async {
      final sampleBytes = Uint8List.fromList([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);

      adapter.handler = (options) async {
        if (options.path.endsWith('/files') && options.method == 'GET') {
          return ResponseBody.fromString(
            jsonEncode({'files': [{'id': 'folder_frames_id', 'name': 'frames'}]}),
            200,
            headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
          );
        }

        if (options.path.contains('/upload/drive/v3/files') && options.method == 'POST') {
          return ResponseBody.fromString(
            jsonEncode({'id': 'blob_frame_123', 'name': 'frame-1.jpg'}),
            200,
            headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
          );
        }

        if (options.path.contains('/files/blob_frame_123') && options.queryParameters['alt'] == 'media') {
          return ResponseBody.fromBytes(
            sampleBytes,
            200,
            headers: {Headers.contentTypeHeader: ['image/jpeg']},
          );
        }

        return ResponseBody.fromString('{}', 200);
      };

      final meta = await client.uploadBlob(
        name: 'frame-1.jpg',
        bytes: sampleBytes,
        folder: DriveFolder.frames,
      );
      expect(meta.fileId, 'blob_frame_123');

      final downloaded = await client.downloadBlob('blob_frame_123');
      expect(downloaded, equals(sampleBytes));
    });

    test('401 unauthorized triggers retry with fresh token', () async {
      var tokenCalls = 0;
      var invalidated = false;

      final dynamicClient = GoogleDriveClient(
        dio: dio,
        tokenProvider: ({bool interactive = false}) async {
          tokenCalls++;
          return 'token-v$tokenCalls';
        },
        onUnauthorized: () async {
          invalidated = true;
        },
      );

      var attempt = 0;
      adapter.handler = (options) async {
        attempt++;
        if (attempt == 1) {
          expect(options.headers['Authorization'], 'Bearer token-v1');
          return ResponseBody.fromString(
            jsonEncode({'error': 'Unauthorized'}),
            401,
            headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
          );
        }

        expect(options.headers['Authorization'], 'Bearer token-v2');
        return ResponseBody.fromString('{"url":"https://example.com"}', 200);
      };

      final text = await dynamicClient.getFileJson('file_abc');
      expect(text, '{"url":"https://example.com"}');
      expect(invalidated, isTrue);
      expect(attempt, 2);
    });
  });

  group('FrameStore Local & Memory', () {
    test('MemoryFrameStore save, load, has, delete', () async {
      final store = MemoryFrameStore();
      const itemId = 'item_1';
      final bytes = [1, 2, 3, 4, 5];

      expect(await store.has(itemId), isFalse);
      expect(await store.load(itemId), isNull);

      await store.save(itemId, bytes);
      expect(await store.has(itemId), isTrue);
      expect(await store.load(itemId), equals(bytes));

      expect(await store.delete(itemId), isTrue);
      expect(await store.has(itemId), isFalse);
      expect(await store.delete(itemId), isFalse);
    });
  });

  group('SyncEngine Reconciliation State Machine', () {
    late AppDatabase db;
    late MemoryFrameStore frameStore;
    late MockHttpClientAdapter adapter;
    late GoogleDriveClient driveClient;
    late SyncEngine syncEngine;

    setUp(() {
      db = AppDatabase.inMemory();
      frameStore = MemoryFrameStore();
      adapter = MockHttpClientAdapter();
      final dio = Dio()..httpClientAdapter = adapter;
      driveClient = GoogleDriveClient(
        dio: dio,
        tokenProvider: ({bool interactive = false}) async => 'test-token',
      );
      syncEngine = SyncEngine(
        driveClient: driveClient,
        videoPageDao: db.videoPages,
        syncMetaDao: db.syncMeta,
        frameStore: frameStore,
        now: () => 1700000000000,
      );
    });

    tearDown(() {
      syncEngine.dispose();
      db.close();
    });

    test('syncPage pushes new local page and images to Drive', () async {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      final hash = urlHash(url);
      final fileName = pageFileName(url);

      // Save a local item with a frame that needs uploading
      await frameStore.save('frame_1', [10, 20, 30]);

      const localItem = VideoItem(
        id: 'frame_1',
        kind: 'frame',
        videoTime: 12.5,
        frame: FrameImage(w: 1280, h: 720), // no driveId yet
        notes: ['Great moment'],
      );

      const highlight = PageHighlight(
        id: 'hl_1',
        extras: {'type': 'text', 'content': 'Important quote'},
      );

      await db.videoPages.upsertPage(VideoPageEntity(
        urlHash: hash,
        url: url,
        videoId: 'dQw4w9WgXcQ',
        title: 'Never Gonna Give You Up',
        itemsJson: jsonEncode([localItem.toJson()]),
        highlightsJson: jsonEncode([highlight.toJson()]),
        updatedAt: 1700000000000,
      ));

      // Mock Drive responses
      adapter.handler = (options) async {
        // Folder queries
        if (options.path.endsWith('/files') && options.method == 'GET') {
          if (options.queryParameters['q']?.contains("name='pages'") == true) {
            return ResponseBody.fromString(
              jsonEncode({'files': [{'id': 'folder_pages', 'name': 'pages'}]}),
              200,
              headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
            );
          }
          if (options.queryParameters['q']?.contains("name='frames'") == true) {
            return ResponseBody.fromString(
              jsonEncode({'files': [{'id': 'folder_frames', 'name': 'frames'}]}),
              200,
              headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
            );
          }
          // File lookup
          if (options.queryParameters['q']?.contains("name='$fileName'") == true) {
            return ResponseBody.fromString(
              jsonEncode({'files': <Map<String, dynamic>>[]}), // Does not exist on Drive yet
              200,
              headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
            );
          }
        }

        // Upload frame image blob
        if (options.path.contains('/upload/drive/v3/files') && options.method == 'POST') {
          final isImage = options.data is List<int> &&
              utf8.decode(options.data as List<int>, allowMalformed: true).contains('image/jpeg');
          if (isImage) {
            return ResponseBody.fromString(
              jsonEncode({'id': 'drive_blob_frame_1', 'name': 'frame-frame_1.jpg'}),
              200,
              headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
            );
          }

          // Upload page JSON
          return ResponseBody.fromString(
            jsonEncode({
              'id': 'drive_page_file_id',
              'name': fileName,
              'headRevisionId': 'rev_v1',
            }),
            200,
            headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
          );
        }

        return ResponseBody.fromString('{}', 200);
      };

      final meta = await syncEngine.syncPage(url);
      expect(meta.fileId, 'drive_page_file_id');
      expect(meta.headRevisionId, 'rev_v1');

      // Verify SQLite state updated with snap and driveId
      final updatedEntity = await db.videoPages.getPage(hash);
      expect(updatedEntity?.fileId, 'drive_page_file_id');
      expect(updatedEntity?.headRevisionId, 'rev_v1');
      expect(updatedEntity?.snap, isNotNull);
      expect(updatedEntity?.items.first.frame?.driveId, 'drive_blob_frame_1');
    });

    test('syncPage pulls remote page and missing frame images from Drive', () async {
      const url = 'https://example.com/article';
      final hash = urlHash(url);
      final fileName = pageFileName(url);

      const remoteRecord = PageRecord(
        version: 2,
        url: url,
        title: 'Remote Article',
        highlights: [
          PageHighlight(id: 'hl_remote', extras: {'type': 'text', 'content': 'Remote highlight'}),
        ],
        videoItems: [
          VideoItem(
            id: 'remote_item_1',
            kind: 'frame',
            videoTime: 5.0,
            frame: FrameImage(w: 1280, h: 720, driveId: 'remote_drive_blob_1'),
          ),
        ],
        drawings: [],
        diagrams: [],
        tombstones: PageTombstones(),
      );

      final frameBlobData = Uint8List.fromList([1, 2, 3, 4, 5, 6]);

      adapter.handler = (options) async {
        if (options.path.endsWith('/files') && options.method == 'GET') {
          if (options.queryParameters['q']?.contains("name='pages'") == true) {
            return ResponseBody.fromString(
              jsonEncode({'files': [{'id': 'folder_pages', 'name': 'pages'}]}),
              200,
              headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
            );
          }
          if (options.queryParameters['q']?.contains("name='$fileName'") == true) {
            return ResponseBody.fromString(
              jsonEncode({
                'files': [
                  {
                    'id': 'remote_file_id_99',
                    'name': fileName,
                    'headRevisionId': 'rev_remote_1',
                  }
                ]
              }),
              200,
              headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
            );
          }
        }

        if (options.path.contains('/files/remote_file_id_99') && options.queryParameters['alt'] == 'media') {
          return ResponseBody.fromString(
            jsonEncode(remoteRecord.toJson()),
            200,
            headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
          );
        }

        if (options.path.contains('/files/remote_drive_blob_1') && options.queryParameters['alt'] == 'media') {
          return ResponseBody.fromBytes(frameBlobData, 200);
        }

        return ResponseBody.fromString('{}', 200);
      };

      final meta = await syncEngine.syncPage(url);
      expect(meta.fileId, 'remote_file_id_99');
      expect(meta.headRevisionId, 'rev_remote_1');

      // Verify local SQLite saved the remote page
      final localEntity = await db.videoPages.getPage(hash);
      expect(localEntity?.title, 'Remote Article');
      expect(localEntity?.highlights.length, 1);
      expect(localEntity?.highlights.first.id, 'hl_remote');
      expect(localEntity?.items.length, 1);

      // Verify missing frame image was downloaded into frameStore
      expect(await frameStore.has('remote_item_1'), isTrue);
      expect(await frameStore.load('remote_item_1'), equals(frameBlobData));
    });

    test('isPageInSync skips unchanged pages with 0 network calls', () async {
      const url = 'https://example.com/sync-check';
      final hash = urlHash(url);

      const record = PageRecord(
        version: 2,
        url: url,
        title: 'Checked Page',
        highlights: [PageHighlight(id: 'h1', extras: {'type': 'text', 'content': 'Same'})],
        drawings: [],
        videoItems: [],
        diagrams: [],
        tombstones: PageTombstones(),
      );

      await db.videoPages.upsertPage(VideoPageEntity(
        urlHash: hash,
        url: url,
        title: 'Checked Page',
        highlightsJson: jsonEncode(record.highlights.map((e) => e.toJson()).toList()),
        itemsJson: '[]',
        updatedAt: 1700000000000,
        snapJson: jsonEncode(record.toJson()),
        fileId: 'file_exact',
        headRevisionId: 'rev_exact',
      ));

      const meta = DriveFileInfo(
        fileId: 'file_exact',
        name: 'page-abc.json',
        headRevisionId: 'rev_exact',
      );

      final inSync = await syncEngine.isPageInSync(url, meta);
      expect(inSync, isTrue);

      // If remote revision moved
      const metaMoved = DriveFileInfo(
        fileId: 'file_exact',
        name: 'page-abc.json',
        headRevisionId: 'rev_new_moved',
      );
      expect(await syncEngine.isPageInSync(url, metaMoved), isFalse);

      // If local edited
      await db.videoPages.upsertPage(VideoPageEntity(
        urlHash: hash,
        url: url,
        title: 'Locally Edited Title',
        highlightsJson: jsonEncode(record.highlights.map((e) => e.toJson()).toList()),
        itemsJson: '[]',
        updatedAt: 1700000000000,
        snapJson: jsonEncode(record.toJson()),
        fileId: 'file_exact',
        headRevisionId: 'rev_exact',
      ));
      expect(await syncEngine.isPageInSync(url, meta), isFalse);
    });

    test('syncAll discovers remote-only pages and skips in-sync pages', () async {
      const urlInSync = 'https://example.com/in-sync';
      const urlRemote = 'https://example.com/remote-only';

      final hashInSync = urlHash(urlInSync);
      final fileInSyncName = pageFileName(urlInSync);
      final fileRemoteName = pageFileName(urlRemote);

      final inSyncRec = PageRecord.empty(urlInSync).copyWith(title: 'In Sync');
      await db.videoPages.upsertPage(VideoPageEntity(
        urlHash: hashInSync,
        url: urlInSync,
        title: 'In Sync',
        snapJson: jsonEncode(inSyncRec.toJson()),
        fileId: 'file_in_sync',
        headRevisionId: 'rev_in_sync',
        updatedAt: 1700000000000,
      ));

      final remoteRec = PageRecord.empty(urlRemote).copyWith(title: 'Remote Discovered');

      adapter.handler = (options) async {
        if (options.path.endsWith('/files') && options.method == 'GET') {
          if (options.queryParameters['q']?.contains("name='pages'") == true) {
            return ResponseBody.fromString(
              jsonEncode({'files': [{'id': 'folder_pages', 'name': 'pages'}]}),
              200,
              headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
            );
          }

          // listFolder pages
          if (options.queryParameters['q']?.contains("'folder_pages' in parents") == true) {
            return ResponseBody.fromString(
              jsonEncode({
                'files': [
                  {
                    'id': 'file_in_sync',
                    'name': fileInSyncName,
                    'headRevisionId': 'rev_in_sync',
                  },
                  {
                    'id': 'file_remote_disc',
                    'name': fileRemoteName,
                    'headRevisionId': 'rev_remote',
                  },
                ]
              }),
              200,
              headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
            );
          }

          if (options.queryParameters['q']?.contains("name='$fileRemoteName'") == true) {
            return ResponseBody.fromString(
              jsonEncode({
                'files': [
                  {
                    'id': 'file_remote_disc',
                    'name': fileRemoteName,
                    'headRevisionId': 'rev_remote',
                  }
                ]
              }),
              200,
              headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
            );
          }
        }

        if (options.path.contains('/files/file_remote_disc') && options.queryParameters['alt'] == 'media') {
          return ResponseBody.fromString(
            jsonEncode(remoteRec.toJson()),
            200,
            headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
          );
        }

        return ResponseBody.fromString('{}', 200);
      };

      final result = await syncEngine.syncAll();
      expect(result.ok, isTrue);
      expect(result.skipped, 1); // urlInSync was skipped
      expect(result.reconciled, 1); // urlRemote was discovered & reconciled

      final remoteLocal = await db.videoPages.getPage(urlHash(urlRemote));
      expect(remoteLocal?.title, 'Remote Discovered');
    });

    test('syncChanged performs targeted reconciliation for given URLs', () async {
      const url1 = 'https://example.com/target-1';
      const url2 = 'https://example.com/target-2';

      adapter.handler = (options) async {
        if (options.path.endsWith('/files') && options.method == 'GET') {
          if (options.queryParameters['q']?.contains("name='pages'") == true) {
            return ResponseBody.fromString(
              jsonEncode({'files': [{'id': 'folder_pages', 'name': 'pages'}]}),
              200,
              headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
            );
          }
        }
        if (options.path.contains('/upload/drive/v3/files')) {
          return ResponseBody.fromString(
            jsonEncode({'id': 'file_up', 'headRevisionId': 'rev_1'}),
            200,
            headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
          );
        }
        return ResponseBody.fromString(
          jsonEncode({'files': <Map<String, dynamic>>[]}),
          200,
          headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
        );
      };

      final result = await syncEngine.syncChanged([url1, url2]);
      expect(result.ok, isTrue);
      expect(result.reconciled, 2);
      expect(result.skipped, 0);
    });

    test('syncEngine handles CAS 412 retry and succeeds', () async {
      const url = 'https://example.com/cas-retry';
      final fileName = pageFileName(url);
      final hash = urlHash(url);

      const localRec = PageRecord(
        version: 2,
        url: url,
        title: 'Local v1',
        highlights: [PageHighlight(id: 'h1', extras: {'type': 'text', 'content': 'Local edit'})],
        drawings: [],
        videoItems: [],
        diagrams: [],
        tombstones: PageTombstones(),
      );

      await db.videoPages.upsertPage(VideoPageEntity(
        urlHash: hash,
        url: url,
        title: 'Local v1',
        highlightsJson: jsonEncode(localRec.highlights.map((e) => e.toJson()).toList()),
        itemsJson: '[]',
        snapJson: jsonEncode(localRec.toJson()),
        fileId: 'file_cas',
        headRevisionId: 'rev_1',
        updatedAt: 1700000000000,
      ));

      var patchAttempts = 0;
      adapter.handler = (options) async {
        if (options.path.endsWith('/files') && options.method == 'GET') {
          if (options.queryParameters['q']?.contains("name='pages'") == true) {
            return ResponseBody.fromString(
              jsonEncode({'files': [{'id': 'folder_pages', 'name': 'pages'}]}),
              200,
              headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
            );
          }
          if (options.queryParameters['q']?.contains("name='$fileName'") == true) {
            return ResponseBody.fromString(
              jsonEncode({
                'files': [
                  {
                    'id': 'file_cas',
                    'name': fileName,
                    'headRevisionId': patchAttempts == 0 ? 'rev_1' : 'rev_2_fresh',
                  }
                ]
              }),
              200,
              headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
            );
          }
        }

        if (options.path.contains('/files/file_cas') && options.queryParameters['alt'] == 'media') {
          return ResponseBody.fromString(
            jsonEncode(localRec.copyWith(title: 'Remote moved').toJson()),
            200,
            headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
          );
        }

        if (options.method == 'PATCH' && options.path.contains('/files/file_cas')) {
          patchAttempts++;
          if (patchAttempts == 1) {
            // First attempt fails with 412 Precondition Failed
            return ResponseBody.fromString(
              jsonEncode({'error': {'message': 'Precondition Failed'}}),
              412,
              headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
            );
          }

          // Second attempt succeeds with new revision
          return ResponseBody.fromString(
            jsonEncode({
              'id': 'file_cas',
              'name': fileName,
              'headRevisionId': 'rev_3_success',
            }),
            200,
            headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
          );
        }

        return ResponseBody.fromString('{}', 200);
      };

      final meta = await syncEngine.syncPage(url);
      expect(meta.headRevisionId, 'rev_3_success');
      expect(patchAttempts, 2);
    });
  });
}
