use scholiast_core::error::ScholiastError;
use serde::{Deserialize, Serialize};

use super::{dberr, Store};

/// Video row as surfaced over IPC (camelCase).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoSummary {
    #[serde(rename = "urlHash")]
    pub url_hash: String,
    pub url: String,
    #[serde(rename = "videoId")]
    pub video_id: Option<String>,
    pub title: Option<String>,
    #[serde(rename = "resumeAt")]
    pub resume_at: f64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
}

/// Contract for the `videos` table (used by later tasks' mocks).
pub trait VideosRepo {
    async fn upsert_video(
        &self,
        url: &str,
        title: Option<&str>,
        video_id: Option<&str>,
    ) -> Result<VideoSummary, ScholiastError>;
    async fn get_video(&self, url_hash: &str) -> Result<Option<VideoSummary>, ScholiastError>;
    async fn list_recent_videos(&self, limit: i64) -> Result<Vec<VideoSummary>, ScholiastError>;
    async fn set_resume_at(&self, url_hash: &str, seconds: f64) -> Result<bool, ScholiastError>;
}

fn summary_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<VideoSummary, sqlx::Error> {
    use sqlx::Row;
    Ok(VideoSummary {
        url_hash: row.try_get("url_hash")?,
        url: row.try_get("url")?,
        video_id: row.try_get::<Option<String>, _>("video_id")?,
        title: row.try_get::<Option<String>, _>("title")?,
        resume_at: row.try_get::<f64, _>("resume_at").unwrap_or_default(),
        updated_at: row.try_get("updated_at")?,
    })
}

/// Repo key for a URL: sha256-prefix of the *normalized* url (repo scheme).
pub fn video_key(url: &str) -> (String, String) {
    let normalized = scholiast_core::normalize::normalize_url(url);
    let hash = scholiast_core::normalize::url_hash(&normalized);
    (hash, normalized)
}

impl VideosRepo for Store<'_> {
    async fn upsert_video(
        &self,
        url: &str,
        title: Option<&str>,
        video_id: Option<&str>,
    ) -> Result<VideoSummary, ScholiastError> {
        let now = super::now_ms();
        let (hash, normalized) = video_key(url);
        sqlx::query(
            "INSERT INTO videos (url_hash, url, video_id, title, resume_at, updated_at)
             VALUES (?, ?, ?, ?, 0, ?)
             ON CONFLICT(url_hash) DO UPDATE SET
               url = excluded.url,
               video_id = COALESCE(excluded.video_id, videos.video_id),
               title = COALESCE(excluded.title, videos.title),
               updated_at = excluded.updated_at",
        )
        .bind(&hash)
        .bind(normalized)
        .bind(video_id)
        .bind(title)
        .bind(now)
        .execute(self.pool)
        .await
        .map_err(dberr)?;
        Ok(self
            .get_video(&hash)
            .await?
            .expect("row exists after upsert"))
    }

    async fn get_video(&self, url_hash: &str) -> Result<Option<VideoSummary>, ScholiastError> {
        let row = sqlx::query("SELECT * FROM videos WHERE url_hash = ?")
            .bind(url_hash)
            .fetch_optional(self.pool)
            .await
            .map_err(dberr)?;
        row.map(|r| summary_from_row(&r).map_err(dberr)).transpose()
    }

    async fn list_recent_videos(&self, limit: i64) -> Result<Vec<VideoSummary>, ScholiastError> {
        let rows = sqlx::query("SELECT * FROM videos ORDER BY updated_at DESC, url_hash LIMIT ?")
            .bind(limit)
            .fetch_all(self.pool)
            .await
            .map_err(dberr)?;
        rows.iter()
            .map(summary_from_row)
            .collect::<Result<Vec<_>, _>>()
            .map_err(dberr)
    }

    async fn set_resume_at(&self, url_hash: &str, seconds: f64) -> Result<bool, ScholiastError> {
        let result =
            sqlx::query("UPDATE videos SET resume_at = ?, updated_at = ? WHERE url_hash = ?")
                .bind(seconds)
                .bind(super::now_ms())
                .bind(url_hash)
                .execute(self.pool)
                .await
                .map_err(dberr)?;
        Ok(result.rows_affected() > 0)
    }
}
