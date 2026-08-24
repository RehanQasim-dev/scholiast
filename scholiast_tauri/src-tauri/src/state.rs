use std::path::PathBuf;

use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    Error, SqlitePool,
};

pub struct AppState {
    pub pool: SqlitePool,
}

impl AppState {
    pub async fn init(data_dir: PathBuf) -> Result<Self, Error> {
        std::fs::create_dir_all(&data_dir).map_err(Error::Io)?;
        let options = SqliteConnectOptions::new()
            .filename(data_dir.join("scholiast.db"))
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new().connect_with(options).await?;
        sqlx::migrate!("./migrations").run(&pool).await?;
        Ok(Self { pool })
    }
}
