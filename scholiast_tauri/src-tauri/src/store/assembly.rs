//! Read-side queries assembling a [`PageRecord`] from the store tables — the
//! sync engine's view of local state (`assemble_local_page`) plus the hash
//! enumeration a full reconcile walks. Writes go through `sync::engine`.

use scholiast_core::error::ScholiastError;
use scholiast_core::models::{DiagramMeta, PageRecord};

use super::Store;
use crate::store::highlights::{DrawingsRepo, HighlightsRepo};
use crate::store::video_items::VideoItemsRepo;

/// Builds the per-page record exactly as the extension's sharded stores would
/// produce it: highlights (+ comment threads), freehand drawings, video items
/// and diagram pointers. Tombstones are never stored locally — they live in
/// Drive and in `sync_snapshots`.
pub async fn assemble_local_page(
    store: &Store<'_>,
    url_hash: &str,
) -> Result<PageRecord, ScholiastError> {
    let mut record = PageRecord::empty("");

    // Page identity: reader pages first, then video pages.
    let page = crate::store::highlights::PagesRepo::get_page(store, url_hash).await?;
    let video = crate::store::videos::VideosRepo::get_video(store, url_hash).await?;
    let url = page
        .as_ref()
        .map(|p| p.url.clone())
        .or_else(|| video.as_ref().map(|v| v.url.clone()))
        .unwrap_or_default();
    record.url = url;
    record.title = page
        .as_ref()
        .and_then(|p| p.title.clone())
        .or_else(|| video.as_ref().and_then(|v| v.title.clone()))
        .filter(|t| !t.is_empty());
    record.video_id = video.as_ref().and_then(|v| v.video_id.clone());

    record.highlights = store
        .get_highlights(url_hash)
        .await?
        .into_iter()
        .map(|row| row.highlight)
        .collect();

    record.drawings = store
        .get_drawings(url_hash)
        .await?
        .into_iter()
        .map(|mut stroke| {
            // NOT NULL columns round-trip None as ""/0.0 — normalize back so
            // repeated assemble cycles fingerprint identically.
            if stroke.color.as_deref().is_some_and(str::is_empty) {
                stroke.color = None;
            }
            if stroke.width == Some(0.0) {
                stroke.width = None;
            }
            stroke
        })
        .collect();

    record.video_items = store.get_video_items(url_hash).await?;

    record.diagrams = diagrams_for_page(store, url_hash).await?;

    Ok(record)
}

/// Diagrams stamped to a page (the `diagrams` table is global, keyed by id).
pub async fn diagrams_for_page(
    store: &Store<'_>,
    url_hash: &str,
) -> Result<Vec<DiagramMeta>, ScholiastError> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT * FROM diagrams WHERE page_url_hash = ? ORDER BY updated_at ASC, id ASC",
    )
    .bind(url_hash)
    .fetch_all(store.pool)
    .await
    .map_err(super::dberr)?;

    Ok(rows
        .iter()
        .map(|row| DiagramMeta {
            id: row.get("id"),
            scene_data: row
                .try_get::<Option<String>, _>("scene_json")
                .ok()
                .flatten()
                .and_then(|s| serde_json::from_str(&s).ok()),
            updated_at: row.try_get("updated_at").ok(),
            drive_id: row.try_get("png_drive_id").ok().flatten(),
            scene_drive_id: row.try_get("scene_drive_id").ok().flatten(),
            pasted: row.try_get::<i64, _>("pasted").unwrap_or_default() != 0,
            image_for_highlight: row.try_get("image_for_highlight").ok().flatten(),
            page_url: None,
            extra: Default::default(),
        })
        .collect())
}

/// Every page hash with any synced content or bookkeeping: reader pages ∪
/// video pages ∪ sync meta ∪ snapshots.
pub async fn list_page_hashes(store: &Store<'_>) -> Result<Vec<String>, ScholiastError> {
    let hashes: Vec<String> = sqlx::query_scalar(
        "SELECT url_hash FROM pages
         UNION SELECT url_hash FROM videos
         UNION SELECT url_hash FROM sync_meta
         UNION SELECT url_hash FROM sync_snapshots",
    )
    .fetch_all(store.pool)
    .await
    .map_err(super::dberr)?;
    Ok(hashes)
}

/// Best-effort URL for progress events; the hash itself has no meaning to a
/// user, so misses degrade to an empty string.
pub async fn page_url_of(store: &Store<'_>, url_hash: &str) -> String {
    let page_url: Option<String> =
        sqlx::query_scalar("SELECT url FROM pages WHERE url_hash = ?")
            .bind(url_hash)
            .fetch_optional(store.pool)
            .await
            .ok()
            .flatten();
    if let Some(url) = page_url {
        return url;
    }
    sqlx::query_scalar("SELECT url FROM videos WHERE url_hash = ?")
        .bind(url_hash)
        .fetch_optional(store.pool)
        .await
        .ok()
        .flatten()
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::videos::VideosRepo;
    use scholiast_core::models::{
        AnnotationAnchor, PageDrawing, TextHighlight, TextQuoteAnchor, VideoItem, VideoItemKind,
    };
    use scholiast_core::models::format_note;

    #[tokio::test]
    async fn assembles_video_page_with_items_and_diagrams() {
        let pool = crate::store::test_support::memory_pool().await;
        let store = Store::new(&pool);
        let summary = store
            .upsert_video("https://youtu.be/abc123", Some("Lecture"), Some("abc123"))
            .await
            .unwrap();
        let hash = summary.url_hash.clone();

        store
            .save_video_item(
                &hash,
                &VideoItem {
                    id: "it1".into(),
                    kind: VideoItemKind::Note,
                    video_time: 30.0,
                    frame: None,
                    markup: None,
                    notes: vec![format_note("note", 100)],
                    updated_at: Some(101),
                    time_end: None,
                    quote: None,
                    color: None,
                    anchor: None,
                    excalidraw_scene: None,
                    extra: Default::default(),
                },
            )
            .await
            .unwrap();

        let record = assemble_local_page(&store, &hash).await.unwrap();
        assert_eq!(record.version, 2);
        assert_eq!(record.url, "https://youtu.be/abc123");
        assert_eq!(record.title.as_deref(), Some("Lecture"));
        assert_eq!(record.video_id.as_deref(), Some("abc123"));
        assert_eq!(record.video_items.len(), 1);
        assert_eq!(record.video_items[0].id, "it1");
        assert!(record.highlights.is_empty());
        assert!(record.tombstones.highlights.is_empty());
    }

    #[tokio::test]
    async fn assembles_reader_page_and_normalizes_drawing_defaults() {
        use crate::store::highlights::PagesRepo;
        let pool = crate::store::test_support::memory_pool().await;
        let store = Store::new(&pool);
        let hash =
            PagesRepo::upsert_page(&store, "https://example.com/article", Some("A"))
                .await
                .unwrap();

        let highlight = scholiast_core::models::HighlightData::Text(TextHighlight {
            id: "h1".into(),
            xpath: Some("/html/body/p[1]".into()),
            start_offset: Some(0),
            end_offset: Some(5),
            content: "hello".into(),
            notes: vec![],
            color: Some("yellow".into()),
            group_id: None,
            updated_at: Some(10),
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
        store.save_highlights(&hash, &[highlight]).await.unwrap();

        // color=None / width=None coerce through the NOT NULL columns.
        store
            .save_drawings(
                &hash,
                &[PageDrawing {
                    id: "s1".into(),
                    color: None,
                    width: None,
                    points: vec![1.0, 2.0],
                    updated_at: Some(7),
                    extra: Default::default(),
                }],
            )
            .await
            .unwrap();

        let record = assemble_local_page(&store, &hash).await.unwrap();
        assert_eq!(record.url, "https://example.com/article");
        assert_eq!(record.highlights.len(), 1);
        assert_eq!(record.drawings.len(), 1);
        assert_eq!(record.drawings[0].color, None, "empty color normalized");
        assert_eq!(record.drawings[0].width, None, "zero width normalized");

        let hashes = list_page_hashes(&store).await.unwrap();
        assert!(hashes.contains(&hash));
    }

    /// Cross-client contract (task-32): the assembled record of an annotated
    /// article must serialize with EXACTLY the field names the browser
    /// extension reads (`src/utils/highlighter.ts` HighlightData /
    /// TextHighlightData + `shared/anchor.ts` AnnotationAnchor). The
    /// extension's dashboard and Obsidian plugin consume these files verbatim.
    #[tokio::test]
    async fn annotated_article_record_serializes_with_extension_field_names() {
        use crate::store::highlights::PagesRepo;
        use scholiast_core::models::{AnchorSurface, StructuralAnchor};
        use serde_json::json;

        let pool = crate::store::test_support::memory_pool().await;
        let store = Store::new(&pool);
        let hash = PagesRepo::upsert_page(
            &store,
            "https://example.com/deep-dive",
            Some("Deep Dive"),
        )
        .await
        .unwrap();

        let anchor = |quote: &str| AnnotationAnchor {
            quote: TextQuoteAnchor {
                quote: quote.into(),
                prefix: "the ".into(),
                suffix: " end".into(),
                occurrence: 1,
            },
            structural: Some(StructuralAnchor {
                surface: AnchorSurface::Web,
                xpath: "./article/p[1]".into(),
                start_offset: 4,
                end_offset: 9,
            }),
            image: None,
        };
        let make = |id: &str, quote: &str, group: Option<&str>| {
            scholiast_core::models::HighlightData::Text(TextHighlight {
                id: id.into(),
                xpath: Some("./article/p[1]".into()),
                start_offset: Some(4),
                end_offset: Some(9),
                content: quote.into(),
                notes: if id == "h1" {
                    vec![format_note("first look", 1724000000000)]
                } else {
                    vec![]
                },
                color: Some("green".into()),
                group_id: group.map(str::to_string),
                updated_at: Some(1724000001000),
                anchor: Some(anchor(quote)),
                image_edit: None,
                extra: Default::default(),
            })
        };
        store
            .save_highlights(
                &hash,
                &[make("h1", "hello", Some("g1")), make("h2", "world", Some("g1"))],
            )
            .await
            .unwrap();

        let record = assemble_local_page(&store, &hash).await.unwrap();
        assert_eq!(record.version, 2);

        let json = serde_json::to_value(&record).unwrap();
        // Record-level names (shared/merge.ts PageRecord v2).
        assert_eq!(json["version"], 2);
        assert_eq!(json["url"], "https://example.com/deep-dive");
        assert_eq!(json["title"], "Deep Dive");
        assert!(json["highlights"].is_array());
        assert_eq!(json["videoItems"], json!([]));
        assert_eq!(json["drawings"], json!([]));
        assert_eq!(json["diagrams"], json!([]));
        assert!(json["tombstones"].is_object());

        let hl = &json["highlights"][0];
        // Extension HighlightData / TextHighlightData names.
        assert_eq!(hl["type"], "text");
        assert!(hl["id"].is_string());
        assert_eq!(hl["content"], "hello");
        assert_eq!(hl["notes"][0], "first look<!--timestamp:1724000000000-->");
        assert_eq!(hl["color"], "green");
        assert_eq!(hl["groupId"], "g1");
        assert_eq!(hl["updatedAt"], 1724000001000i64);
        assert!(hl["xpath"].is_string());
        assert!(hl["startOffset"].is_i64());
        assert!(hl["endOffset"].is_i64());
        // shared/anchor.ts AnnotationAnchor names.
        assert_eq!(hl["anchor"]["quote"]["quote"], "hello");
        assert_eq!(hl["anchor"]["quote"]["prefix"], "the ");
        assert_eq!(hl["anchor"]["quote"]["suffix"], " end");
        assert_eq!(hl["anchor"]["quote"]["occurrence"], 1);
        assert_eq!(hl["anchor"]["structural"]["surface"], "web");
        assert_eq!(hl["anchor"]["structural"]["xpath"], "./article/p[1]");
        assert_eq!(hl["anchor"]["structural"]["startOffset"], 4);
        assert_eq!(hl["anchor"]["structural"]["endOffset"], 9);
    }
}
