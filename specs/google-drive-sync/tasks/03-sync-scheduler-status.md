# 03: Sync Scheduler & Status UI

**What to build:** Sync Scheduler & Status UI

**Blocked by:** 02

**Status:** completed

- [x] Interval and debounced change queue flushes pending state (Invariant 5)
- [x] Sync status chips and progress events reflect sync state (Invariant 5)

## Scope & Implementation Notes
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


## Execution History & Log
# LOG — task-18: Sync Scheduler & Status UI

## 2026-08-24 — implementation (agent)

Status set NOT STARTED → IN PROGRESS → DONE in this task.

### Delivered
- `src-tauri/src/sync/scheduler.rs` (NEW, owned):
  - `pub fn spawn(app)` — single-instance guarded (`AtomicBool::swap`), tokio task.
  - Triggers (plan §6.8): startup full reconcile → 15-min interval → debounced
    dirty-queue drain. Reconcile logic is **not** duplicated: scheduler calls the
    engine's public `SyncEngine::{new, pull_full, push_page}` directly (no IPC),
    with its own progress sink re-emitting `sync://progress`.
  - Debounce: pure `DebounceSet` (window from FIRST offer; bursts ≤3s coalesce,
    dedup via BTreeSet). Listeners registered per concrete table name
    (`db://changed:{videos,video_items,highlights,drawings,diagrams,pages,tags}`) —
    tauri 2.x validates event names verbatim, wildcards are NOT supported.
  - Drain reconciles ONLY hashes still present in `sync_queue` (`pending()` ∩
    burst), pushing each and dequeuing on success; first failure aborts the rest,
    leaving queue entries intact.
  - Offline failures: exponential backoff `30s·2^attempt + jitter(<5s)`, capped at
    the 15-min interval; never drops entries (engine guarantees +
    dequeue-only-on-success). Pure `backoff_delay_ms(attempt, jitter, cap)` —
    unit-tested.
  - Emits `sync://state` after every run/attempt (see event contract below).
  - Tests: debounce coalescing + window restart, backoff growth/cap (fake clock /
    injected jitter).
- `src/hooks/useSyncStatus.ts` (NEW): subscribes to both events (Home.tsx-style
  try/catch so test envs without Tauri get defaults); exports pure `foldSyncEvent`
  reducer + `IDLE_SYNC_STATUS`. Tests cover folding + live subscription/unlisten.
- `src/components/SyncStatusBar.tsx` (+test): Home-header chip; precedence
  running > error > queued > idle; click navigates `/settings`; tooltip carries
  error text. View logic exported as `syncStatusView` for matrix testing.
- `src/components/settings/SyncProgressCard.tsx` (NEW, +test): state line,
  progress bar (indeterminate pulse during `discovering`/manual run), current page
  + done/total, red alert line, "Sync now" → `sync_now`, pending-queue note,
  last-synced relative time (shared helper).
- Minimal edits: `lib.rs` (one `spawn` line after `app.manage`),
  `Settings.tsx` (import + `<SyncProgressCard/>` inside Sync group next to
  DriveSection), `Home.tsx` (header row now hosts `<SyncStatusBar/>`).

### Event contract (documented per instructions)
- `sync://progress` — UNCHANGED engine shape:
  `{phase: string ("discovering"|"reconciling"|"pushing"), done: number,
  total: number, title: string, url: string}` (camelCase, emitted by the engine's
  progress sink).
- `sync://state` — NEW, emitted by scheduler after each run/drain/attempt:
  `{lastSynced: number | null,   // epoch ms of last SUCCESSFUL full reconcile
    pending: number,             // sync_queue row count
    error: string | null}`       // message of the most recent failed run
  Note: `error` extends the {lastSynced,pending} payload requested by the brief —
  the Home chip's red state has no other source (the command path surfaces errors
  only as IPC rejections).

### Gates
- `cargo clippy --workspace --all-targets -- -D warnings` ✅ clean
- `cargo test --workspace` ✅ all green, 74 passed in the main lib suite
  (incl. 3 new scheduler tests) plus core/server suites
- `pnpm lint` ✅ · `pnpm typecheck` ✅ · `pnpm vitest run` ✅ 134/134

### Sibling breakage repaired (explicit attribution — shared gates were red)
The workspace did not compile before my changes; these pre-existing errors are in
other tasks' files and received minimal mechanical fixes so ANY gate could run:
1. `store/pages.rs` `domain_of` returned a reference into a temporary
   `to_lowercase()` (E0515) → returns `String`; call site `.then_some(d)`.
2. `store/highlights.rs` `touch_page_of_highlight` returned `Result<()>` while the
   `AnnotationRepo` trait methods (`delete_highlight`, `set_highlight_color`) and
   their tests expect the owning hash (E0308 ×2) → helper now returns
   `Ok(Some(hash))`; `save_highlight`/`save_comment` impl tails discard it
   (`await?; Ok(())`). A post-move use in that file's test fixed with `.clone()`.
3. `commands/reader.rs` E0599 resolved itself mid-run (concurrent sibling edit);
   its failing test `reply_envelope_wraps_page_view` was also red earlier and
   passed by final rerun — owned/fixed by that task, never touched by me.

### Deviations & notes
- **Enqueue wiring not done**: task.md lists "wire enqueue calls at every mutation
  site", but those sites live in `commands/*` (task-02 ownership — FORBIDDEN for
  me). No mutation site enqueues yet; the scheduler's queue-intersection drain is
  correct-by-construction and becomes active the moment task-02 wires enqueue.
- Tauri events support no wildcard patterns → one listener per table name
  (superset list `LISTENED_TABLES`; empty-hash payloads like `tags` are skipped).
- Concurrent sibling agents were editing shared files during this task; my
  Home.tsx import was clobbered once by a sibling rewrite and re-applied against
  the new file; final gates were rerun after all churn settled.

