# Task 11: State Notifiers & Riverpod Dependency Graph

Status: DONE
Wave: 3
Depends on: task-06-drift-database-storage, task-07-google-drive-sync-engine, task-08-whisper-ffi-local-stt, task-10-theme-tokens-components

## Scope & Owned Files
- `scholiast_flutter/lib/core/providers/core_providers.dart` (Database, TokenStore, DriveClient, Auth, SyncEngine, Stt, AudioRecorder providers)
- `scholiast_flutter/lib/features/home/home_providers.dart` (Recent pages, search, filter)
- `scholiast_flutter/lib/features/reader/reader_state_notifier.dart` (Reader article state, highlight CRUD, active comment thread)
- `scholiast_flutter/lib/features/player/player_state_notifier.dart` (Player state, timeline sync, transcript paragraphs, video notes)
- `scholiast_flutter/lib/features/sync/sync_providers.dart` (Sync status stream, manual trigger, connect/disconnect)
- `scholiast_flutter/test/core/state_notifiers_test.dart`

## Acceptance Criteria
- Clean dependency injection via Riverpod across all domain services.
- Immutable state holders with responsive updates on DB changes.
- Highlight and comment edits trigger local persistence and dirty sync marking.
- Unit tests verify state transitions, highlight mutations, and provider graphs.
- `flutter analyze` reports 0 errors/warnings.
