import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../audio/audio_recorder_service.dart';
import '../auth/secure_token_store.dart';
import '../database/daos/ocr_text_dao.dart';
import '../database/daos/sync_meta_dao.dart';
import '../database/daos/video_page_dao.dart';
import '../database/database.dart';
import '../stt/stt_service.dart';
import '../sync/drive_auth_service.dart';
import '../sync/frame_store.dart';
import '../sync/google_drive_client.dart';
import '../sync/sync_engine.dart';

// --- Database & DAOs ---

/// Provides the singleton [AppDatabase] instance.
/// Must be overridden in root [ProviderScope] with the opened instance.
final databaseProvider = Provider<AppDatabase>((ref) {
  throw UnimplementedError(
    'databaseProvider must be overridden in ProviderScope with an initialized AppDatabase instance.',
  );
});

/// Provides the [VideoPageDao] for web and video pages.
final videoPageDaoProvider = Provider<VideoPageDao>((ref) {
  final db = ref.watch(databaseProvider);
  return db.videoPages;
});

/// Provides the [SyncMetaDao] for key-value sync metadata.
final syncMetaDaoProvider = Provider<SyncMetaDao>((ref) {
  final db = ref.watch(databaseProvider);
  return db.syncMeta;
});

/// Provides the [OcrTextDao] for cached frame OCR transcripts.
final ocrTextDaoProvider = Provider<OcrTextDao>((ref) {
  final db = ref.watch(databaseProvider);
  return db.ocrTexts;
});

// --- Auth & Token Storage ---

/// Provides the [SecureTokenStore] backed by platform secure storage / keystore.
final tokenStoreProvider = Provider<SecureTokenStore>((ref) {
  return SecureTokenStore();
});

/// Provides the OAuth 2.0 configuration for Google Drive.
final oAuthConfigProvider = Provider<OAuthConfig>((ref) {
  return const OAuthConfig();
});

/// Provides the [DriveAuthService] handling OAuth 2.0 PKCE authentication.
final driveAuthProvider = Provider<DriveAuthService>((ref) {
  final tokenStore = ref.watch(tokenStoreProvider);
  final config = ref.watch(oAuthConfigProvider);
  return DriveAuthService(
    tokenStore: tokenStore,
    config: config,
  );
});

// --- Storage & Sync Engine ---

/// Provides the [FrameStore] instance for video frame JPEG blobs.
final frameStoreProvider = Provider<FrameStore>((ref) {
  return MemoryFrameStore();
});

/// Provides the [GoogleDriveClient] communicating with the `appDataFolder`.
final driveClientProvider = Provider<GoogleDriveClient>((ref) {
  final authService = ref.watch(driveAuthProvider);
  return GoogleDriveClient(authService: authService);
});

/// Provides the [SyncEngine] state machine for reconciling local DB with Google Drive.
final syncEngineProvider = Provider<SyncEngine>((ref) {
  final driveClient = ref.watch(driveClientProvider);
  final videoPageDao = ref.watch(videoPageDaoProvider);
  final syncMetaDao = ref.watch(syncMetaDaoProvider);
  final frameStore = ref.watch(frameStoreProvider);

  final engine = SyncEngine(
    driveClient: driveClient,
    videoPageDao: videoPageDao,
    syncMetaDao: syncMetaDao,
    frameStore: frameStore,
  );

  ref.onDispose(() => engine.dispose());
  return engine;
});

// --- Speech-to-Text & Audio ---

/// Provides the unified [SttService] for local Whisper and Cloud STT inference.
final sttServiceProvider = Provider<SttService>((ref) {
  final tokenStore = ref.watch(tokenStoreProvider);
  final service = SttService(tokenStore: tokenStore);
  ref.onDispose(() => service.dispose());
  return service;
});

/// Provides the [AudioRecorderService] for capturing 16kHz mono WAV recordings.
final audioRecorderServiceProvider = Provider<AudioRecorderService>((ref) {
  final service = AudioRecorderService();
  ref.onDispose(() => service.dispose());
  return service;
});
