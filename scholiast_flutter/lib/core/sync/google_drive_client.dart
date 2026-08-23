import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'drive_auth_service.dart';
import 'sync_models.dart';

/// Google Drive REST client interacting with the hidden `appDataFolder`.
///
/// Handles folder caching, single-page JSON uploads/downloads, binary frame/diagram
/// blob transfers, and Compare-And-Swap (CAS) revision updates.
class GoogleDriveClient {
  final Dio dio;
  final DriveAuthService? authService;
  final Future<String> Function({bool interactive})? tokenProvider;
  final Future<void> Function()? onUnauthorized;

  static const String driveFilesUrl =
      'https://www.googleapis.com/drive/v3/files';
  static const String driveUploadUrl =
      'https://www.googleapis.com/upload/drive/v3/files';
  static const String folderMime = 'application/vnd.google-apps.folder';

  final Map<DriveFolder, String> _folderIdCache = {};

  GoogleDriveClient({
    Dio? dio,
    this.authService,
    this.tokenProvider,
    this.onUnauthorized,
  }) : dio = dio ?? Dio();

  /// Clears the cached Drive folder IDs.
  void clearFolderCache() {
    _folderIdCache.clear();
  }

  // --- Auth Token & HTTP Execution -------------------------------------------

  Future<String> _getToken({bool interactive = false}) async {
    if (tokenProvider != null) {
      return await tokenProvider!(interactive: interactive);
    }
    if (authService != null) {
      return await authService!.getAccessToken(interactive: interactive);
    }
    throw const OAuthNotConnectedException('No auth provider configured');
  }

  Future<void> _handleUnauthorized() async {
    if (onUnauthorized != null) {
      await onUnauthorized!();
    } else if (authService != null) {
      await authService!.invalidateAccessToken();
    }
  }

  Future<Response<T>> _request<T>(
    String path, {
    required String method,
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
    bool interactive = false,
  }) async {
    final opts = options ?? Options();
    opts.method = method;
    opts.headers = Map<String, dynamic>.from(opts.headers ?? {});

    var token = await _getToken(interactive: interactive);
    opts.headers!['Authorization'] = 'Bearer $token';

    try {
      return await dio.request<T>(
        path,
        data: data,
        queryParameters: queryParameters,
        options: opts,
      );
    } on DioException catch (e) {
      if (e.response?.statusCode == 401) {
        // Token rejected: invalidate and retry once with fresh token
        await _handleUnauthorized();
        token = await _getToken(interactive: interactive);
        opts.headers!['Authorization'] = 'Bearer $token';

        try {
          return await dio.request<T>(
            path,
            data: data,
            queryParameters: queryParameters,
            options: opts,
          );
        } on DioException catch (retryErr) {
          if (retryErr.response?.statusCode == 412) {
            throw const SyncConflictException('CAS conflict: revision mismatch (412)');
          }
          rethrow;
        }
      }

      if (e.response?.statusCode == 412) {
        throw const SyncConflictException('CAS conflict: revision mismatch (412)');
      }
      rethrow;
    }
  }

  // --- Folder Management -----------------------------------------------------

  /// Resolves the Drive file ID for a subfolder under `appDataFolder`, creating it if needed.
  Future<String> ensureFolder(DriveFolder folder, {bool interactive = false}) async {
    final cached = _folderIdCache[folder];
    if (cached != null) return cached;

    // Look for existing folder
    final queryParams = {
      'spaces': 'appDataFolder',
      'q': "name='${folder.path}' and mimeType='$folderMime' and trashed=false",
      'fields': 'files(id,name)',
      'pageSize': 1,
    };

    final res = await _request<Map<String, dynamic>>(
      driveFilesUrl,
      method: 'GET',
      queryParameters: queryParams,
      interactive: interactive,
    );

    final files = (res.data?['files'] as List<dynamic>?) ?? [];
    if (files.isNotEmpty) {
      final id = (files.first as Map<String, dynamic>)['id'] as String;
      _folderIdCache[folder] = id;
      return id;
    }

    // Create the folder
    final createRes = await _request<Map<String, dynamic>>(
      '$driveFilesUrl?fields=id',
      method: 'POST',
      data: {
        'name': folder.path,
        'mimeType': folderMime,
        'parents': ['appDataFolder'],
      },
      options: Options(contentType: 'application/json'),
      interactive: interactive,
    );

    final newId = createRes.data!['id'] as String;
    _folderIdCache[folder] = newId;
    return newId;
  }

  // --- File Queries & Listings -----------------------------------------------

  /// Lists files in a specific [folder], with pagination support.
  Future<DriveFilePage> listFolder(
    DriveFolder folder, {
    String? pageToken,
    int pageSize = 1000,
    bool interactive = false,
  }) async {
    final parentId = await ensureFolder(folder, interactive: interactive);
    final queryParams = <String, dynamic>{
      'spaces': 'appDataFolder',
      'q': "'$parentId' in parents and trashed=false",
      'fields': 'nextPageToken,files(id,name,modifiedTime,headRevisionId,size)',
      'pageSize': pageSize,
      if (pageToken != null) 'pageToken': pageToken,
    };

    final res = await _request<Map<String, dynamic>>(
      driveFilesUrl,
      method: 'GET',
      queryParameters: queryParams,
      interactive: interactive,
    );

    return DriveFilePage.fromJson(res.data ?? {});
  }

  /// Lists files across `appDataFolder` or within an optional [folder].
  Future<DriveFilePage> listFiles({
    DriveFolder? folder,
    String? pageToken,
    int pageSize = 1000,
    bool interactive = false,
  }) async {
    if (folder != null) {
      return listFolder(
        folder,
        pageToken: pageToken,
        pageSize: pageSize,
        interactive: interactive,
      );
    }

    final queryParams = <String, dynamic>{
      'spaces': 'appDataFolder',
      'q': "'appDataFolder' in parents and trashed=false",
      'fields': 'nextPageToken,files(id,name,modifiedTime,headRevisionId,size)',
      'pageSize': pageSize,
      if (pageToken != null) 'pageToken': pageToken,
    };

    final res = await _request<Map<String, dynamic>>(
      driveFilesUrl,
      method: 'GET',
      queryParameters: queryParams,
      interactive: interactive,
    );

    return DriveFilePage.fromJson(res.data ?? {});
  }

  /// Finds a single file by exact name inside [folder].
  Future<DriveFileInfo?> findInFolder(
    DriveFolder folder,
    String name, {
    bool interactive = false,
  }) async {
    final parentId = await ensureFolder(folder, interactive: interactive);
    final queryParams = <String, dynamic>{
      'spaces': 'appDataFolder',
      'q': "'$parentId' in parents and name='$name' and trashed=false",
      'fields': 'files(id,name,modifiedTime,headRevisionId,size)',
      'pageSize': 1,
    };

    final res = await _request<Map<String, dynamic>>(
      driveFilesUrl,
      method: 'GET',
      queryParameters: queryParams,
      interactive: interactive,
    );

    final files = (res.data?['files'] as List<dynamic>?) ?? [];
    if (files.isEmpty) return null;
    return DriveFileInfo.fromJson(files.first as Map<String, dynamic>);
  }

  // --- JSON File Operations --------------------------------------------------

  /// Downloads the text content of a JSON file by its [fileId].
  Future<String> getFileJson(String fileId, {bool interactive = false}) async {
    final res = await _request<dynamic>(
      '$driveFilesUrl/$fileId',
      method: 'GET',
      queryParameters: {'alt': 'media'},
      options: Options(responseType: ResponseType.plain),
      interactive: interactive,
    );
    return res.data?.toString() ?? '';
  }

  /// Alias for [getFileJson].
  Future<String> downloadText(String fileId, {bool interactive = false}) =>
      getFileJson(fileId, interactive: interactive);

  /// Uploads or updates a JSON text file in [folder].
  ///
  /// When [existingFileId] is null, performs a multipart creation.
  /// When [existingFileId] is provided, performs a CAS update with [headRevisionId].
  Future<DriveFileInfo> uploadFileJson({
    required String name,
    required String jsonContent,
    String? existingFileId,
    String? headRevisionId,
    DriveFolder folder = DriveFolder.pages,
    bool interactive = false,
  }) async {
    if (existingFileId == null) {
      // Multipart creation
      final parentId = await ensureFolder(folder, interactive: interactive);
      final boundary =
          '-------scholiasttext${DateTime.now().millisecondsSinceEpoch}';
      final metadataJson = jsonEncode({'name': name, 'parents': [parentId]});

      final bodyBytes = <int>[
        ...utf8.encode(
            '--$boundary\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n$metadataJson\r\n'),
        ...utf8.encode(
            '--$boundary\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n$jsonContent\r\n'),
        ...utf8.encode('--$boundary--'),
      ];

      final res = await _request<Map<String, dynamic>>(
        driveUploadUrl,
        method: 'POST',
        data: Uint8List.fromList(bodyBytes),
        queryParameters: {
          'uploadType': 'multipart',
          'fields': 'id,name,modifiedTime,headRevisionId,size',
        },
        options: Options(
          contentType: 'multipart/related; boundary=$boundary',
        ),
        interactive: interactive,
      );

      return DriveFileInfo.fromJson(res.data ?? {});
    } else {
      // Update with CAS revision check
      final headers = <String, dynamic>{
        'Content-Type': 'application/json; charset=UTF-8',
        if (headRevisionId != null && headRevisionId.isNotEmpty)
          'If-Match': headRevisionId,
      };

      final res = await _request<Map<String, dynamic>>(
        '$driveUploadUrl/$existingFileId',
        method: 'PATCH',
        data: jsonContent,
        queryParameters: {
          'uploadType': 'media',
          'fields': 'id,name,modifiedTime,headRevisionId,size',
        },
        options: Options(headers: headers),
        interactive: interactive,
      );

      return DriveFileInfo.fromJson(res.data ?? {});
    }
  }

  // --- Binary Blob Operations ------------------------------------------------

  /// Downloads binary data for a frame or diagram blob by its [fileId].
  Future<Uint8List> downloadBlob(String fileId, {bool interactive = false}) async {
    final res = await _request<List<int>>(
      '$driveFilesUrl/$fileId',
      method: 'GET',
      queryParameters: {'alt': 'media'},
      options: Options(responseType: ResponseType.bytes),
      interactive: interactive,
    );
    final data = res.data ?? <int>[];
    return data is Uint8List ? data : Uint8List.fromList(data);
  }

  /// Uploads a binary blob (JPEG frame or PNG diagram) to [folder].
  Future<DriveFileInfo> uploadBlob({
    required String name,
    required List<int> bytes,
    String mimeType = 'image/jpeg',
    DriveFolder folder = DriveFolder.frames,
    bool interactive = false,
  }) async {
    final parentId = await ensureFolder(folder, interactive: interactive);
    final boundary =
        '-------scholiastblob${DateTime.now().millisecondsSinceEpoch}';
    final metadataJson = jsonEncode({'name': name, 'parents': [parentId]});

    final bodyBytes = <int>[
      ...utf8.encode(
          '--$boundary\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n$metadataJson\r\n'),
      ...utf8.encode('--$boundary\r\nContent-Type: $mimeType\r\n\r\n'),
      ...bytes,
      ...utf8.encode('\r\n--$boundary--'),
    ];

    final res = await _request<Map<String, dynamic>>(
      driveUploadUrl,
      method: 'POST',
      data: Uint8List.fromList(bodyBytes),
      queryParameters: {
        'uploadType': 'multipart',
        'fields': 'id,name,modifiedTime,headRevisionId,size',
      },
      options: Options(
        contentType: 'multipart/related; boundary=$boundary',
      ),
      interactive: interactive,
    );

    return DriveFileInfo.fromJson(res.data ?? {});
  }

  /// Updates an existing binary blob's content.
  Future<DriveFileInfo> updateBlob({
    required String fileId,
    required List<int> bytes,
    String mimeType = 'image/png',
    bool interactive = false,
  }) async {
    final res = await _request<Map<String, dynamic>>(
      '$driveUploadUrl/$fileId',
      method: 'PATCH',
      data: Uint8List.fromList(bytes),
      queryParameters: {
        'uploadType': 'media',
        'fields': 'id,name,modifiedTime,headRevisionId,size',
      },
      options: Options(contentType: mimeType),
      interactive: interactive,
    );

    return DriveFileInfo.fromJson(res.data ?? {});
  }

  /// Deletes a file by its [fileId].
  Future<void> deleteFile(String fileId, {bool interactive = false}) async {
    await _request<void>(
      '$driveFilesUrl/$fileId',
      method: 'DELETE',
      interactive: interactive,
    );
  }

  /// Deletes all files and folders in `appDataFolder`, returning the count of deleted items.
  Future<int> wipeAppData({bool interactive = false}) async {
    var count = 0;
    String? pageToken;

    do {
      final queryParams = <String, dynamic>{
        'spaces': 'appDataFolder',
        'q': "'appDataFolder' in parents and trashed=false",
        'fields': 'nextPageToken,files(id)',
        'pageSize': 1000,
        if (pageToken != null) 'pageToken': pageToken,
      };

      final res = await _request<Map<String, dynamic>>(
        driveFilesUrl,
        method: 'GET',
        queryParameters: queryParams,
        interactive: interactive,
      );

      final data = res.data ?? {};
      final files = (data['files'] as List<dynamic>?) ?? [];
      for (final f in files) {
        final id = (f as Map<String, dynamic>)['id'] as String?;
        if (id != null) {
          try {
            await deleteFile(id, interactive: interactive);
            count++;
          } catch (_) {
            // Best effort
          }
        }
      }

      pageToken = data['nextPageToken'] as String?;
    } while (pageToken != null && pageToken.isNotEmpty);

    clearFolderCache();
    return count;
  }
}
