#![allow(dead_code)] // Drive bookkeeping lands with the sync engine (task-17)

use scholiast_core::error::ScholiastError;
use scholiast_core::models::PageRecord;
use sqlx::Row;

use super::{dberr, now_ms, Store};

/// Drive bookkeeping for one page (`pagemeta:<url>` in the extension).
pub struct SyncMeta {
    pub url_hash: String,
    pub file_id: Option<String>,
    pub head_revision_id: Option<String>,
    pub last_synced: Option<i64>,
}

pub trait SyncMetaRepo {
    async fn get_meta(&self, url_hash: &str) -> Result<Option<SyncMeta>, ScholiastError>;
    async fn put_meta(
        &self,
        url_hash: &str,
        file_id: &str,
        head_revision_id: &str,
    ) -> Result<(), ScholiastError>;
}

impl SyncMetaRepo for Store<'_> {
    async fn get_meta(&self, url_hash: &str) -> Result<Option<SyncMeta>, ScholiastError> {
        Ok(sqlx::query("SELECT * FROM sync_meta WHERE url_hash = ?")
            .bind(url_hash)
            .fetch_optional(self.pool)
            .await
            .map_err(dberr)?
            .map(|row: sqlx::sqlite::SqliteRow| SyncMeta {
                url_hash: row.get("url_hash"),
                file_id: row.get("file_id"),
                head_revision_id: row.get("head_revision_id"),
                last_synced: row.get("last_synced"),
            }))
    }

    async fn put_meta(
        &self,
        url_hash: &str,
        file_id: &str,
        head_revision_id: &str,
    ) -> Result<(), ScholiastError> {
        sqlx::query(
            "INSERT INTO sync_meta (url_hash, file_id, head_revision_id, last_synced)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(url_hash) DO UPDATE SET
               file_id = excluded.file_id,
               head_revision_id = excluded.head_revision_id,
               last_synced = excluded.last_synced",
        )
        .bind(url_hash)
        .bind(file_id)
        .bind(head_revision_id)
        .bind(now_ms())
        .execute(self.pool)
        .await
        .map_err(dberr)?;
        Ok(())
    }
}

pub trait SnapshotsRepo {
    async fn put_snapshot(&self, url_hash: &str, record: &PageRecord)
        -> Result<(), ScholiastError>;
    async fn get_snapshot(&self, url_hash: &str) -> Result<Option<PageRecord>, ScholiastError>;
}

impl SnapshotsRepo for Store<'_> {
    /// The last-reconciled record — the 3-way merge base.
    async fn put_snapshot(
        &self,
        url_hash: &str,
        record: &PageRecord,
    ) -> Result<(), ScholiastError> {
        let json =
            serde_json::to_string(record).map_err(|e| ScholiastError::Internal(e.to_string()))?;
        sqlx::query(
            "INSERT INTO sync_snapshots (url_hash, record_json) VALUES (?, ?)
             ON CONFLICT(url_hash) DO UPDATE SET record_json = excluded.record_json",
        )
        .bind(url_hash)
        .bind(json)
        .execute(self.pool)
        .await
        .map_err(dberr)?;
        Ok(())
    }

    async fn get_snapshot(&self, url_hash: &str) -> Result<Option<PageRecord>, ScholiastError> {
        let raw: Option<String> =
            sqlx::query_scalar("SELECT record_json FROM sync_snapshots WHERE url_hash = ?")
                .bind(url_hash)
                .fetch_optional(self.pool)
                .await
                .map_err(dberr)?;
        raw.map(|s| serde_json::from_str(&s).map_err(internal_err))
            .transpose()
    }
}

fn internal_err<E: std::fmt::Display>(e: E) -> ScholiastError {
    ScholiastError::Internal(e.to_string())
}

/// Contract for the dirty-page queue.
pub trait SyncQueueRepo {
    async fn enqueue(&self, url_hash: &str) -> Result<(), ScholiastError>;
    async fn dequeue(&self, url_hash: &str) -> Result<bool, ScholiastError>;
    async fn pending(&self) -> Result<Vec<String>, ScholiastError>;
}

impl SyncQueueRepo for Store<'_> {
    async fn enqueue(&self, url_hash: &str) -> Result<(), ScholiastError> {
        sqlx::query(
            "INSERT INTO sync_queue (url_hash, enqueued_at) VALUES (?, ?)
             ON CONFLICT(url_hash) DO UPDATE SET enqueued_at = excluded.enqueued_at",
        )
        .bind(url_hash)
        .bind(now_ms())
        .execute(self.pool)
        .await
        .map_err(dberr)?;
        Ok(())
    }

    async fn dequeue(&self, url_hash: &str) -> Result<bool, ScholiastError> {
        let result = sqlx::query("DELETE FROM sync_queue WHERE url_hash = ?")
            .bind(url_hash)
            .execute(self.pool)
            .await
            .map_err(dberr)?;
        Ok(result.rows_affected() > 0)
    }

    async fn pending(&self) -> Result<Vec<String>, ScholiastError> {
        sqlx::query_scalar("SELECT url_hash FROM sync_queue ORDER BY enqueued_at")
            .fetch_all(self.pool)
            .await
            .map_err(dberr)
    }
}
