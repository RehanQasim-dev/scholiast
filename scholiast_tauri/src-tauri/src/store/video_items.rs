use scholiast_core::error::ScholiastError;
use scholiast_core::models::{FrameImage, TranscriptAnchor, VideoItem, VideoItemKind, VideoMarkup};
use serde_json::Value;

use super::{dberr, Store};

/// Contract for the `video_items` table.
pub trait VideoItemsRepo {
    async fn save_video_item(&self, url_hash: &str, item: &VideoItem)
        -> Result<(), ScholiastError>;
    async fn get_video_items(&self, url_hash: &str) -> Result<Vec<VideoItem>, ScholiastError>;
    async fn delete_video_item(
        &self,
        url_hash: &str,
        item_id: &str,
    ) -> Result<bool, ScholiastError>;
}

fn kind_str(kind: &VideoItemKind) -> &'static str {
    match kind {
        VideoItemKind::Frame => "frame",
        VideoItemKind::Note => "note",
        VideoItemKind::Transcript => "transcript",
    }
}

impl VideoItemsRepo for Store<'_> {
    async fn save_video_item(
        &self,
        url_hash: &str,
        item: &VideoItem,
    ) -> Result<(), ScholiastError> {
        let updated_at = item.updated_at.unwrap_or_else(super::now_ms);
        let (frame_w, frame_h, frame_drive_id) = match &item.frame {
            Some(f) => (Some(f.w), Some(f.h), f.drive_id.as_deref()),
            None => (None, None, None),
        };
        let markup_json = match &item.markup {
            Some(m) => Some(serde_json::to_string(m).map_err(super::internal)?),
            None => None,
        };
        let anchor_json = match &item.anchor {
            Some(a) => Some(serde_json::to_string(a).map_err(super::internal)?),
            None => None,
        };
        let notes_json = serde_json::to_string(&item.notes).map_err(super::internal)?;
        sqlx::query(
            "INSERT INTO video_items (
                id, url_hash, kind, video_time, time_end,
                frame_w, frame_h, frame_drive_id, markup_json, anchor_json,
                quote, color, ocr_text, notes_json, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                url_hash = excluded.url_hash,
                kind = excluded.kind,
                video_time = excluded.video_time,
                time_end = excluded.time_end,
                frame_w = excluded.frame_w,
                frame_h = excluded.frame_h,
                frame_drive_id = excluded.frame_drive_id,
                markup_json = excluded.markup_json,
                anchor_json = excluded.anchor_json,
                quote = excluded.quote,
                color = excluded.color,
                ocr_text = COALESCE(excluded.ocr_text, video_items.ocr_text),
                notes_json = excluded.notes_json,
                updated_at = excluded.updated_at",
        )
        .bind(&item.id)
        .bind(url_hash)
        .bind(kind_str(&item.kind))
        .bind(item.video_time)
        .bind(item.time_end)
        .bind(frame_w)
        .bind(frame_h)
        .bind(frame_drive_id)
        .bind(markup_json)
        .bind(anchor_json)
        .bind(item.quote.as_deref())
        .bind(item.color.as_deref())
        .bind(None::<String>)
        .bind(notes_json)
        .bind(updated_at)
        .bind(updated_at)
        .execute(self.pool)
        .await
        .map_err(dberr)?;
        Ok(())
    }

    async fn get_video_items(&self, url_hash: &str) -> Result<Vec<VideoItem>, ScholiastError> {
        let rows = sqlx::query(
            "SELECT * FROM video_items WHERE url_hash = ? ORDER BY video_time ASC, id ASC",
        )
        .bind(url_hash)
        .fetch_all(self.pool)
        .await
        .map_err(dberr)?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows.iter() {
            items.push(row_to_item(row)?);
        }
        Ok(items)
    }

    async fn delete_video_item(
        &self,
        url_hash: &str,
        item_id: &str,
    ) -> Result<bool, ScholiastError> {
        let result = sqlx::query("DELETE FROM video_items WHERE id = ? AND url_hash = ?")
            .bind(item_id)
            .bind(url_hash)
            .execute(self.pool)
            .await
            .map_err(dberr)?;
        Ok(result.rows_affected() > 0)
    }
}

fn parse_json_column(raw: Option<String>) -> Option<Value> {
    raw.and_then(|s| serde_json::from_str(&s).ok())
}

fn row_to_item(row: &sqlx::sqlite::SqliteRow) -> Result<VideoItem, ScholiastError> {
    use sqlx::Row;
    let kind: String = row.try_get("kind").map_err(dberr)?;
    let kind = match kind.as_str() {
        "frame" => VideoItemKind::Frame,
        "note" => VideoItemKind::Note,
        "transcript" => VideoItemKind::Transcript,
        other => {
            return Err(ScholiastError::Db(format!(
                "unknown video item kind {other}"
            )))
        }
    };
    let frame_w: Option<i64> = row.try_get("frame_w").map_err(dberr)?;
    let frame_h: Option<i64> = row.try_get("frame_h").map_err(dberr)?;
    let frame = match (frame_w, frame_h) {
        (Some(w), Some(h)) => Some(FrameImage {
            data_url: None,
            drive_id: row
                .try_get::<Option<String>, _>("frame_drive_id")
                .map_err(dberr)?,
            w,
            h,
            extra: Default::default(),
        }),
        _ => None,
    };
    let notes: Vec<String> = parse_json_column(
        row.try_get::<Option<String>, _>("notes_json")
            .map_err(dberr)?,
    )
    .and_then(|v| serde_json::from_value(v).ok())
    .unwrap_or_default();

    Ok(VideoItem {
        id: row.try_get("id").map_err(dberr)?,
        kind,
        video_time: row.try_get::<f64, _>("video_time").map_err(dberr)?,
        frame,
        markup: parse_json_column(
            row.try_get::<Option<String>, _>("markup_json")
                .map_err(dberr)?,
        )
        .and_then(|v| serde_json::from_value::<VideoMarkup>(v).ok()),
        notes,
        updated_at: row.try_get::<Option<i64>, _>("updated_at").map_err(dberr)?,
        time_end: row.try_get::<Option<f64>, _>("time_end").map_err(dberr)?,
        quote: row.try_get::<Option<String>, _>("quote").map_err(dberr)?,
        color: row.try_get::<Option<String>, _>("color").map_err(dberr)?,
        anchor: parse_json_column(
            row.try_get::<Option<String>, _>("anchor_json")
                .map_err(dberr)?,
        )
        .and_then(|v| serde_json::from_value::<TranscriptAnchor>(v).ok()),
        excalidraw_scene: None,
        extra: Default::default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::videos::{VideoSummary, VideosRepo};
    use scholiast_core::models::format_note;

    async fn seeded_video() -> (sqlx::SqlitePool, String) {
        let pool = crate::store::test_support::memory_pool().await;
        let store = Store::new(&pool);
        let summary: VideoSummary = store
            .upsert_video("https://youtu.be/dQw4w9WgXcQ", Some("Lecture"), None)
            .await
            .unwrap();
        (pool, summary.url_hash)
    }

    #[tokio::test]
    async fn save_list_delete_round_trip() {
        let (pool, hash) = seeded_video().await;
        let store = Store::new(&pool);

        let item = VideoItem {
            id: scholiast_core::normalize::gen_video_id(),
            kind: VideoItemKind::Note,
            video_time: 91.5,
            frame: None,
            markup: None,
            notes: vec![format_note("voiced note", 1724000000000)],
            updated_at: Some(1724000001000),
            time_end: None,
            quote: None,
            color: None,
            anchor: None,
            excalidraw_scene: None,
            extra: Default::default(),
        };

        store.save_video_item(&hash, &item).await.unwrap();
        let listed = store.get_video_items(&hash).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, item.id);
        assert_eq!(listed[0].notes, item.notes);
        assert_eq!(listed[0].video_time, 91.5);

        assert!(store.delete_video_item(&hash, &item.id).await.unwrap());
        assert!(store.get_video_items(&hash).await.unwrap().is_empty());
        assert!(!store.delete_video_item(&hash, &item.id).await.unwrap());
    }

    #[tokio::test]
    async fn foreign_key_rejects_orphan_item() {
        let pool = crate::store::test_support::memory_pool().await;
        let store = Store::new(&pool);
        let orphan = VideoItem {
            id: "orphan1".into(),
            kind: VideoItemKind::Note,
            video_time: 0.0,
            frame: None,
            markup: None,
            notes: vec![],
            updated_at: Some(1),
            time_end: None,
            quote: None,
            color: None,
            anchor: None,
            excalidraw_scene: None,
            extra: Default::default(),
        };
        let err = store
            .save_video_item("nosuchhash", &orphan)
            .await
            .unwrap_err();
        assert!(matches!(err, ScholiastError::Db(_)));
    }
}
