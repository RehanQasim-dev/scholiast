# Task 07: Google Drive Sync Engine

Status: DONE
Wave: 2
Depends on: task-04-merge-engine-golden-tests, task-06-drift-database-storage

## Scope & Owned Files
- `scholiast_flutter/lib/core/sync/google_drive_client.dart` (Drive REST API client via `dio`)
- `scholiast_flutter/lib/core/sync/drive_auth_service.dart` (OAuth 2.0 PKCE flow with loopback on Linux, app auth on Android)
- `scholiast_flutter/lib/core/sync/sync_engine.dart` (Sync state machine, push/pull, 3-way merge, CAS retry)
- `scholiast_flutter/lib/core/sync/sync_models.dart` (SyncStatus, SyncProgress, ConflictAction)
- `scholiast_flutter/test/core/sync_engine_test.dart`

## Acceptance Criteria
- Drive REST client handles files query, metadata, upload (multipart), download, delete in `appDataFolder`.
- PKCE auth service generates challenge/verifier and refreshes tokens via `SecureTokenStore`.
- `SyncEngine` accurately orchestrates single-page 3-way merge and full-sync cycle.
- Unit tests pass with mock Dio client (mocktail).
- `flutter analyze` reports 0 errors and 0 warnings.
