//! The sync scheduler (task-18): one background task owning all automatic
//! reconcile runs — startup, a 15-minute interval, and a debounced drain of
//! dirty pages coalesced from `db://changed:<table>` events. Offline failures
//! back off with jitter and never drop queue entries; every run ends with a
//! `sync://state` event so the UI can show idle/queued/error without polling.
//!
//! Reconcile logic itself lives in [`crate::sync::engine`]; this module only
//! decides *when* to call it and *what* to tell the frontend afterwards.

use std::collections::BTreeSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Deserialize;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Listener, Manager};

use crate::state::AppState;
use crate::store::sync_meta::SyncQueueRepo;
use crate::store::{now_ms, Store};
use crate::sync::engine::SyncEngine;

/// Full-reconcile cadence (plan §6.8).
const INTERVAL_MS: i64 = 15 * 60 * 1000;
/// A burst of writes inside this window collapses into one per-page drain.
const DEBOUNCE_MS: i64 = 3000;
/// How often the loop wakes to check debounce/backoff deadlines.
const TICK_MS: u64 = 250;
/// First retry delay after an offline failure; doubles per attempt, capped at
/// [`INTERVAL_MS`].
const BACKOFF_BASE_MS: i64 = 30_000;

/// Tables whose change events carry a page hash worth draining. Tauri event
/// names are validated verbatim (no wildcards), so each is listened to
/// individually; the set mirrors every emitter in the command layer.
const LISTENED_TABLES: [&str; 7] = [
    "videos",
    "video_items",
    "highlights",
    "drawings",
    "diagrams",
    "pages",
    "tags",
];

/// Tables announced after merged writes land, mirroring the command layer so
/// open windows refresh their queries.
const MERGED_TABLES: [&str; 4] = ["highlights", "drawings", "video_items", "diagrams"];

static SPAWNED: AtomicBool = AtomicBool::new(false);

pub fn spawn(app: AppHandle) {
    if SPAWNED.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        run(app).await;
    });
}

#[derive(Deserialize)]
struct ChangedPayload {
    #[serde(rename = "urlHash", default)]
    url_hash: String,
}

fn emit_changed(app: &AppHandle, url_hash: &str) {
    for table in MERGED_TABLES {
        if let Err(err) = app.emit(
            format!("db://changed:{table}").as_str(),
            serde_json::json!({ "table": table, "urlHash": url_hash }),
        ) {
            eprintln!("scheduler emit db://changed failed: {err}");
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncStateEvent {
    last_synced: Option<i64>,
    pending: usize,
    error: Option<String>,
}

async fn pending_count(app: &AppHandle) -> usize {
    let state = app.state::<AppState>();
    Store::new(&state.pool)
        .pending()
        .await
        .map_or(0, |hashes| hashes.len())
}

async fn emit_state(app: &AppHandle, last_synced: Option<i64>, error: Option<&str>) {
    let pending = pending_count(app).await;
    if let Err(err) = app.emit(
        "sync://state",
        SyncStateEvent {
            last_synced,
            pending,
            error: error.map(str::to_string),
        },
    ) {
        eprintln!("scheduler emit sync://state failed: {err}");
    }
}

type RunResult = Result<Vec<String>, String>;

async fn run_full(app: &AppHandle) -> RunResult {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .to_path_buf();
    let state = app.state::<AppState>();
    let app_for_progress = app.clone();
    let mut engine = SyncEngine::new(
        &state.pool,
        data_dir,
        move |progress| {
            if let Err(err) = app_for_progress.emit("sync://progress", &progress) {
                eprintln!("scheduler progress emit failed: {err}");
            }
        },
    );
    match engine.pull_full().await {
        Ok((_, touched)) => Ok(touched),
        Err(err) => Err(err.to_string()),
    }
}

/// Pushes exactly the given hashes that still sit in the dirty queue. Any
/// failure aborts the rest — untouched entries stay queued for the next pass.
async fn drain_pages(app: &AppHandle, hashes: &[String]) -> Result<(), String> {
    let state = app.state::<AppState>();
    let store = Store::new(&state.pool);
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .to_path_buf();
    let queued = store.pending().await.map_err(|e| e.to_string())?;
    let app_for_progress = app.clone();
    let mut engine = SyncEngine::new(
        &state.pool,
        data_dir,
        move |progress| {
            if let Err(err) = app_for_progress.emit("sync://progress", &progress) {
                eprintln!("scheduler progress emit failed: {err}");
            }
        },
    );
    for hash in hashes {
        if !queued.iter().any(|q| q == hash) {
            continue;
        }
        engine.push_page(hash).await.map_err(|e| e.to_string())?;
        store.dequeue(hash).await.map_err(|e| e.to_string())?;
        emit_changed(app, hash);
    }
    Ok(())
}

/// Coalesces bursts of page-hash offers into one flush once the window has
/// passed since the FIRST offer (not the last), so a steady trickle cannot
/// starve. Pure apart from the caller-supplied clock — unit-tested below.
struct DebounceSet {
    window_ms: i64,
    first_at: Option<i64>,
    pending: BTreeSet<String>,
}

impl DebounceSet {
    fn new(window_ms: i64) -> Self {
        DebounceSet {
            window_ms,
            first_at: None,
            pending: BTreeSet::new(),
        }
    }

    fn offer(&mut self, hash: &str, at_ms: i64) {
        if hash.is_empty() || self.pending.contains(hash) {
            return;
        }
        if self.first_at.is_none() {
            self.first_at = Some(at_ms);
        }
        self.pending.insert(hash.to_string());
    }

    /// Flushes everything offered when the window since the first offer has
    /// elapsed; otherwise returns nothing and keeps collecting.
    fn take_due(&mut self, now_ms: i64) -> Vec<String> {
        let due = matches!(self.first_at, Some(first) if now_ms.saturating_sub(first) >= self.window_ms);
        if !due {
            return Vec::new();
        }
        self.first_at = None;
        std::mem::take(&mut self.pending).into_iter().collect()
    }
}

/// Exponential backoff with jitter: `base·2^attempt + jitter`, capped at
/// `cap_ms`. Deterministic given the jitter term (the async loop derives it
/// from the wall clock).
fn backoff_delay_ms(attempt: u32, jitter_ms: i64, cap_ms: i64) -> i64 {
    let shift = attempt.min(16);
    (BACKOFF_BASE_MS.saturating_mul(1i64 << shift)).saturating_add(jitter_ms).min(cap_ms)
}

fn jitter_ms() -> i64 {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as i64)
        .unwrap_or(0);
    nanos % 5000
}

async fn run(app: AppHandle) {
    let buffer = Arc::new(Mutex::new(DebounceSet::new(DEBOUNCE_MS)));
    for table in LISTENED_TABLES {
        let buffer = Arc::clone(&buffer);
        app.listen(format!("db://changed:{table}").as_str(), move |event| {
            let Ok(payload) = serde_json::from_str::<ChangedPayload>(event.payload()) else {
                return;
            };
            if payload.url_hash.is_empty() {
                return;
            }
            if let Ok(mut guard) = buffer.lock() {
                guard.offer(&payload.url_hash, now_ms());
            }
        });
    }

    let mut last_synced: Option<i64> = None;
    let mut backoff_attempt: u32 = 0;
    let mut retry_at: Option<i64> = None;
    let mut next_interval = now_ms() + INTERVAL_MS;

    // Startup reconcile (plan §6.8 trigger #1).
    match run_full(&app).await {
        Ok(touched) => {
            for hash in &touched {
                emit_changed(&app, hash);
            }
            last_synced = Some(now_ms());
            emit_state(&app, last_synced, None).await;
        }
        Err(message) => {
            eprintln!("startup sync failed: {message}");
            backoff_attempt += 1;
            retry_at = Some(now_ms() + backoff_delay_ms(backoff_attempt, jitter_ms(), INTERVAL_MS));
            emit_state(&app, None, Some(&message)).await;
        }
    }

    loop {
        tokio::time::sleep(Duration::from_millis(TICK_MS)).await;
        let now = now_ms();

        let due: Vec<String> = match buffer.lock() {
            Ok(mut guard) => guard.take_due(now),
            Err(_) => Vec::new(),
        };
        if !due.is_empty() {
            if let Err(message) = drain_pages(&app, &due).await {
                eprintln!("dirty-page drain failed: {message}");
                emit_state(&app, last_synced, Some(&message)).await;
            } else {
                emit_state(&app, last_synced, None).await;
            }
        }

        let interval_due = now >= next_interval;
        let retry_due = retry_at.is_some_and(|at| now >= at);
        if !interval_due && !retry_due {
            continue;
        }
        match run_full(&app).await {
            Ok(touched) => {
                for hash in &touched {
                    emit_changed(&app, hash);
                }
                last_synced = Some(now_ms());
                backoff_attempt = 0;
                retry_at = None;
                next_interval = now + INTERVAL_MS;
                emit_state(&app, last_synced, None).await;
            }
            Err(message) => {
                eprintln!("scheduled sync failed: {message}");
                backoff_attempt = backoff_attempt.saturating_add(1);
                retry_at =
                    Some(now + backoff_delay_ms(backoff_attempt, jitter_ms(), INTERVAL_MS));
                next_interval = now + INTERVAL_MS;
                emit_state(&app, last_synced, Some(&message)).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debounce_coalesces_burst_into_one_flush() {
        let mut set = DebounceSet::new(3000);
        set.offer("a", 0);
        set.offer("b", 500);
        set.offer("a", 1200);
        set.offer("c", 2999);
        assert!(set.take_due(1000).is_empty(), "window not elapsed");
        assert_eq!(set.take_due(3000), vec!["a", "b", "c"]);
    }

    #[test]
    fn debounce_window_restarts_after_flush_and_skips_empty_hashes() {
        let mut set = DebounceSet::new(3000);
        set.offer("x", 0);
        assert_eq!(set.take_due(3000), vec!["x"]);
        set.offer("", 3100);
        set.offer("y", 3200);
        assert!(set.take_due(5000).is_empty(), "second window just started");
        assert_eq!(set.take_due(6200), vec!["y"]);
    }

    #[test]
    fn backoff_grows_exponentially_then_caps_at_the_interval() {
        let cap = INTERVAL_MS;
        let mut previous = 0i64;
        for attempt in 0..8u32 {
            let delay = backoff_delay_ms(attempt, 0, cap);
            assert!(delay >= previous);
            assert!(delay <= cap);
            previous = delay;
        }
        assert_eq!(backoff_delay_ms(20, 1234, cap), cap, "deep attempts cap");
        assert_eq!(backoff_delay_ms(0, 4000, cap), BACKOFF_BASE_MS + 4000);
    }
}
