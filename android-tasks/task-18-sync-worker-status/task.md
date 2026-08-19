# Task 18 — Sync worker + status UI

Status: DONE (finalized 2026-08-20 by orchestrator)

## Objective
The sync scheduler and its user-facing status: WorkManager-driven periodic + on-demand sync, offline retry, and the sync status surfaced on Home and Settings.

## Scope — files you OWN (in `../android/app/src/main/java/com/scholiast/android/`)
- `domain/sync/SyncScheduler.kt` — WorkManager setup: periodic sync (network-constrained, ~15 min), one-off "sync now", foreground-on-app-start, offline reschedule
- `domain/sync/SyncStatusRepository.kt` — StateFlow of `SyncStatus{phase, done, total, title, lastSynced, error}` written by the worker, read by Home/Settings (this is the interface Task 04 reads)
- `domain/sync/SyncWorker.kt` — the CoroutineWorker wrapping Task 17's `SyncEngine`
- `ui/sync/SyncStatusBar.kt` — the compact status chip/bar composable (idle / in-flight progress / error / offline)
- `domain/sync/SyncSchedulerTest.kt` — worker scheduling + status state machine tests

## References (read first)
- `../scholiast_mobile_app_plan.md`: §5.8.2 (scheduling, status surfacing), §5.10 (offline queued/retried), §6.3 (Home sync chip), §6.2 (SyncStatusBar), §9 M5
- Desktop reference: `../src/background.ts` (sync alarms + debounced push), `../src/utils/sync-engine.ts` (progress phases)

## Requirements
- Periodic: `PeriodicWorkRequest` (15 min, `NetworkType.CONNECTED`, backoff) that runs Task 17's full reconcile; a unique-name policy so only one runs.
- On-demand: `enqueueUniqueWork("sync_now", REPLACE, OneTimeWorkRequest)` from Settings' **Sync now**.
- On-app-foreground: enqueue a one-time sync (dedupe with periodic in-flight).
- Progress: the worker reports `phase` (discovering → per-page), `done/total`, current page title/url, and the terminal state (success / error) into `SyncStatusRepository`; writes rate-limited (don't write per page in a huge reconcile).
- Offline: worker returns `Result.retry()` when offline/network error; nothing is lost (local queue persists).
- Status UI: Home chip (idle "Synced 5 min ago" / "Syncing… 3/14" / "Sync failed"), Settings card with the bar + message (red on failure, hidden when idle).

## Acceptance criteria
- Unit tests: worker scheduling constraints, unique-work dedupe, status state transitions (idle→discovering→pages→success/error→idle), offline retry.
- Integration: running the worker with a fake SyncEngine produces the status updates in order (rate-limited).
- Home/Settings consume `SyncStatusRepository` and render all states.

## Agent notes
- Coordinate with Task 17: you schedule and report; it reconciles. Use its `SyncEngine` interface; if absent, define the interface and log it.
- Do not fight WorkManager's minimum 15-min periodic interval — note it in LOG.md.
- Write your log to `LOG.md` as you work.