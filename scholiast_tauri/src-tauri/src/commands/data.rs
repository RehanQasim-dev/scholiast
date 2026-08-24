//! Destructive data wipes (task-19): local SQLite + app-data files, and the
//! Drive appdata folder. Mirrors the extension's Data settings guards; the
//! frontend owns the typed-confirmation dialog, these commands do the work.
//!
//! `wipe_local_data` keeps the OS keyring entries and `settings.json` prefs —
//! only annotation/video data dies. `wipe_drive_data` lists and deletes every
//! file in Drive's hidden appData folder via the shared token provider
//! (`drive::access_token`, task-16).

use scholiast_core::error::{Reply, ScholiastError};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::drive::{self, DriveError};
use crate::state::AppState;

const DRIVE_FILES_URL: &str = "https://www.googleapis.com/drive/v3/files";

fn db(err: sqlx::Error) -> ScholiastError {
    ScholiastError::Db(err.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataStats {
    pub videos: i64,
    pub items: i64,
}

#[tauri::command]
pub async fn data_stats(state: State<'_, AppState>) -> Result<Reply<DataStats>, ScholiastError> {
    let videos: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM videos").fetch_one(&state.pool).await.map_err(db)?;
    let items: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM video_items")
        .fetch_one(&state.pool)
        .await
        .map_err(db)?;
    Ok(Reply::new(DataStats { videos, items }))
}

#[tauri::command]
pub async fn wipe_local_data(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Reply<bool>, ScholiastError> {
    // Diagram PNGs live at arbitrary recorded paths (not one dir) — collect
    // them before the tables go.
    let png_paths: Vec<String> = sqlx::query_scalar("SELECT png_path FROM diagrams WHERE png_path IS NOT NULL")
        .fetch_all(&state.pool)
        .await
        .map_err(db)?;

    for table in [
        "comments",
        "highlights",
        "video_items",
        "videos",
        "drawings",
        "diagrams",
        "pages",
        "tags",
        "ocr_texts",
        "sync_meta",
        "sync_snapshots",
        "sync_queue",
    ] {
        sqlx::query(&format!("DELETE FROM {table}"))
            .execute(&state.pool)
            .await
            .map_err(db)?;
    }

    let data_dir = app.path().app_data_dir().map_err(|err| ScholiastError::Io(err.to_string()))?;
    for dir_name in ["frames", "voice", "models"] {
        clear_dir_contents(&data_dir.join(dir_name));
    }
    for path in &png_paths {
        let _ = std::fs::remove_file(path);
    }

    Ok(Reply::new(true))
}

fn clear_dir_contents(dir: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.path().is_dir() {
            let _ = std::fs::remove_dir_all(entry.path());
        } else {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[tauri::command]
pub async fn wipe_drive_data() -> Result<Reply<u32>, DriveError> {
    let token = drive::access_token().await?;
    let client = reqwest::Client::new();

    let mut deleted = 0u32;
    let mut page_token: Option<String> = None;
    loop {
        let mut url = format!(
            "{DRIVE_FILES_URL}?spaces=appDataFolder&pageSize=1000&fields=nextPageToken%2Cfiles%28id%29"
        );
        if let Some(token) = &page_token {
            url.push_str(&format!(
                "&pageToken={}",
                token.replace('%', "%25").replace('&', "%26").replace('=', "%3D")
            ));
        }
        let response = client
            .get(url)
            .bearer_auth(&token)
            .send()
            .await?
            .error_for_status()?;
        let body: serde_json::Value = serde_json::from_str(&response.text().await?)
            .map_err(|err| DriveError::Http(err.to_string()))?;
        let ids: Vec<String> = body["files"]
            .as_array()
            .map(|files| {
                files
                    .iter()
                    .filter_map(|f| f["id"].as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        for id in &ids {
            client
                .delete(format!("{DRIVE_FILES_URL}/{id}"))
                .bearer_auth(&token)
                .send()
                .await?
                .error_for_status()?;
            deleted += 1;
        }
        page_token = body["nextPageToken"].as_str().map(str::to_string);
        if page_token.is_none() {
            break;
        }
    }

    Ok(Reply::new(deleted))
}
