use scholiast_core::error::ScholiastError;

use super::{dberr, Store};

pub trait TagsRepo {
    async fn upsert_tag(&self, tag: &str) -> Result<(), ScholiastError>;
    async fn list_tags(&self) -> Result<Vec<String>, ScholiastError>;
}

impl TagsRepo for Store<'_> {
    /// Union-only insert so concurrent writers can never drop a tag.
    async fn upsert_tag(&self, tag: &str) -> Result<(), ScholiastError> {
        sqlx::query("INSERT OR IGNORE INTO tags (tag) VALUES (?)")
            .bind(tag)
            .execute(self.pool)
            .await
            .map_err(dberr)?;
        Ok(())
    }

    async fn list_tags(&self) -> Result<Vec<String>, ScholiastError> {
        let rows = sqlx::query_scalar::<_, String>("SELECT tag FROM tags ORDER BY tag")
            .fetch_all(self.pool)
            .await
            .map_err(dberr)?;
        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::test_support;

    #[tokio::test]
    async fn upsert_is_union_and_list_is_sorted() {
        let pool = test_support::memory_pool().await;
        let store = Store::new(&pool);
        store.upsert_tag("#monads").await.unwrap();
        store.upsert_tag("#rust").await.unwrap();
        store.upsert_tag("#monads").await.unwrap();
        assert_eq!(store.list_tags().await.unwrap(), vec!["#monads", "#rust"]);
    }
}
