pub mod diagrams;
pub mod highlights;
pub mod ocr_texts;
pub mod pages;
pub mod sync_meta;
pub mod tags;
pub mod video_items;
pub mod videos;
pub mod assembly;

use scholiast_core::error::ScholiastError;
use sqlx::SqlitePool;

/// Pool-backed facade; each submodule contributes its repository slice.
pub struct Store<'a> {
    pub pool: &'a SqlitePool,
}

impl<'a> Store<'a> {
    pub fn new(pool: &'a SqlitePool) -> Self {
        Store { pool }
    }
}

/// Maps a driver error onto the IPC error envelope.
pub(crate) fn dberr(e: sqlx::Error) -> ScholiastError {
    match &e {
        sqlx::Error::RowNotFound => ScholiastError::NotFound("row".into()),
        _ => ScholiastError::Db(e.to_string()),
    }
}

pub(crate) fn internal<E: std::fmt::Display>(e: E) -> ScholiastError {
    ScholiastError::Internal(e.to_string())
}

/// Wall-clock ms (the extension's `Date.now()` equivalent).
pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
pub(crate) mod test_support {
    use sqlx::{
        sqlite::{SqliteConnectOptions, SqlitePoolOptions},
        SqlitePool,
    };

    /// Single-connection in-memory DB with migrations applied.
    /// (`":memory:"` as filename keeps every statement on one connection.)
    pub(crate) async fn memory_pool() -> SqlitePool {
        let options = SqliteConnectOptions::new()
            .filename(":memory:")
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }
}
