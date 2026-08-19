# 18-sync-worker-status — Agent log

Log entries appended while working on this task (see README.md, "Agent logging protocol").

## [2026-08-19 21:30] task-18 agent (deepseek-v4-flash-free)
- **What I learned:**
  - Task 17 has NOT landed: `domain/sync/` does not exist yet. I must define the `SyncEngine` interface the worker consumes; Task 17 implements it later (hand-off below).
  - Task 04 landed and pre-built the seam for me: `ui/home/HomeViewModel.kt` defines `SyncStatusHolder { status: StateFlow<ui.home.SyncStatus>; set() }` + `SyncStatus` sealed interface (Disconnected/Syncing/Synced(lastSyncedAt)/Error(message)) and defaults to `InMemorySyncStatusHolder()`. HomeScreen renders its own private chip. I must NOT edit `ui/home/*` (Task 04 owns it) — I provide a repository-backed `SyncStatusHolder` impl + a richer chip composable and log the one-line factory swap.
  - Task 02's `SyncMetaDao` (put/get/getAll/delete on `SyncMetaEntity` key-value rows) exists and is the intended home for the persisted `sync_status` record (entity doc explicitly says "sync status" belongs here).
  - Desktop reference: `sync-engine.ts` writes `sync_status` = `{connected, lastSyncedAt, lastError, syncing, progress:{phase:'discovering'|'page', done, total, title?, url?}}`; progress writes rate-limited at 400 ms with force on first page (`done === 0`) and terminal states; `sync-settings.ts` hides the progress card when idle, reds it on failure, sweeps indeterminate during discovery (or total==0), shows `done+1 / total` + page label (title else hostname+path).
  - WorkManager 2.10.1 already in `libs.versions.toml` + build.gradle.kts; no `work-testing`/`coroutines-test` deps → worker/scheduler JVM tests must avoid the WorkManager runtime; test the pure seams (state machine, rate limiter, dedupe predicate, `runSync` orchestration) instead.
- **Decisions made:**
  - Files per task.md: `domain/sync/{SyncEngine.kt, SyncStatusRepository.kt, SyncScheduler.kt, SyncWorker.kt}`, `ui/sync/SyncStatusBar.kt`, `ui/sync/RepositorySyncStatusHolder.kt` (bridge), test `domain/sync/SyncSchedulerTest.kt`. (Orchestrator's alternate names SyncStatusStore/Card/… folded into these per "or per task.md".)
  - `SyncStatus` model: `{state: IDLE|CONNECTING|DISCOVERING|SYNCING|ERROR|OFFLINE, connected, lastSyncedAt, lastError, progress:{phase, done, total, title, url}}` — serializable into Room `sync_meta` key `sync_status` (matches desktop STATUS_KEY).
  - Rate limiting: StateFlow updates per page (live chip), persistence rate-limited (default 2 s; force on run start, `done==0`, terminal states, user actions). Terminal states always persist.
  - `load()` demotes transient states (CONNECTING/DISCOVERING/SYNCING) to IDLE after process death so the UI never shows a stuck "Syncing…"; ERROR/OFFLINE/lastSyncedAt survive.
  - Offline + generic failures both map to `Result.retry()` (exponential backoff + CONNECTED constraint = the offline reschedule); desktop also retries everything on the next alarm. Success is a no-op when `engine.connected == false` (desktop: `if (!isConfigured()) return`).
  - `SyncGraph` singleton object (no DI framework in app) with overridable `engineFactory`/`repositoryFactory` — Task 17/integration swaps the engine; repository is cached so worker and UI share one StateFlow.
  - WorkManager's 15-min periodic minimum: periodic interval = 15 min exactly (noted per task.md agent note).
- **Open questions / hand-offs:**
  - TASK 17: implement `SyncEngine { val connected; suspend fun fullReconcile(onProgress: suspend (SyncProgress)->Unit) }`; throw `SyncOfflineException` (an IOException) on network failure; call `onProgress(SyncProgress(DISCOVERING,0,0))` then per-page `SyncProgress(PAGE, done, total, title, url)`; wire `SyncGraph.engineFactory` (default throws).
  - TASK 04 / integration: in `HomeViewModel.factory` swap `InMemorySyncStatusHolder()` for `RepositorySyncStatusHolder(SyncGraph.repository(app), appScope)` (one line); `SyncStatusHolder.set()` becomes a no-op bridge (worker owns writes). `updateSyncStatus()` in HomeViewModel can be deleted then.
  - TASK 19: embed `SyncStatusCard(status)` in the Settings Sync section + a "Sync now" button calling `SyncScheduler.enqueueSyncNow(context)`; card hides itself when idle, red on failure.
  - Integration: call `SyncScheduler.schedulePeriodic(context)` + `enqueueOnAppForeground(context)` from app startup (MainActivity), and `SyncStatusRepository.load()` once at startup.
- **Progress:** read task.md, plan §5.8.2/§5.10/§6.2/§6.3/§9 M5, desktop `sync-engine.ts`/`sync-settings.ts`/`background.ts`, Task 02 DAO/entity, Task 04 HomeViewModel/Screen, SettingsScreen placeholder; task.md → IN PROGRESS. Writing files next.


## 2026-08-20 — Orchestrator finalization
- `SyncGraph.engineFactory` wired to the real chain: `SyncRunner(SyncEngine(SyncEngineDriveApi(OkHttpDriveApi(DriveOAuth(OAuthConfig(BuildConfig…), KeystoreTokenStore, SharedPrefsPendingAuthStore, client), client), …), RoomPageStore, FrameStore.inFilesDir, …))`; `isConnected` = Keystore token present. UnwiredSyncRunner stays only as the pre-wire fallback.
- OAuth client values injected at build time from `../oauth.local.json` (`nativeClientId`/`nativeClientSecret`) into BuildConfig via `app/build.gradle.kts`; empty/placeholder → `OAuthConfig.isConfigured=false` (app works unconfigured, Settings explains).
- `DriveOAuth.isConfigured()` added (public accessor over the private config).
- `MainActivity`: calls `SyncGraph.wire(this)` + `SyncScheduler.schedulePeriodic` + `enqueueOnAppForeground` + `repository.load()` at startup (were already present), plus `KeystoreKeyProvider.unlockForApp()`.
- Wipe support: `deleteAll()` added to VideoPageDao / OcrTextDao / SyncMetaDao; `FrameStore.clearAll()`; `ModelStore.installedFileNames()/delete()/deleteAll()`; `ModelLoader.fileName()` promoted from ModelDownloader's private extension.
- Status: DONE. Full suite: 22 suites, 402 tests, 0 failures; `assembleDebug` green.
