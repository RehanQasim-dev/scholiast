# Task 18: Sync Scheduler & Status UI

Status: DONE
Wave: 5
Depends on: task-17

## Scope & Owned Files
- `src-tauri/src/sync/scheduler.rs` — tokio task: startup reconcile + 15-min interval + debounced enqueue (per-page) on `db://changed` events; jittered retries with backoff when offline; emits `sync://progress {phase,done,total,title,url}` and `sync://state {lastSynced, pending}`
- Frontend:
  - `src/components/SyncStatusBar.tsx` — Home header chip (idle/progress %/error/offline-queued)
  - Settings Sync card: state line, progress bar (indeterminate during discovery), current page + done/total, error red state, **Sync now** button, last-synced timestamp
- Wire enqueue calls at every mutation site (task-02 command layer is the single choke point)

## Acceptance Criteria
- Scheduler unit tests: debounce coalescing, offline retry backoff, progress event sequence
- Component tests for both status surfaces

## Notes
Rate-limit storage writes of progress (coalesce per page like the extension did).
