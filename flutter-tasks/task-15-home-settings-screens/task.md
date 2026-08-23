# Task 15: Home & Settings Screens

Status: DONE
Wave: 4
Depends on: task-06-drift-database-storage, task-07-google-drive-sync-engine, task-11-state-notifiers-riverpod

## Scope & Owned Files
- `scholiast_flutter/lib/features/settings/settings_prefs.dart` — port SettingsPrefs.kt + ReaderPrefs (fontStep/serifDefault/STT engine/speech language/preferred transcriber, cloud keys via SecureTokenStore) with settingsPrefsProvider + mock injection
- `scholiast_flutter/lib/ui/screens/home/home_screen.dart` — search bound to homeSearchQueryProvider, filter chips, recent grid/list cards (favicon, cleaned title, host, count, relative date), tap→Navigator.pushNamed, long-press delete via videoPageDaoProvider.deletePage, responsive 900px breakpoint
- `scholiast_flutter/lib/ui/screens/settings/settings_screen.dart` — Sync (Drive connect/disconnect + Sync now + SyncStatusBar), Speech (STT picker + language/transcriber dropdowns + Whisper manager with progress), Danger zone red styling with injectable TODO callbacks, capped 600dp centered
- `scholiast_flutter/test/ui/home_settings_test.dart` — AppDatabase.inMemory + ProviderScope, filter/search, settings sections, prefs round-trip

## Acceptance Criteria
- `flutter analyze` 0 errors on owned files
- `flutter test test/ui/home_settings_test.dart` 6/6 passing
