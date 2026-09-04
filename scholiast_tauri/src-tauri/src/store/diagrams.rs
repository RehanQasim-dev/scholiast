use scholiast_core::error::ScholiastError;
use serde::{Deserialize, Serialize};

use super::{dberr, Store};

/// Contract for the `diagrams` table (Excalidraw scenes; image bytes live on
/// disk at `png_path`, never in JSON).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagramRow {
    pub id: String,
    pub page_url_hash: Option<String>,
    pub image_for_highlight: Option<String>,
    pub pasted: bool,
    pub scene_json: Option<String>,
    pub png_path: Option<String>,
    pub updated_at: i64,
}

/// Contract for the `diagrams` table.
pub trait DiagramsRepo {
    async fn upsert_diagram(&self, diagram: &DiagramRow) -> Result<(), ScholiastError>;
}

impl DiagramsRepo for Store<'_> {
    async fn upsert_diagram(&self, diagram: &DiagramRow) -> Result<(), ScholiastError> {
        sqlx::query(
            "INSERT INTO diagrams (
                id, page_url_hash, image_for_highlight, pasted,
                scene_json, png_path, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                page_url_hash = excluded.page_url_hash,
                image_for_highlight = excluded.image_for_highlight,
                pasted = excluded.pasted,
                scene_json = excluded.scene_json,
                png_path = excluded.png_path,
                updated_at = excluded.updated_at",
        )
        .bind(&diagram.id)
        .bind(&diagram.page_url_hash)
        .bind(&diagram.image_for_highlight)
        .bind(diagram.pasted)
        .bind(&diagram.scene_json)
        .bind(&diagram.png_path)
        .bind(diagram.updated_at)
        .execute(self.pool)
        .await
        .map_err(dberr)?;
        Ok(())
    }}
