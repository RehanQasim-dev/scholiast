//! Video CRUD over IPC. Every write emits `db://changed:<table>` so TanStack
//! Query can invalidate precisely (plan §3.3 / §3.4).

use scholiast_core::error::{Reply, ScholiastError};
use scholiast_core::models::VideoItem;
use serde_json::json;
use tauri::{AppHandle, Emitter, State};

use crate::state::AppState;
use crate::store::tags::TagsRepo;
use crate::store::video_items::VideoItemsRepo;
use crate::store::videos::{VideoSummary, VideosRepo};
use crate::store::Store;

fn emit_changed(app: &AppHandle, table: &str, url_hash: &str) {
    let _ = app.emit(
        format!("db://changed:{table}").as_str(),
        json!({ "table": table, "urlHash": url_hash }),
    );
}

#[tauri::command]
pub async fn upsert_video(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    title: Option<String>,
    video_id: Option<String>,
) -> Result<Reply<VideoSummary>, ScholiastError> {
    let summary = Store::new(&state.pool)
        .upsert_video(&url, title.as_deref(), video_id.as_deref())
        .await?;
    emit_changed(&app, "videos", &summary.url_hash);
    Ok(Reply::new(summary))
}

#[tauri::command]
pub async fn list_recent_videos(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> Result<Reply<Vec<VideoSummary>>, ScholiastError> {
    let rows = Store::new(&state.pool)
        .list_recent_videos(limit.unwrap_or(50).clamp(1, 500))
        .await?;
    Ok(Reply::new(rows))
}

#[tauri::command]
pub async fn get_video_items(
    state: State<'_, AppState>,
    url_hash: String,
) -> Result<Reply<Vec<VideoItem>>, ScholiastError> {
    let items = Store::new(&state.pool).get_video_items(&url_hash).await?;
    Ok(Reply::new(items))
}

#[tauri::command]
pub async fn save_video_item(
    app: AppHandle,
    state: State<'_, AppState>,
    url_hash: String,
    item: VideoItem,
) -> Result<Reply<()>, ScholiastError> {
    Store::new(&state.pool)
        .save_video_item(&url_hash, &item)
        .await?;
    emit_changed(&app, "video_items", &url_hash);
    Ok(Reply::new(()))
}

#[tauri::command]
pub async fn delete_video_item(
    app: AppHandle,
    state: State<'_, AppState>,
    url_hash: String,
    item_id: String,
) -> Result<Reply<bool>, ScholiastError> {
    let deleted = Store::new(&state.pool)
        .delete_video_item(&url_hash, &item_id)
        .await?;
    if deleted {
        emit_changed(&app, "video_items", &url_hash);
    }
    Ok(Reply::new(deleted))
}

#[tauri::command]
pub async fn set_resume_at(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    resume_at: f64,
) -> Result<Reply<bool>, ScholiastError> {
    let url_hash = scholiast_core::normalize::url_hash(&scholiast_core::normalize::normalize_url(
        &url,
    ));
    let updated = Store::new(&state.pool)
        .set_resume_at(&url_hash, resume_at)
        .await?;
    if updated {
        emit_changed(&app, "videos", &url_hash);
    }
    Ok(Reply::new(updated))
}

#[tauri::command]
pub async fn add_note(
    app: AppHandle,
    state: State<'_, AppState>,
    url_hash: String,
    video_time: f64,
    body: Option<String>,
) -> Result<Reply<scholiast_core::models::VideoItem>, ScholiastError> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let text = body.unwrap_or_default().trim().to_string();
    let note = if text.is_empty() {
        scholiast_core::models::format_note("", now)
    } else {
        scholiast_core::models::format_note(&text, now)
    };
    let item = scholiast_core::models::VideoItem {
        id: scholiast_core::normalize::gen_video_id(),
        kind: scholiast_core::models::VideoItemKind::Note,
        video_time,
        frame: None,
        markup: None,
        notes: vec![note],
        updated_at: Some(now),
        time_end: None,
        quote: None,
        color: None,
        anchor: None,
        excalidraw_scene: None,
        extra: Default::default(),
    };
    Store::new(&state.pool)
        .save_video_item(&url_hash, &item)
        .await?;
    emit_changed(&app, "video_items", &url_hash);
    Ok(Reply::new(item))
}

// --- tags (#autocomplete index used by the comment editor task) ---------------

#[tauri::command]
pub async fn upsert_tag(
    app: AppHandle,
    state: State<'_, AppState>,
    tag: String,
) -> Result<Reply<()>, ScholiastError> {
    Store::new(&state.pool).upsert_tag(&tag).await?;
    emit_changed(&app, "tags", "");
    Ok(Reply::new(()))
}

#[tauri::command]
pub async fn list_tags(state: State<'_, AppState>) -> Result<Reply<Vec<String>>, ScholiastError> {
    Ok(Reply::new(Store::new(&state.pool).list_tags().await?))
}
