import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers/core_providers.dart';
import '../../core/sync/drive_auth_service.dart';
import '../../core/sync/sync_engine.dart';
import '../../core/sync/sync_models.dart';

// ---------------------------------------------------------------------------
// Status stream
// ---------------------------------------------------------------------------

/// Provides a broadcast stream of [SyncStatus] from the [SyncEngine].
///
/// Seeded with the engine's current status so the UI never starts blank.
final syncStatusStreamProvider = StreamProvider<SyncStatus>((ref) {
  final engine = ref.watch(syncEngineProvider);

  final current = engine.currentStatus;
  final upstream = engine.statusStream;

  return Stream<SyncStatus>.multi((controller) {
    controller.add(current);
    final sub = upstream.listen(
      controller.add,
      onError: controller.addError,
      onDone: controller.close,
    );
    controller.onCancel = sub.cancel;
  });
});

// ---------------------------------------------------------------------------
// Sync controller
// ---------------------------------------------------------------------------

/// Wraps sync lifecycle actions: connect, disconnect, and manual sync-now.
class SyncController extends StateNotifier<SyncStatus> {
  final SyncEngine _engine;
  final DriveAuthService _auth;

  SyncController({
    required SyncEngine engine,
    required DriveAuthService auth,
  })  : _engine = engine,
        _auth = auth,
        super(engine.currentStatus) {
    // Mirror the engine's status stream into Riverpod state.
    _engine.statusStream.listen((s) {
      if (mounted) state = s;
    });
  }

  /// Triggers a full sync of all locally changed pages.
  Future<SyncResult> syncNow() => _engine.syncAll(interactive: true);

  /// Initiates the OAuth 2.0 PKCE loopback flow to connect Google Drive.
  ///
  /// Returns [true] if the user successfully granted access.
  ///
  /// In a real UI, [PendingAuth.authUrl] should be opened in a browser /
  /// custom tab before [waitForLoopbackCallback] is awaited.
  Future<bool> connectDrive() async {
    try {
      final session = await _auth.startLoopbackSession();
      // ignore result: caller opens authUrl in browser
      await _auth.beginAuth(redirectUri: session.redirectUri);
      final tokens = await _auth.waitForLoopbackCallback(session);
      return tokens.accessToken.isNotEmpty;
    } catch (_) {
      return false;
    }
  }

  /// Revokes the Drive token and disconnects the account.
  Future<void> disconnectDrive() async {
    await _auth.disconnect();
  }

  /// Whether the user currently has a valid Drive connection.
  Future<bool> get isConnected => _auth.isConnected();
}

/// Provides the [SyncController].
final syncControllerProvider =
    StateNotifierProvider<SyncController, SyncStatus>((ref) {
  final engine = ref.watch(syncEngineProvider);
  final auth = ref.watch(driveAuthProvider);

  final controller = SyncController(engine: engine, auth: auth);
  ref.onDispose(controller.dispose);
  return controller;
});
