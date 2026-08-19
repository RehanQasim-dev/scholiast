# 19-settings-window — Agent log

Log entries appended while working on this task (see README.md, "Agent logging protocol").


## 2026-08-20 — Orchestrator finalization (full implementation)
- `SettingsPrefs.kt`: DataStore-backed `AppSettings` (implements Task 10's `SpeechSettings` + Gemma OCR model + playback/appearance + setters; secrets via Task 16's `KeystoreKeyProvider.unlockForApp`); in-memory cache, write-through setters, `load()` at start. Defaults: `whisper-large-v3-turbo` / `gemini-3.6-flash` / `gemma-4-31b-it`, add/edit prompts from §5.5.6, LOCAL transcriber, 15 s seek, 1.0× speed, dynamic theme.
- `SettingsViewModel.kt`: speech keys (masked set/clear), model IDs, prompts, language, transcriber picker, seek step, speed, dynamic-theme; Drive connect via Task 16's `DriveOAuth.beginAuth → CustomTabAuth.launch → awaitRedirect → complete` + disconnect + **Sync now** via Task 18's `SyncScheduler.enqueueSyncNow`; live `SyncStatusRepository` collection; local STT model download (Task 11 `ModelDownloader` with typed result mapping incl. 404/checksum) + delete + installed list; typed-confirm wipes (`deleteAll` DAOs + `FrameStore.clearAll` + `ModelStore.deleteAll`; Drive wipe via `OkHttpDriveApi.wipeAppData` + status reset). Factory built from `SyncGraph.repository` + `SettingsPrefs`.
- `SettingsScreen.kt`: full grouped Material 3 list (Speech keys, Transcriber picker, language, local STT model section with download/delete, Drive section with SyncStatusBar states + connect/sync-now, Data section with two-step confirm wipes, About/version). Separate route only — player untouched. Removed unused imports; `menuAnchor()` deprecation warning left (M3 API).
- `SettingsViewModelTest.kt`: 4 tests over the in-memory `FakeAppSettings` (round-trip, defaults, setters, key mapping).
- Hand-off hooks exercised: `OAuthRedirectActivity` + `scholiast://oauth2redirect` intent filter added to the manifest; OAuth client values injected into BuildConfig from `../oauth.local.json`.
- Status: DONE. Full suite: 22 suites, 402 tests, 0 failures; `assembleDebug` green.
