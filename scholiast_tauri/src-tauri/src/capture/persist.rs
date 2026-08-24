//! Persisting saved frame items: temp JPEG moves to its permanent home, the
//! Excalidraw PNG lands beside it, a `diagrams` row holds the editable scene,
//! and a `kind:'frame'` `video_items` row makes it queryable. Mirrors the
//! desktop extension's layout (scene JSON in the diagrams record, image bytes
//! only ever as files).

use base64::Engine;
use scholiast_core::error::{Reply, ScholiastError};
use scholiast_core::models::{FrameImage, VideoItem, VideoItemKind};
use serde::Serialize;
use sqlx::Row;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::state::AppState;
use crate::store::diagrams::{DiagramsRepo, DiagramRow};
use crate::store::video_items::VideoItemsRepo;
use crate::store::videos::VideosRepo;
use crate::store::{now_ms, Store};

const PNG_MAGIC: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFrameOut {
    pub item_id: String,
    pub jpg_path: String,
    pub png_path: String,
    pub w: i64,
    pub h: i64,
}

fn emit_changed(app: &AppHandle, table: &str, url_hash: &str) {
    if let Err(err) = app.emit(
        format!("db://changed:{table}").as_str(),
        serde_json::json!({ "table": table, "urlHash": url_hash }),
    ) {
        eprintln!("capture::persist emit failed: {err}");
    }
}

/// Persists a captured frame. `tmp_path` is consumed (renamed into
/// `frames/<itemId>.jpg`). Re-invoking with an existing `item_id` overwrites
/// that diagram id in place (reopen-edit, cumulative scenes).
///
/// Arguments arrive camelCase from IPC (`videoTime`, `pngBase64`, …).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn save_frame_item(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    video_time: f64,
    tmp_path: String,
    png_base64: String,
    scene_json: String,
    item_id: Option<String>,
) -> Result<Reply<SaveFrameOut>, ScholiastError> {
    let item_id = item_id.unwrap_or_else(scholiast_core::normalize::gen_video_id);
    let url_hash =
        scholiast_core::normalize::url_hash(&scholiast_core::normalize::normalize_url(&url));

    let png_bytes = base64::engine::general_purpose::STANDARD
        .decode(png_base64.as_bytes())
        .map_err(|e| ScholiastError::InvalidInput(format!("frame PNG is not valid base64: {e}")))?;
    if png_bytes.get(0..8) != Some(&PNG_MAGIC[..]) {
        return Err(ScholiastError::InvalidInput(
            "frame PNG payload missing PNG signature".into(),
        ));
    }

    // FK target must exist before the item row.
    Store::new(&state.pool)
        .upsert_video(&url, None, None)
        .await?;

    // Confirm the temp JPEG is real and learn its dims before moving it.
    let dims = image::ImageReader::open(&tmp_path)
        .map_err(|e| ScholiastError::Io(e.to_string()))?
        .with_guessed_format()
        .map_err(|e| ScholiastError::Io(e.to_string()))?
        .into_dimensions()
        .map_err(|e| ScholiastError::Io(e.to_string()))?;
    let (w, h): (i64, i64) = (dims.0.into(), dims.1.into());

    let frames_dir = app
        .path()
        .app_data_dir()
        .map_err(crate::store::internal)?
        .join("frames");
    tokio::fs::create_dir_all(&frames_dir)
        .await
        .map_err(|e| ScholiastError::Io(e.to_string()))?;
    let jpg_path = frames_dir.join(format!("{item_id}.jpg"));
    let png_path = frames_dir.join(format!("{item_id}.png"));

    tokio::fs::rename(&tmp_path, &jpg_path)
        .await
        .map_err(|e| ScholiastError::Io(e.to_string()))?;
    tokio::fs::write(&png_path, &png_bytes)
        .await
        .map_err(|e| ScholiastError::Io(e.to_string()))?;
    let jpg_str = jpg_path.to_string_lossy().into_owned();
    let png_str = png_path.to_string_lossy().into_owned();

    let updated_at = now_ms();
    Store::new(&state.pool)
        .upsert_diagram(&DiagramRow {
            id: item_id.clone(),
            page_url_hash: Some(url_hash.clone()),
            image_for_highlight: None,
            pasted: false,
            scene_json: Some(scene_json),
            png_path: Some(png_str.clone()),
            updated_at,
        })
        .await?;

    Store::new(&state.pool)
        .save_video_item(
            &url_hash,
            &VideoItem {
                id: item_id.clone(),
                kind: VideoItemKind::Frame,
                video_time,
                frame: Some(FrameImage {
                    data_url: None,
                    drive_id: None,
                    w,
                    h,
                    extra: Default::default(),
                }),
                markup: None,
                notes: vec![],
                updated_at: Some(updated_at),
                time_end: None,
                quote: None,
                color: None,
                anchor: None,
                excalidraw_scene: None,
                extra: Default::default(),
            },
        )
        .await?;

    emit_changed(&app, "diagrams", &url_hash);
    emit_changed(&app, "video_items", &url_hash);

    Ok(Reply::new(SaveFrameOut {
        item_id,
        jpg_path: jpg_str,
        png_path: png_str,
        w,
        h,
    }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameItemDetail {
    pub item_id: String,
    pub url_hash: String,
    pub video_time: f64,
    pub w: Option<i64>,
    pub h: Option<i64>,
    /// Raw Excalidraw scene JSON (elements/appState/files), or null when the
    /// item predates drawing support.
    pub scene_json: Option<String>,
    /// Absolute path of the baked composite PNG (asset-protocol displayable).
    pub png_path: Option<String>,
}

/// Loads a saved frame for reopen-edit: scene + baked PNG path.
#[tauri::command]
pub async fn get_frame_item(
    state: State<'_, AppState>,
    item_id: String,
) -> Result<Reply<FrameItemDetail>, ScholiastError> {
    let row = sqlx::query(
        "SELECT vi.id, vi.url_hash, vi.video_time, vi.frame_w, vi.frame_h,
                vi.notes_json, d.scene_json, d.png_path
         FROM video_items vi
         LEFT JOIN diagrams d ON d.id = vi.id
         WHERE vi.id = ? AND vi.kind = 'frame'",
    )
    .bind(&item_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(crate::store::dberr)?
    .ok_or_else(|| ScholiastError::NotFound(format!("frame item {item_id}")))?;

    Ok(Reply::new(FrameItemDetail {
        item_id: row.try_get("id").map_err(crate::store::dberr)?,
        url_hash: row.try_get("url_hash").map_err(crate::store::dberr)?,
        video_time: row.try_get("video_time").map_err(crate::store::dberr)?,
        w: row.try_get("frame_w").map_err(crate::store::dberr)?,
        h: row.try_get("frame_h").map_err(crate::store::dberr)?,
        scene_json: row.try_get("scene_json").map_err(crate::store::dberr)?,
        png_path: row.try_get("png_path").map_err(crate::store::dberr)?,
    }))
}
