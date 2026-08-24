#![allow(dead_code)] // pages/highlights/drawings/diagrams repos land in Reader (23-32) / sync (17) waves

use scholiast_core::error::ScholiastError;
use scholiast_core::models::{
    CommentData, DiagramMeta, ElementHighlight, HighlightData, PageDrawing, TextHighlight,
};
use sqlx::Row;

use super::{dberr, internal, now_ms, Store};

// --- pages -------------------------------------------------------------------

pub struct PageRow {
    pub url_hash: String,
    pub url: String,
    pub title: Option<String>,
    pub source_markdown: Option<String>,
    pub captured_at: Option<i64>,
    pub updated_at: i64,
}

/// Contract for the `pages` table (Reader wave).
pub trait PagesRepo {
    async fn upsert_page(&self, url: &str, title: Option<&str>) -> Result<String, ScholiastError>;
    async fn get_page(&self, url_hash: &str) -> Result<Option<PageRow>, ScholiastError>;
    async fn set_source_markdown(
        &self,
        url_hash: &str,
        markdown: &str,
        captured_at: i64,
    ) -> Result<(), ScholiastError>;
    async fn delete_page(&self, url_hash: &str) -> Result<bool, ScholiastError>;
}

impl PagesRepo for Store<'_> {
    async fn upsert_page(&self, url: &str, title: Option<&str>) -> Result<String, ScholiastError> {
        let normalized = scholiast_core::normalize::normalize_url(url);
        let hash = scholiast_core::normalize::url_hash(&normalized);
        sqlx::query(
            "INSERT INTO pages (url_hash, url, title, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(url_hash) DO UPDATE SET
               title = COALESCE(excluded.title, pages.title),
               updated_at = excluded.updated_at",
        )
        .bind(&hash)
        .bind(&normalized)
        .bind(title)
        .bind(now_ms())
        .execute(self.pool)
        .await
        .map_err(dberr)?;
        Ok(hash)
    }

    async fn get_page(&self, url_hash: &str) -> Result<Option<PageRow>, ScholiastError> {
        Ok(sqlx::query("SELECT * FROM pages WHERE url_hash = ?")
            .bind(url_hash)
            .fetch_optional(self.pool)
            .await
            .map_err(dberr)?
            .map(|row| PageRow {
                url_hash: row.get("url_hash"),
                url: row.get("url"),
                title: row.get("title"),
                source_markdown: row.get("source_markdown"),
                captured_at: row.get("captured_at"),
                updated_at: row.get("updated_at"),
            }))
    }

    /// The readable body is immutable once captured (repo rule).
    async fn set_source_markdown(
        &self,
        url_hash: &str,
        markdown: &str,
        captured_at: i64,
    ) -> Result<(), ScholiastError> {
        sqlx::query(
            "UPDATE pages SET
               source_markdown = COALESCE(source_markdown, ?),
               captured_at = COALESCE(captured_at, ?)
             WHERE url_hash = ?",
        )
        .bind(markdown)
        .bind(captured_at)
        .bind(url_hash)
        .execute(self.pool)
        .await
        .map_err(dberr)?;
        Ok(())
    }

    async fn delete_page(&self, url_hash: &str) -> Result<bool, ScholiastError> {
        let result = sqlx::query("DELETE FROM pages WHERE url_hash = ?")
            .bind(url_hash)
            .execute(self.pool)
            .await
            .map_err(dberr)?;
        Ok(result.rows_affected() > 0)
    }
}

// --- highlights ---------------------------------------------------------------

pub struct HighlightRow {
    pub url_hash: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub highlight: HighlightData,
}

/// Contract for the `highlights` table (Reader wave).
pub trait HighlightsRepo {
    async fn save_highlights(
        &self,
        url_hash: &str,
        highlights: &[HighlightData],
    ) -> Result<(), ScholiastError>;
    async fn get_highlights(&self, url_hash: &str) -> Result<Vec<HighlightRow>, ScholiastError>;
}

impl HighlightsRepo for Store<'_> {
    /// Full-page replace: the page's highlight list is the unit of sync.
    /// Comments ride along (they live in their own table, keyed by marker id).
    async fn save_highlights(
        &self,
        url_hash: &str,
        highlights: &[HighlightData],
    ) -> Result<(), ScholiastError> {
        let mut tx = self.pool.begin().await.map_err(dberr)?;
        sqlx::query("DELETE FROM highlights WHERE url_hash = ?")
            .bind(url_hash)
            .execute(&mut *tx)
            .await
            .map_err(dberr)?;
        for hl in highlights {
            let now = now_ms();
            let (kind, xpath, start_offset, end_offset, content): (
                &str,
                Option<String>,
                Option<i64>,
                Option<i64>,
                String,
            ) = match hl {
                HighlightData::Text(t) => (
                    "text",
                    t.xpath.clone(),
                    t.start_offset,
                    t.end_offset,
                    t.content.clone(),
                ),
                HighlightData::Element(e) => {
                    ("element", e.xpath.clone(), None, None, e.content.clone())
                }
            };
            let common = CommonFields::of(hl);
            let anchor_json = common
                .anchor
                .map(serde_json::to_string)
                .transpose()
                .map_err(internal)?;
            let updated_at = common.updated_at.unwrap_or(now);
            sqlx::query(
                "INSERT INTO highlights (
                    id, url_hash, type, xpath, start_offset, end_offset,
                    content, color, group_id, anchor_json, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(hl.id())
            .bind(url_hash)
            .bind(kind)
            .bind(xpath)
            .bind(start_offset)
            .bind(end_offset)
            .bind(content)
            .bind(common.color.unwrap_or_default())
            .bind(common.group_id)
            .bind(anchor_json)
            .bind(updated_at)
            .bind(updated_at)
            .execute(&mut *tx)
            .await
            .map_err(dberr)?;

            // Comments: replace the thread for this highlight.
            sqlx::query("DELETE FROM comments WHERE highlight_id = ?")
                .bind(hl.id())
                .execute(&mut *tx)
                .await
                .map_err(dberr)?;
            for note in hl.notes() {
                let c = parse_comment_data(note);
                sqlx::query(
                    "INSERT OR REPLACE INTO comments (id, highlight_id, body, created_at, edited_at)
                     VALUES (?, ?, ?, ?, ?)",
                )
                .bind(&c.id)
                .bind(hl.id())
                .bind(&c.body)
                .bind(c.created_at)
                .bind(c.edited_at)
                .execute(&mut *tx)
                .await
                .map_err(dberr)?;
            }
        }
        tx.commit().await.map_err(dberr)?;
        Ok(())
    }

    async fn get_highlights(&self, url_hash: &str) -> Result<Vec<HighlightRow>, ScholiastError> {
        let rows =
            sqlx::query("SELECT * FROM highlights WHERE url_hash = ? ORDER BY created_at, id")
                .bind(url_hash)
                .fetch_all(self.pool)
                .await
                .map_err(dberr)?;

        // Comments for every highlight of the page, grouped in memory.
        let mut comments: std::collections::BTreeMap<String, Vec<CommentData>> =
            std::collections::BTreeMap::new();
        {
            use sqlx::Row as _;
            let crows = sqlx::query(
                "SELECT c.* FROM comments c
                 JOIN highlights h ON h.id = c.highlight_id
                 WHERE h.url_hash = ? ORDER BY c.created_at, c.rowid",
            )
            .bind(url_hash)
            .fetch_all(self.pool)
            .await
            .map_err(dberr)?;
            for row in crows.iter() {
                let hl_id: String = row.get("highlight_id");
                comments.entry(hl_id).or_default().push(CommentData {
                    id: row.get("id"),
                    body: row.get("body"),
                    created_at: row.try_get("created_at").unwrap_or_default(),
                    edited_at: row.get("edited_at"),
                });
            }
        }

        rows.iter()
            .map(|row| highlight_from_row(row, &comments))
            .collect()
    }
}

struct CommonFields<'a> {
    color: Option<&'a str>,
    group_id: Option<&'a str>,
    updated_at: Option<i64>,
    anchor: Option<&'a scholiast_core::models::AnnotationAnchor>,
}

impl<'a> CommonFields<'a> {
    fn of(hl: &'a HighlightData) -> Self {
        match hl {
            HighlightData::Text(t) => Self {
                color: t.color.as_deref(),
                group_id: t.group_id.as_deref(),
                updated_at: t.updated_at,
                anchor: t.anchor.as_ref(),
            },
            HighlightData::Element(e) => Self {
                color: e.color.as_deref(),
                group_id: e.group_id.as_deref(),
                updated_at: e.updated_at,
                anchor: e.anchor.as_ref(),
            },
        }
    }
}

fn highlight_from_row(
    row: &sqlx::sqlite::SqliteRow,
    comments: &std::collections::BTreeMap<String, Vec<CommentData>>,
) -> Result<HighlightRow, ScholiastError> {
    let id: String = row.get("id");
    let stored_notes: Vec<String> = comments
        .get(&id)
        .map(|cs| cs.iter().map(comment_marker_string).collect())
        .unwrap_or_default();

    let highlight = if kind_of(row)? == "text" {
        HighlightData::Text(TextHighlight {
            id,
            xpath: row.get("xpath"),
            start_offset: row.get("start_offset"),
            end_offset: row.get("end_offset"),
            content: row.get("content"),
            notes: stored_notes,
            color: non_empty(row.get::<Option<String>, _>("color")),
            group_id: row.get("group_id"),
            updated_at: row.get("updated_at"),
            anchor: parse_anchor(row),
            image_edit: None,
            extra: Default::default(),
        })
    } else {
        HighlightData::Element(ElementHighlight {
            id,
            xpath: row.get("xpath"),
            content: row.get("content"),
            notes: stored_notes,
            color: non_empty(row.get::<Option<String>, _>("color")),
            group_id: row.get("group_id"),
            updated_at: row.get("updated_at"),
            anchor: parse_anchor(row),
            image_edit: None,
            extra: Default::default(),
        })
    };

    Ok(HighlightRow {
        url_hash: row.get("url_hash"),
        created_at: row.try_get("created_at").unwrap_or_default(),
        updated_at: row.try_get("updated_at").unwrap_or_default(),
        highlight,
    })
}

fn kind_of(row: &sqlx::sqlite::SqliteRow) -> Result<String, ScholiastError> {
    row.try_get::<String, _>("type").map_err(dberr)
}

fn non_empty(v: Option<String>) -> Option<String> {
    v.filter(|s| !s.is_empty())
}

fn parse_anchor(row: &sqlx::sqlite::SqliteRow) -> Option<scholiast_core::models::AnnotationAnchor> {
    row.try_get::<Option<String>, _>("anchor_json")
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
}

fn comment_marker_string(c: &CommentData) -> String {
    match c.edited_at {
        Some(edited) => scholiast_core::models::apply_edited(
            &scholiast_core::models::format_note(&c.body, c.created_at),
            edited,
        ),
        None => scholiast_core::models::format_note(&c.body, c.created_at),
    }
}

fn parse_comment_data(note: &str) -> CommentData {
    scholiast_core::models::parse_comment(note)
}

// --- drawings & diagrams -------------------------------------------------------

/// Contract for the `drawings` table (freehand strokes).
pub trait DrawingsRepo {
    async fn save_drawings(
        &self,
        url_hash: &str,
        strokes: &[PageDrawing],
    ) -> Result<(), ScholiastError>;
    async fn get_drawings(&self, url_hash: &str) -> Result<Vec<PageDrawing>, ScholiastError>;
}

impl DrawingsRepo for Store<'_> {
    async fn save_drawings(
        &self,
        url_hash: &str,
        strokes: &[PageDrawing],
    ) -> Result<(), ScholiastError> {
        let mut tx = self.pool.begin().await.map_err(dberr)?;
        sqlx::query("DELETE FROM drawings WHERE url_hash = ?")
            .bind(url_hash)
            .execute(&mut *tx)
            .await
            .map_err(dberr)?;
        for s in strokes {
            sqlx::query(
                "INSERT INTO drawings (stroke_id, url_hash, color, width, points_json, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(&s.id)
            .bind(url_hash)
            .bind(s.color.clone().unwrap_or_default())
            .bind(s.width.unwrap_or_default())
            .bind(serde_json::to_string(&s.points).map_err(internal)?)
            .bind(s.updated_at)
            .execute(&mut *tx)
            .await
            .map_err(dberr)?;
        }
        tx.commit().await.map_err(dberr)?;
        Ok(())
    }

    async fn get_drawings(&self, url_hash: &str) -> Result<Vec<PageDrawing>, ScholiastError> {
        let rows = sqlx::query("SELECT * FROM drawings WHERE url_hash = ?")
            .bind(url_hash)
            .fetch_all(self.pool)
            .await
            .map_err(dberr)?;
        let mut out = Vec::with_capacity(rows.len());
        for row in rows.iter() {
            out.push(PageDrawing {
                id: row.get("stroke_id"),
                color: Some(row.get("color")),
                width: Some(row.get("width")),
                points: serde_json::from_str(&row.get::<String, _>("points_json"))
                    .unwrap_or_default(),
                updated_at: row.get("updated_at"),
                extra: Default::default(),
            });
        }
        Ok(out)
    }
}

/// Contract for the `diagrams` table.
pub trait DiagramsRepo {
    async fn save_diagram(
        &self,
        page_url_hash: Option<&str>,
        diagram: &DiagramMeta,
    ) -> Result<(), ScholiastError>;
    async fn get_diagram(&self, id: &str) -> Result<Option<DiagramMeta>, ScholiastError>;
    async fn delete_diagram(&self, id: &str) -> Result<bool, ScholiastError>;
}

impl DiagramsRepo for Store<'_> {
    async fn save_diagram(
        &self,
        page_url_hash: Option<&str>,
        d: &DiagramMeta,
    ) -> Result<(), ScholiastError> {
        sqlx::query(
            "INSERT INTO diagrams (
                id, page_url_hash, image_for_highlight, pasted,
                scene_json, png_path, png_drive_id, scene_drive_id, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                page_url_hash = excluded.page_url_hash,
                image_for_highlight = excluded.image_for_highlight,
                pasted = excluded.pasted,
                scene_json = excluded.scene_json,
                png_drive_id = excluded.png_drive_id,
                scene_drive_id = excluded.scene_drive_id,
                updated_at = excluded.updated_at",
        )
        .bind(&d.id)
        .bind(page_url_hash)
        .bind(d.image_for_highlight.as_deref())
        .bind(d.pasted)
        .bind(
            d.scene_data
                .as_ref()
                .map(serde_json::to_string)
                .transpose()
                .map_err(internal)?,
        )
        .bind(png_path_for(&d.id))
        .bind(d.drive_id.as_deref())
        .bind(d.scene_drive_id.as_deref())
        .bind(d.updated_at.unwrap_or_else(now_ms))
        .execute(self.pool)
        .await
        .map_err(dberr)?;
        Ok(())
    }

    async fn get_diagram(&self, id: &str) -> Result<Option<DiagramMeta>, ScholiastError> {
        Ok(sqlx::query("SELECT * FROM diagrams WHERE id = ?")
            .bind(id)
            .fetch_optional(self.pool)
            .await
            .map_err(dberr)?
            .map(diagram_from_row))
    }

    async fn delete_diagram(&self, id: &str) -> Result<bool, ScholiastError> {
        let result = sqlx::query("DELETE FROM diagrams WHERE id = ?")
            .bind(id)
            .execute(self.pool)
            .await
            .map_err(dberr)?;
        Ok(result.rows_affected() > 0)
    }
}

fn diagram_from_row(row: sqlx::sqlite::SqliteRow) -> DiagramMeta {
    DiagramMeta {
        id: row.get("id"),
        scene_data: row
            .try_get::<Option<String>, _>("scene_json")
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str(&s).ok()),
        updated_at: row.get("updated_at"),
        drive_id: row.get("png_drive_id"),
        scene_drive_id: row.get("scene_drive_id"),
        pasted: row.try_get::<i64, _>("pasted").unwrap_or_default() != 0,
        image_for_highlight: row.get("image_for_highlight"),
        page_url: None,
        extra: Default::default(),
    }
}

fn png_path_for(diagram_id: &str) -> String {
    format!("diagrams/{diagram_id}.png")
}

// --- per-item annotation ops (Reader wave, task 23) ----------------------------

/// Single-annotation writes for the reader: the extension mutates one
/// highlight/comment at a time; full-page replace stays with
/// [`HighlightsRepo`] (sync's unit).
pub trait AnnotationRepo {
    async fn save_highlight(
        &self,
        url_hash: &str,
        highlight: &HighlightData,
    ) -> Result<(), ScholiastError>;
    /// Returns the owning page hash so the caller can emit change events.
    async fn delete_highlight(&self, highlight_id: &str)
        -> Result<Option<String>, ScholiastError>;
    async fn set_highlight_color(
        &self,
        highlight_id: &str,
        color: &str,
    ) -> Result<Option<String>, ScholiastError>;
    /// Upserts one comment from its inline-marker string (id preserved
    /// exactly); bumps the highlight + page timestamps.
    async fn save_comment(&self, highlight_id: &str, note: &str) -> Result<(), ScholiastError>;
    async fn list_comments(&self, highlight_id: &str) -> Result<Vec<CommentData>, ScholiastError>;
    async fn delete_comment(&self, comment_id: &str) -> Result<Option<String>, ScholiastError>;
    /// Page owning this highlight, for change-event routing.
    async fn highlight_page(&self, highlight_id: &str)
        -> Result<Option<String>, ScholiastError>;
}

impl AnnotationRepo for Store<'_> {
    async fn save_highlight(
        &self,
        url_hash: &str,
        hl: &HighlightData,
    ) -> Result<(), ScholiastError> {
        let now = now_ms();
        let (kind, xpath, start_offset, end_offset, content): (
            &str,
            Option<String>,
            Option<i64>,
            Option<i64>,
            String,
        ) = match hl {
            HighlightData::Text(t) => (
                "text",
                t.xpath.clone(),
                t.start_offset,
                t.end_offset,
                t.content.clone(),
            ),
            HighlightData::Element(e) => ("element", e.xpath.clone(), None, None, e.content.clone()),
        };
        let common = CommonFields::of(hl);
        let anchor_json = common
            .anchor
            .map(serde_json::to_string)
            .transpose()
            .map_err(internal)?;
        let updated_at = common.updated_at.unwrap_or(now);
        sqlx::query(
            "INSERT INTO highlights (
                id, url_hash, type, xpath, start_offset, end_offset,
                content, color, group_id, anchor_json, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                url_hash = excluded.url_hash,
                type = excluded.type,
                xpath = excluded.xpath,
                start_offset = excluded.start_offset,
                end_offset = excluded.end_offset,
                content = excluded.content,
                color = excluded.color,
                group_id = excluded.group_id,
                anchor_json = excluded.anchor_json,
                updated_at = excluded.updated_at",
        )
        .bind(hl.id())
        .bind(url_hash)
        .bind(kind)
        .bind(xpath)
        .bind(start_offset)
        .bind(end_offset)
        .bind(content)
        .bind(common.color.unwrap_or_default())
        .bind(common.group_id)
        .bind(anchor_json)
        .bind(updated_at)
        .bind(updated_at)
        .execute(self.pool)
        .await
        .map_err(dberr)?;

        // The thread rides on the highlight: replace it wholesale.
        sqlx::query("DELETE FROM comments WHERE highlight_id = ?")
            .bind(hl.id())
            .execute(self.pool)
            .await
            .map_err(dberr)?;
        for note in hl.notes() {
            write_comment(self.pool, hl.id(), note).await?;
        }
        touch_page_of_highlight(self.pool, hl.id()).await?;
        Ok(())
    }

    async fn delete_highlight(
        &self,
        highlight_id: &str,
    ) -> Result<Option<String>, ScholiastError> {
        let owner = page_hash_of_highlight(self.pool, highlight_id).await?;
        if owner.is_some() {
            sqlx::query("DELETE FROM highlights WHERE id = ?")
                .bind(highlight_id)
                .execute(self.pool)
                .await
                .map_err(dberr)?;
            touch_page(self.pool, owner.as_deref().unwrap_or_default()).await?;
        }
        Ok(owner)
    }

    async fn set_highlight_color(
        &self,
        highlight_id: &str,
        color: &str,
    ) -> Result<Option<String>, ScholiastError> {
        let result = sqlx::query(
            "UPDATE highlights SET color = ?, updated_at = ? WHERE id = ?",
        )
        .bind(color)
        .bind(now_ms())
        .bind(highlight_id)
        .execute(self.pool)
        .await
        .map_err(dberr)?;
        if result.rows_affected() == 0 {
            return Ok(None);
        }
        touch_page_of_highlight(self.pool, highlight_id).await
    }

    async fn save_comment(&self, highlight_id: &str, note: &str) -> Result<(), ScholiastError> {
        write_comment(self.pool, highlight_id, note).await?;
        // A thread change is a change to the highlight too.
        sqlx::query("UPDATE highlights SET updated_at = ? WHERE id = ?")
            .bind(now_ms())
            .bind(highlight_id)
            .execute(self.pool)
            .await
            .map_err(dberr)?;
        touch_page_of_highlight(self.pool, highlight_id).await?;
        Ok(())
    }

    async fn list_comments(&self, highlight_id: &str) -> Result<Vec<CommentData>, ScholiastError> {
        let rows =
            sqlx::query("SELECT * FROM comments WHERE highlight_id = ? ORDER BY created_at, rowid")
                .bind(highlight_id)
                .fetch_all(self.pool)
                .await
                .map_err(dberr)?;
        Ok(rows
            .iter()
            .map(|row| CommentData {
                id: row.get("id"),
                body: row.get("body"),
                created_at: row.try_get("created_at").unwrap_or_default(),
                edited_at: row.get("edited_at"),
            })
            .collect())
    }

    async fn delete_comment(&self, comment_id: &str) -> Result<Option<String>, ScholiastError> {
        let owner = page_hash_of_comment(self.pool, comment_id).await?;
        if owner.is_some() {
            sqlx::query("DELETE FROM comments WHERE id = ?")
                .bind(comment_id)
                .execute(self.pool)
                .await
                .map_err(dberr)?;
            touch_page(self.pool, owner.as_deref().unwrap_or_default()).await?;
        }
        Ok(owner)
    }

    async fn highlight_page(
        &self,
        highlight_id: &str,
    ) -> Result<Option<String>, ScholiastError> {
        page_hash_of_highlight(self.pool, highlight_id).await
    }
}

async fn page_hash_of_highlight(
    pool: &sqlx::SqlitePool,
    highlight_id: &str,
) -> Result<Option<String>, ScholiastError> {
    sqlx::query_scalar("SELECT url_hash FROM highlights WHERE id = ?")
        .bind(highlight_id)
        .fetch_optional(pool)
        .await
        .map_err(dberr)
}

async fn page_hash_of_comment(
    pool: &sqlx::SqlitePool,
    comment_id: &str,
) -> Result<Option<String>, ScholiastError> {
    sqlx::query_scalar(
        "SELECT h.url_hash FROM comments c JOIN highlights h ON h.id = c.highlight_id
         WHERE c.id = ?",
    )
    .bind(comment_id)
    .fetch_optional(pool)
    .await
    .map_err(dberr)
}

async fn touch_page(pool: &sqlx::SqlitePool, url_hash: &str) -> Result<(), ScholiastError> {
    if url_hash.is_empty() {
        return Ok(());
    }
    sqlx::query("UPDATE pages SET updated_at = ? WHERE url_hash = ?")
        .bind(now_ms())
        .bind(url_hash)
        .execute(pool)
        .await
        .map_err(dberr)?;
    Ok(())
}

async fn touch_page_of_highlight(
    pool: &sqlx::SqlitePool,
    highlight_id: &str,
) -> Result<Option<String>, ScholiastError> {
    if let Some(hash) = page_hash_of_highlight(pool, highlight_id).await? {
        touch_page(pool, &hash).await?;
        return Ok(Some(hash));
    }
    Ok(None)
}

async fn write_comment(
    pool: &sqlx::SqlitePool,
    highlight_id: &str,
    note: &str,
) -> Result<(), ScholiastError> {
    let c = parse_comment_data(note);
    sqlx::query(
        "INSERT OR REPLACE INTO comments (id, highlight_id, body, created_at, edited_at)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&c.id)
    .bind(highlight_id)
    .bind(&c.body)
    .bind(c.created_at)
    .bind(c.edited_at)
    .execute(pool)
    .await
    .map_err(dberr)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::test_support;
    use scholiast_core::models::{AnnotationAnchor, TextQuoteAnchor};

    #[tokio::test]
    async fn highlights_with_comments_round_trip() {
        let pool = test_support::memory_pool().await;
        let store = Store::new(&pool);
        store
            .upsert_page("https://example.com/a", Some("A"))
            .await
            .unwrap();
        let page_hash = scholiast_core::normalize::url_hash(
            &scholiast_core::normalize::normalize_url("https://example.com/a"),
        );

        let note = scholiast_core::models::format_note("first!", 1000);
        let edited = scholiast_core::models::apply_edited(&note, 2000);
        let hl = HighlightData::Text(TextHighlight {
            id: "h1".into(),
            xpath: Some("/html/body/p[1]".into()),
            start_offset: Some(0),
            end_offset: Some(5),
            content: "hello".into(),
            notes: vec![note.clone(), "second<!--timestamp:3000-->".into(), edited],
            color: Some("yellow".into()),
            group_id: None,
            updated_at: Some(42),
            anchor: Some(AnnotationAnchor {
                quote: TextQuoteAnchor {
                    quote: "hello".into(),
                    prefix: String::new(),
                    suffix: String::new(),
                    occurrence: 0,
                },
                structural: None,
                image: None,
            }),
            image_edit: None,
            extra: Default::default(),
        });

        store.save_highlights(&page_hash, &[hl]).await.unwrap();
        let loaded = store.get_highlights(&page_hash).await.unwrap();
        assert_eq!(loaded.len(), 1);
        match &loaded[0].highlight {
            HighlightData::Text(t) => {
                assert_eq!(t.start_offset, Some(0));
                assert_eq!(t.anchor.as_ref().unwrap().quote.quote, "hello");
                assert_eq!(t.notes.len(), 2); // second overwrote first (same marker id 1000), plus 3000
                assert!(t.notes.contains(&"second<!--timestamp:3000-->".to_string()));
                assert!(t.notes.iter().any(|n| n.contains("<!--edited:2000-->")));
            }
            _ => panic!("expected text highlight"),
        }

        // Replacing the page drops the old threads too.
        store.save_highlights(&page_hash, &[]).await.unwrap();
        assert!(store.get_highlights(&page_hash).await.unwrap().is_empty());
    }

    fn sample_text_highlight(id: &str) -> HighlightData {
        HighlightData::Text(TextHighlight {
            id: id.into(),
            xpath: Some("/html/body/p[2]".into()),
            start_offset: Some(3),
            end_offset: Some(9),
            content: "sample".into(),
            notes: vec![],
            color: Some("yellow".into()),
            group_id: Some("g1".into()),
            updated_at: None,
            anchor: None,
            image_edit: None,
            extra: Default::default(),
        })
    }

    #[tokio::test]
    async fn single_highlight_save_recolor_delete_round_trip() {
        let pool = test_support::memory_pool().await;
        let store = Store::new(&pool);
        let page_hash = store
            .upsert_page("https://example.com/art", Some("Art"))
            .await
            .unwrap();

        store
            .save_highlight(&page_hash, &sample_text_highlight("h1"))
            .await
            .unwrap();
        let loaded = store.get_highlights(&page_hash).await.unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].highlight.id(), "h1");

        // Recolor returns the owning page hash and persists.
        assert_eq!(
            store.set_highlight_color("h1", "green").await.unwrap(),
            Some(page_hash.clone())
        );
        match &store.get_highlights(&page_hash).await.unwrap()[0].highlight {
            HighlightData::Text(t) => assert_eq!(t.color.as_deref(), Some("green")),
            _ => panic!("expected text highlight"),
        }

        // Delete cascades comments (FK) and reports the owner.
        store
            .save_comment("h1", "note<!--timestamp:11-->")
            .await
            .unwrap();
        assert_eq!(
            store.delete_highlight("h1").await.unwrap(),
            Some(page_hash.clone())
        );
        assert!(store.get_highlights(&page_hash).await.unwrap().is_empty());
        assert!(store.list_comments("h1").await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn comment_crud_preserves_marker_ids() {
        let pool = test_support::memory_pool().await;
        let store = Store::new(&pool);
        let page_hash = store.upsert_page("https://example.com/c", None).await.unwrap();
        store
            .save_highlight(&page_hash, &sample_text_highlight("h9"))
            .await
            .unwrap();

        let marker = "hello world<!--timestamp:1700000000000-->";
        store.save_comment("h9", marker).await.unwrap();
        let comments = store.list_comments("h9").await.unwrap();
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].id, "1700000000000");
        assert_eq!(comments[0].body, "hello world");
        assert_eq!(comments[0].edited_at, None);

        // Same timestamp = same id: an edit replaces, never duplicates.
        store
            .save_comment("h9", "edited body<!--timestamp:1700000000000--><!--edited:1700000005000-->")
            .await
            .unwrap();
        let comments = store.list_comments("h9").await.unwrap();
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].body, "edited body");
        assert_eq!(comments[0].edited_at, Some(1700000005000));

        // Delete reports the owning page for event routing.
        assert_eq!(
            store.delete_comment("1700000000000").await.unwrap(),
            Some(page_hash)
        );
        assert!(store.delete_comment("nope").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn deleting_page_cascades_highlights_and_comments() {
        let pool = test_support::memory_pool().await;
        let store = Store::new(&pool);
        let page_hash = store.upsert_page("https://example.com/d", None).await.unwrap();
        store
            .save_highlight(&page_hash, &sample_text_highlight("hx"))
            .await
            .unwrap();
        store.save_comment("hx", "gone<!--timestamp:5-->").await.unwrap();

        assert!(store.delete_page(&page_hash).await.unwrap());
        assert!(store.get_highlights(&page_hash).await.unwrap().is_empty());
        assert!(store.list_comments("hx").await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn drawings_and_diagrams_round_trip() {
        let pool = test_support::memory_pool().await;
        let store = Store::new(&pool);
        let stroke = PageDrawing {
            id: "s1".into(),
            color: Some("#facc15".into()),
            width: Some(3.0),
            points: vec![10.0, 20.0, 30.0, 40.0],
            updated_at: Some(7),
            extra: Default::default(),
        };
        store
            .save_drawings("pagehash", &[stroke.clone()])
            .await
            .unwrap();
        assert_eq!(store.get_drawings("pagehash").await.unwrap(), vec![stroke]);
        assert!(store.get_drawings("other").await.unwrap().is_empty());

        let d = DiagramMeta {
            id: "d1".into(),
            scene_data: Some(serde_json::json!({"elements": []})),
            updated_at: Some(9),
            drive_id: Some("png-blob".into()),
            scene_drive_id: None,
            pasted: false,
            image_for_highlight: Some("h1".into()),
            page_url: None,
            extra: Default::default(),
        };
        store.save_diagram(Some("pagehash"), &d).await.unwrap();
        assert_eq!(store.get_diagram("d1").await.unwrap().unwrap(), d);
        store.delete_diagram("d1").await.unwrap();
        assert!(store.get_diagram("d1").await.unwrap().is_none());
    }
}
