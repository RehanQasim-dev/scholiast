import 'package:flutter/foundation.dart';

/// The high-level state of the synchronization engine.
enum SyncState {
  idle,
  syncing,
  error,
  unauthenticated,
}

/// The appdata subfolders in the per-page Google Drive layout.
enum DriveFolder {
  pages('pages'),
  frames('frames'),
  diagrams('diagrams');

  final String path;
  const DriveFolder(this.path);
}

/// Conflict resolution strategy indicator.
enum ConflictResolution {
  useRemote,
  useLocal,
  merge,
  lastWriteWins,
}

/// Progress details for an ongoing sync operation.
@immutable
class SyncProgress {
  final String phase; // e.g. 'discovering', 'page'
  final int done;
  final int total;
  final String? title;
  final String? url;

  const SyncProgress({
    required this.phase,
    required this.done,
    required this.total,
    this.title,
    this.url,
  });

  /// Alias for done for step tracking compatibility.
  int get current => done;
  int get step => done;

  SyncProgress copyWith({
    String? phase,
    int? done,
    int? total,
    String? title,
    String? url,
  }) {
    return SyncProgress(
      phase: phase ?? this.phase,
      done: done ?? this.done,
      total: total ?? this.total,
      title: title ?? this.title,
      url: url ?? this.url,
    );
  }

  factory SyncProgress.fromJson(Map<String, dynamic> json) {
    return SyncProgress(
      phase: json['phase'] as String? ?? 'page',
      done: (json['done'] as num?)?.toInt() ?? (json['current'] as num?)?.toInt() ?? 0,
      total: (json['total'] as num?)?.toInt() ?? 0,
      title: json['title'] as String?,
      url: json['url'] as String?,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'phase': phase,
        'done': done,
        'total': total,
        if (title != null) 'title': title,
        if (url != null) 'url': url,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SyncProgress &&
          runtimeType == other.runtimeType &&
          phase == other.phase &&
          done == other.done &&
          total == other.total &&
          title == other.title &&
          url == other.url;

  @override
  int get hashCode => Object.hash(phase, done, total, title, url);

  @override
  String toString() =>
      'SyncProgress(phase: $phase, done: $done/$total, url: $url, title: $title)';
}

/// Current status of the Google Drive sync engine.
@immutable
class SyncStatus {
  final SyncState state;
  final bool connected;
  final bool syncing;
  final int? lastSyncedAt;
  final String? lastError;
  final SyncProgress? progress;

  const SyncStatus({
    this.state = SyncState.idle,
    this.connected = false,
    this.syncing = false,
    this.lastSyncedAt,
    this.lastError,
    this.progress,
  });

  factory SyncStatus.idle({
    bool connected = true,
    int? lastSyncedAt,
  }) {
    return SyncStatus(
      state: connected ? SyncState.idle : SyncState.unauthenticated,
      connected: connected,
      syncing: false,
      lastSyncedAt: lastSyncedAt,
    );
  }

  factory SyncStatus.syncing({
    bool connected = true,
    int? lastSyncedAt,
    SyncProgress? progress,
  }) {
    return SyncStatus(
      state: SyncState.syncing,
      connected: connected,
      syncing: true,
      lastSyncedAt: lastSyncedAt,
      progress: progress,
    );
  }

  factory SyncStatus.error({
    required String error,
    bool connected = true,
    int? lastSyncedAt,
  }) {
    return SyncStatus(
      state: SyncState.error,
      connected: connected,
      syncing: false,
      lastSyncedAt: lastSyncedAt,
      lastError: error,
    );
  }

  factory SyncStatus.unauthenticated() {
    return const SyncStatus(
      state: SyncState.unauthenticated,
      connected: false,
      syncing: false,
    );
  }

  SyncStatus copyWith({
    SyncState? state,
    bool? connected,
    bool? syncing,
    int? lastSyncedAt,
    String? lastError,
    SyncProgress? progress,
  }) {
    return SyncStatus(
      state: state ?? this.state,
      connected: connected ?? this.connected,
      syncing: syncing ?? this.syncing,
      lastSyncedAt: lastSyncedAt ?? this.lastSyncedAt,
      lastError: lastError ?? this.lastError,
      progress: progress ?? this.progress,
    );
  }

  factory SyncStatus.fromJson(Map<String, dynamic> json) {
    final stateStr = json['state'] as String?;
    final state = SyncState.values.firstWhere(
      (e) => e.name == stateStr,
      orElse: () => SyncState.idle,
    );
    return SyncStatus(
      state: state,
      connected: json['connected'] as bool? ?? false,
      syncing: json['syncing'] as bool? ?? false,
      lastSyncedAt: (json['lastSyncedAt'] as num?)?.toInt(),
      lastError: json['lastError'] as String?,
      progress: json['progress'] != null
          ? SyncProgress.fromJson(json['progress'] as Map<String, dynamic>)
          : null,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'state': state.name,
        'connected': connected,
        'syncing': syncing,
        if (lastSyncedAt != null) 'lastSyncedAt': lastSyncedAt,
        if (lastError != null) 'lastError': lastError,
        if (progress != null) 'progress': progress!.toJson(),
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SyncStatus &&
          runtimeType == other.runtimeType &&
          state == other.state &&
          connected == other.connected &&
          syncing == other.syncing &&
          lastSyncedAt == other.lastSyncedAt &&
          lastError == other.lastError &&
          progress == other.progress;

  @override
  int get hashCode => Object.hash(
        state,
        connected,
        syncing,
        lastSyncedAt,
        lastError,
        progress,
      );

  @override
  String toString() =>
      'SyncStatus(state: $state, connected: $connected, syncing: $syncing, lastSyncedAt: $lastSyncedAt, lastError: $lastError)';
}

/// Metadata describing a file in Google Drive's `appDataFolder`.
@immutable
class DriveFileInfo {
  final String fileId;
  final String? name;
  final String? headRevisionId;
  final String? modifiedTime;
  final int? size;

  const DriveFileInfo({
    required this.fileId,
    this.name,
    this.headRevisionId,
    this.modifiedTime,
    this.size,
  });

  /// Alias for fileId.
  String get id => fileId;

  factory DriveFileInfo.fromJson(Map<String, dynamic> json) {
    return DriveFileInfo(
      fileId: (json['fileId'] ?? json['id']) as String? ?? '',
      name: json['name'] as String?,
      headRevisionId: json['headRevisionId'] as String?,
      modifiedTime: json['modifiedTime'] as String?,
      size: (json['size'] as num?)?.toInt() ??
          (json['size'] != null ? int.tryParse(json['size'].toString()) : null),
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': fileId,
        'fileId': fileId,
        if (name != null) 'name': name,
        if (headRevisionId != null) 'headRevisionId': headRevisionId,
        if (modifiedTime != null) 'modifiedTime': modifiedTime,
        if (size != null) 'size': size,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is DriveFileInfo &&
          runtimeType == other.runtimeType &&
          fileId == other.fileId &&
          name == other.name &&
          headRevisionId == other.headRevisionId &&
          modifiedTime == other.modifiedTime &&
          size == other.size;

  @override
  int get hashCode => Object.hash(fileId, name, headRevisionId, modifiedTime, size);

  @override
  String toString() =>
      'DriveFileInfo(id: $fileId, name: $name, headRevisionId: $headRevisionId)';
}

/// Paginated listing of Drive files.
@immutable
class DriveFilePage {
  final List<DriveFileInfo> files;
  final String? nextPageToken;

  const DriveFilePage({
    required this.files,
    this.nextPageToken,
  });

  factory DriveFilePage.fromJson(Map<String, dynamic> json) {
    final list = json['files'] as List<dynamic>? ?? const [];
    return DriveFilePage(
      files: list
          .map((e) => DriveFileInfo.fromJson(e as Map<String, dynamic>))
          .toList(),
      nextPageToken: json['nextPageToken'] as String?,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'files': files.map((e) => e.toJson()).toList(),
        if (nextPageToken != null) 'nextPageToken': nextPageToken,
      };
}

/// Result summary of a sync cycle across multiple pages.
@immutable
class SyncResult {
  final int reconciled;
  final int skipped;
  final List<String> errors;

  const SyncResult({
    required this.reconciled,
    required this.skipped,
    this.errors = const [],
  });

  bool get ok => errors.isEmpty;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SyncResult &&
          runtimeType == other.runtimeType &&
          reconciled == other.reconciled &&
          skipped == other.skipped &&
          listEquals(errors, other.errors);

  @override
  int get hashCode => Object.hash(reconciled, skipped, Object.hashAll(errors));

  @override
  String toString() =>
      'SyncResult(reconciled: $reconciled, skipped: $skipped, errors: ${errors.length})';
}

// --- Sync & Auth Exceptions --------------------------------------------------

/// Thrown when a CAS update (If-Match headRevisionId) was rejected (HTTP 412).
class SyncConflictException implements Exception {
  final String message;
  final String? fileId;
  final String? currentRevision;

  const SyncConflictException(this.message, {this.fileId, this.currentRevision});

  @override
  String toString() => 'SyncConflictException: $message';
}

/// Thrown when a single page fails to reconcile after max retry attempts.
class PageSyncException implements Exception {
  final String pageUrl;
  final String message;

  const PageSyncException(this.pageUrl, this.message);

  @override
  String toString() => 'PageSyncException($pageUrl): $message';
}

/// Base exception for Google Drive OAuth errors.
sealed class OAuthException implements Exception {
  final String message;
  final Object? cause;

  const OAuthException(this.message, [this.cause]);

  bool get invalidGrant => false;

  @override
  String toString() => 'OAuthException: $message${cause != null ? ' ($cause)' : ''}';
}

class OAuthNotConfiguredException extends OAuthException {
  const OAuthNotConfiguredException([Object? cause])
      : super('Google Drive OAuth is not configured with valid client credentials', cause);
}

class OAuthNotConnectedException extends OAuthException {
  const OAuthNotConnectedException([Object? cause])
      : super('Google Drive is not connected', cause);
}

class OAuthUserDeniedException extends OAuthException {
  const OAuthUserDeniedException([Object? cause])
      : super('OAuth consent was denied by the user', cause);
}

class OAuthStateMismatchException extends OAuthException {
  const OAuthStateMismatchException([Object? cause])
      : super('OAuth state did not match the pending authorization request', cause);
}

class OAuthNoCodeException extends OAuthException {
  const OAuthNoCodeException([Object? cause])
      : super('OAuth redirect did not contain an authorization code', cause);
}

class OAuthTokenRequestFailedException extends OAuthException {
  final String? error;
  final String? errorDescription;
  @override
  final bool invalidGrant;

  const OAuthTokenRequestFailedException({
    this.error,
    this.errorDescription,
    this.invalidGrant = false,
    Object? cause,
  }) : super(
          'OAuth token request failed'
          '${error != null ? ' ($error)' : ''}'
          '${errorDescription != null ? ': $errorDescription' : ''}',
          cause,
        );
}

class OAuthNetworkException extends OAuthException {
  const OAuthNetworkException([Object? cause])
      : super('OAuth network communication failed', cause);
}

class OAuthTimeoutException extends OAuthException {
  const OAuthTimeoutException([Object? cause])
      : super('Timed out waiting for OAuth authorization redirect', cause);
}
