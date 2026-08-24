//! Reader article listings over `pages` (task 23).
//!
//! Single-page writes live in [`crate::store::highlights::PagesRepo`]; this
//! module adds the library-level queries the reader route needs.

use scholiast_core::error::ScholiastError;
use serde::Serialize;
use sqlx::Row;

use super::{dberr, now_ms, Store};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArticleSummary {
    pub url_hash: String,
    pub url: String,
    pub title: Option<String>,
    pub domain: Option<String>,
    pub updated_at: i64,
}

/// Contract for reader-facing page listings.
pub trait ArticlesRepo {
    async fn list_articles(&self) -> Result<Vec<ArticleSummary>, ScholiastError>;
    /// Bumps recency without touching content; consumed by the reader shell
    /// wave (28+) for open/resume tracking.
    #[allow(dead_code)]
    async fn touch_updated_at(&self, url_hash: &str) -> Result<bool, ScholiastError>;
}

impl ArticlesRepo for Store<'_> {
    async fn list_articles(&self) -> Result<Vec<ArticleSummary>, ScholiastError> {
        let rows = sqlx::query("SELECT * FROM pages ORDER BY updated_at DESC, url_hash")
            .fetch_all(self.pool)
            .await
            .map_err(dberr)?;
        Ok(rows
            .iter()
            .map(|row| ArticleSummary {
                url_hash: row.get("url_hash"),
                url: row.get("url"),
                title: row.get("title"),
                domain: row.get::<Option<String>, _>("url").and_then(|ref u| {
                    let d = domain_of(u);
                    (!d.is_empty()).then_some(d)
                }),
                updated_at: row.get("updated_at"),
            })
            .collect())
    }

    async fn touch_updated_at(&self, url_hash: &str) -> Result<bool, ScholiastError> {
        let result = sqlx::query("UPDATE pages SET updated_at = ? WHERE url_hash = ?")
            .bind(now_ms())
            .bind(url_hash)
            .execute(self.pool)
            .await
            .map_err(dberr)?;
        Ok(result.rows_affected() > 0)
    }
}

/// Host of an absolute URL without credentials/port, lowercased. Best-effort:
/// anything unparseable yields an empty string (summary shows no domain).
fn domain_of(url: &str) -> String {
    let rest = url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(url)
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("");
    let host = rest.rsplit('@').next().unwrap_or(rest);
    let host = host.split(':').next().unwrap_or(host);
    host.to_lowercase()
        .trim_start_matches("www.")
        .trim_end_matches('.')
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::highlights::PagesRepo;
    use crate::store::test_support;
    use sqlx::{
        sqlite::{SqliteConnectOptions, SqlitePoolOptions},
        SqlitePool,
    };
    use std::str::FromStr;

    #[tokio::test]
    async fn list_articles_orders_by_recency_with_domain() {
        let pool = test_support::memory_pool().await;
        let store = Store::new(&pool);
        let h1 = store
            .upsert_page("https://www.example.com/a?utm_source=x", Some("Alpha"))
            .await
            .unwrap();
        let h2 = store
            .upsert_page("https://other.org/b", None)
            .await
            .unwrap();
        store.touch_updated_at(&h2).await.unwrap();

        let articles = store.list_articles().await.unwrap();
        assert_eq!(articles.len(), 2);
        // Touched most recently -> first.
        assert_eq!(articles[0].url_hash, h2);
        assert_eq!(articles[0].domain.as_deref(), Some("other.org"));
        assert_eq!(articles[1].url_hash, h1);
        assert_eq!(
            articles[1].domain.as_deref(),
            Some("example.com"),
            "normalized url drops tracking params + www"
        );
    }

    #[tokio::test]
    async fn touch_updated_at_reports_missing_pages() {
        let pool = test_support::memory_pool().await;
        let store = Store::new(&pool);
        assert!(!store.touch_updated_at("ghost").await.unwrap());
        let hash = store.upsert_page("https://a.example/x", None).await.unwrap();
        sqlx::query("UPDATE pages SET updated_at = 1")
            .execute(&pool)
            .await
            .unwrap();
        assert!(store.touch_updated_at(&hash).await.unwrap());
        let bumped: i64 =
            sqlx::query_scalar("SELECT updated_at FROM pages WHERE url_hash = ?")
                .bind(&hash)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(bumped > 1);
    }

    #[tokio::test]
    async fn migrations_apply_on_fresh_temp_file_db() {
        let dir = tempfile::tempdir().unwrap();
        let options = SqliteConnectOptions::from_str(&format!(
            "{}/scholiast-test.db",
            dir.path().display()
        ))
        .unwrap()
        .create_if_missing(true)
        .foreign_keys(true);
        let pool: SqlitePool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();

        let tables: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        for expected in ["pages", "highlights", "comments"] {
            assert!(tables.contains(&expected.to_string()), "missing {expected}");
        }
        let indexes: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        for expected in [
            "idx_highlights_url",
            "idx_comments_highlight",
            "idx_pages_updated",
        ] {
            assert!(indexes.iter().any(|i| i == expected), "missing {expected}");
        }
    }
}
