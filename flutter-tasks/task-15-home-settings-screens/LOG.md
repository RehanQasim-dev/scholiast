# Task 15 Work Log

## [2026-08-22 23:30] Task 15 Agent — Home + Settings Screens
- **What I learned:**
  - Android SettingsPrefs.kt uses DataStore + Keystore split (non-secrets vs api keys); Flutter maps to SharedPreferences + SecureTokenStore.
  - ReaderPrefs.kt holds fontStep 0..4 + serif; spec requires porting these into SettingsPrefs alongside STT prefs.
  - HomeScreen.kt builds adaptive grid via GridCells.Adaptive(340.dp) and combinedClickable long-press for janitor removal; Flutter needs 900px breakpoint + confirm dialog + videoPageDao.deletePage.
  - SyncStatusBar vs SyncStatusCard distinction; spec explicitly requires SyncStatusBar consuming syncControllerProvider/syncStatusStreamProvider.
  - WhisperModelManager.getAvailableModels uses path_provider in production but needs customDirectoryPath injection for tests.
  - Material(shape + borderRadius) assertion fails if both supplied; must use shape only.
  - ListView lazily builds off-screen children — Settings test needed SingleChildScrollView+Column so all sections in tree.
- **Decisions made:**
  - Extended SettingsPrefs to include fontStep (clamped 0..4, default 1) + serifDefault + existing STT fields; added SecureTokenStore delegation helpers and kept FutureProvider with SharedPreferences.setMockInitialValues injection for tests.
  - Rewrote HomeScreen as ConsumerWidget with search bound to homeSearchQueryProvider via onChanged, filter chips via homeFilterProvider, responsive LayoutBuilder 900px grid vs List, VideoCard/ArticleRow with favicon fallback, cleaned title, host + count + relative date, tap via Navigator.pushNamed(/reader?url=, /player?url=) with onOpenPage fallback, long-press delete via videoPageDaoProvider.deletePage + confirm dialog + snackbar.
  - Updated SettingsScreen Sync section to include SyncStatusBar (plus SyncStatusCard), Speech section to use DropdownMenu for both transcriber + language, Whisper section to stream download progress via downloadModelStream + LinearProgressIndicator, Danger zone to keep destructive red styling with injectable onWipeLocalOverride/onWipeDriveOverride TODO callbacks and capped 600dp Center+SingleChildScrollView layout.
  - Fixed VideoCard Material shape conflict (removed borderRadius).
  - Changed SettingsScreen ListView to SingleChildScrollView+Column for test determinism.
- **Open questions:**
  - Drive wipe full sync-engine path still delegates to GoogleDriveClient.wipeAppData (TODO comment); final wiring pending Task 16/17 integration.
  - Other Wave-4 tasks (frame, player, reader) still have analyzer errors — ignored as out-of-scope, verified own files clean.
- **Progress:**
  - lib/features/settings/settings_prefs.dart — ported and extended, provider + mock injection verified.
  - lib/ui/screens/home/home_screen.dart — responsive grid, search/filter, cards, nav, delete dialog implemented.
  - lib/ui/screens/settings/settings_screen.dart — Sync/Speech/Whisper/Danger zone per spec, 600dp cap, sync bar wired.
  - test/ui/home_settings_test.dart — 6/6 passing (prefs round-trip, filter chip, search binding, cleanTitle, settings sections with AppDatabase.inMemory + ProviderScope).
  - flutter analyze: own files 0 errors (project has 60+ errors from other incomplete Wave-4 tasks).
