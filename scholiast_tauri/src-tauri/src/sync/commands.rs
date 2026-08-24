//! Sync IPC surface: `sync_now` (full reconcile + queue drain) and
//! `is_page_in_sync`. Long operations stream `sync://progress` events; merged
//! writes announce `db://changed:*` per touched table so open windows refresh
//! via query invalidation.

use scholiast_core::error::{Reply, ScholiastError};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::state::AppState;
use crate::sync::engine::{SyncEngine, SyncOutcome};

/// Bridges task-16's `DriveError` onto the shared IPC envelope.
impl From<crate::drive::DriveError> for ScholiastError {
    fn from(err: crate::drive::DriveError) -> Self {
        match err {
            crate::drive::DriveError::Io(m) => ScholiastError::Io(m),
            crate::drive::DriveError::InvalidInput(m) | crate::drive::DriveError::OauthDenied(m) => {
                ScholiastError::InvalidInput(m)
            }
            other => ScholiastError::Internal(other.to_string()),
        }
    }
}

fn emit_changed(app: &AppHandle, table: &str, url_hash: &str) {
    if let Err(err) = app.emit(
        format!("db://changed:{table}").as_str(),
        serde_json::json!({ "table": table, "urlHash": url_hash }),
    ) {
        eprintln!("sync emit db://changed failed: {err}");
    }
}

const CHANGED_TABLES: [&str; 4] = ["highlights", "drawings", "video_items", "diagrams"];

#[tauri::command]
pub async fn sync_now(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Reply<SyncOutcome>, ScholiastError> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| ScholiastError::Io(e.to_string()))?;
    let app_for_progress = app.clone();
    let mut engine = SyncEngine::new(
        &state.pool,
        data_dir,
        move |progress| {
            if let Err(err) = app_for_progress.emit("sync://progress", &progress) {
                eprintln!("sync progress emit failed: {err}");
            }
        },
    );
    let (outcome, touched) = engine.pull_full().await?;

    // Merged writes happened — tell every window which tables moved.
    for hash in &touched {
        for table in CHANGED_TABLES {
            emit_changed(&app, table, hash);
        }
    }
    Ok(Reply::new(outcome))
}

#[tauri::command]
pub async fn is_page_in_sync(
    state: State<'_, AppState>,
    url_hash: String,
) -> Result<Reply<bool>, ScholiastError> {
    let mut engine =
        SyncEngine::quiet(&state.pool, std::env::temp_dir());
    Ok(Reply::new(engine.is_page_in_sync(&url_hash).await?))
}
