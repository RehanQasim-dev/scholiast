#![allow(dead_code)] // OCR rows are written by the v1.1 Gemma wave

use scholiast_core::error::ScholiastError;
use sqlx::Row;

use super::{dberr, now_ms, Store};

pub struct OcrText {
    pub item_id: String,
    pub text: Option<String>,
    pub created_at: i64,
}

pub trait OcrTextsRepo {
    async fn put_ocr_text(&self, item_id: &str, text: &str) -> Result<(), ScholiastError>;
    async fn get_ocr_text(&self, item_id: &str) -> Result<Option<OcrText>, ScholiastError>;
}

impl OcrTextsRepo for Store<'_> {
    async fn put_ocr_text(&self, item_id: &str, text: &str) -> Result<(), ScholiastError> {
        sqlx::query(
            "INSERT INTO ocr_texts (item_id, text, created_at) VALUES (?, ?, ?)
             ON CONFLICT(item_id) DO UPDATE SET text = excluded.text",
        )
        .bind(item_id)
        .bind(text)
        .bind(now_ms())
        .execute(self.pool)
        .await
        .map_err(dberr)?;
        Ok(())
    }

    async fn get_ocr_text(&self, item_id: &str) -> Result<Option<OcrText>, ScholiastError> {
        Ok(
            sqlx::query("SELECT item_id, text, created_at FROM ocr_texts WHERE item_id = ?")
                .bind(item_id)
                .fetch_optional(self.pool)
                .await
                .map_err(dberr)?
                .map(|row| OcrText {
                    item_id: row.get("item_id"),
                    text: row.get("text"),
                    created_at: row.get("created_at"),
                }),
        )
    }
}
