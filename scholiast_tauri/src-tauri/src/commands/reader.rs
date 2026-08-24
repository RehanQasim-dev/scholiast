//! Reader CRUD over IPC (task 23): articles + per-item highlights/comments.
//! Every write emits `db://changed:<table>` so TanStack Query invalidates
//! precisely (plan §3.3 / §3.4).
//!
//! `add_article` runs the task-25 extraction pipeline (fetch → Readability →
//! sanitize) before storing. Signature stays `add_article(url) ->
//! { urlHash, title }`.

use scholiast_core::error::{Reply, ScholiastError};
use scholiast_core::models::{CommentData, HighlightData};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, State};

use crate::store::highlights::{AnnotationRepo, HighlightsRepo, PagesRepo};
use crate::store::pages::{ArticleSummary, ArticlesRepo};
// task-27: every reader mutation marks its page dirty for the sync scheduler.
use crate::store::sync_meta::SyncQueueRepo;
use crate::store::{Store, dberr, now_ms};
use crate::state::AppState;

fn emit_changed(app: &AppHandle, table: &str, url_hash: &str) {
    let _ = app.emit(
        format!("db://changed:{table}").as_str(),
        json!({ "table": table, "urlHash": url_hash }),
    );
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddArticleResult {
    pub url_hash: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageView {
    pub url_hash: String,
    pub url: String,
    pub title: Option<String>,
    pub body: Option<String>,
    pub captured_at: Option<i64>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentView {
    pub id: String,
    pub body: String,
    pub created_at: i64,
    pub edited_at: Option<i64>,
}

impl From<CommentData> for CommentView {
    fn from(c: CommentData) -> Self {
        CommentView {
            id: c.id,
            body: c.body,
            created_at: c.created_at,
            edited_at: c.edited_at,
        }
    }
}

/// Last-resort title when extraction yields none:
/// `https://en.wikipedia.org/wiki/Highlighter?a=b#x` ->
/// `en.wikipedia.org/wiki/Highlighter`.
fn derive_title_from_url(url: &str) -> String {
    url.split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(url)
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim_end_matches('/')
        .to_string()
}

/// Full capture path for one URL: pipeline (fetch → extract → sanitize,
/// off-thread), then upsert the page row. The explicit override wins over the
/// extractor title; the extractor wins over a URL-derived fallback.
///
/// Re-capture is idempotent: `pages.url_hash` keys the normalized URL, so the
/// UPDATE refreshes body + `captured_at` on the single existing row. This
/// deliberately bypasses [`PagesRepo::set_source_markdown`], whose COALESCE
/// keeps an already-captured body immutable — a re-capture must overwrite.
async fn capture_article(
    store: &Store<'_>,
    url: &str,
    title_override: Option<&str>,
) -> Result<AddArticleResult, ScholiastError> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(ScholiastError::InvalidInput("url is required".into()));
    }
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err(ScholiastError::InvalidInput(
            "url must be an absolute http(s) address".into(),
        ));
    }
    let extracted = crate::reader::extract::capture_article_html(trimmed).await?;
    let title = match title_override.map(str::trim).filter(|t| !t.is_empty()) {
        Some(explicit) => explicit.to_string(),
        None if !extracted.title.is_empty() => extracted.title.clone(),
        None => derive_title_from_url(trimmed),
    };
    let url_hash = store.upsert_page(trimmed, Some(&title)).await?;
    sqlx::query("UPDATE pages SET source_markdown = ?, captured_at = ? WHERE url_hash = ?")
        .bind(&extracted.body_html)
        .bind(now_ms())
        .bind(&url_hash)
        .execute(store.pool)
        .await
        .map_err(dberr)?;
    Ok(AddArticleResult { url_hash, title })
}

#[tauri::command]
pub async fn add_article(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    title: Option<String>,
) -> Result<Reply<AddArticleResult>, ScholiastError> {
    let result = capture_article(&Store::new(&state.pool), &url, title.as_deref()).await?;
    emit_changed(&app, "pages", &result.url_hash);
    Ok(Reply::new(result))
}

#[tauri::command]
pub async fn list_articles(
    state: State<'_, AppState>,
) -> Result<Reply<Vec<ArticleSummary>>, ScholiastError> {
    Ok(Reply::new(
        Store::new(&state.pool).list_articles().await?,
    ))
}

#[tauri::command]
pub async fn get_page(
    state: State<'_, AppState>,
    url_hash: String,
) -> Result<Reply<Option<PageView>>, ScholiastError> {
    let page = Store::new(&state.pool).get_page(&url_hash).await?;
    Ok(Reply::new(page.map(|p| PageView {
        url_hash: p.url_hash,
        url: p.url,
        title: p.title,
        body: p.source_markdown.filter(|b| !b.is_empty()),
        captured_at: p.captured_at,
        updated_at: p.updated_at,
    })))
}

#[tauri::command]
pub async fn delete_article(
    app: AppHandle,
    state: State<'_, AppState>,
    url_hash: String,
) -> Result<Reply<bool>, ScholiastError> {
    let deleted = Store::new(&state.pool).delete_page(&url_hash).await?;
    if deleted {
        emit_changed(&app, "pages", &url_hash);
        // task-27: the emptied page pushes its entity tombstones.
        Store::new(&state.pool).enqueue(&url_hash).await?;
    }
    Ok(Reply::new(deleted))
}

#[tauri::command]
pub async fn save_highlight(
    app: AppHandle,
    state: State<'_, AppState>,
    url_hash: String,
    highlight: HighlightData,
) -> Result<Reply<()>, ScholiastError> {
    Store::new(&state.pool)
        .save_highlight(&url_hash, &highlight)
        .await?;
    emit_changed(&app, "highlights", &url_hash);
    Store::new(&state.pool).enqueue(&url_hash).await?;
    Ok(Reply::new(()))
}

#[tauri::command]
pub async fn list_highlights(
    state: State<'_, AppState>,
    url_hash: String,
) -> Result<Reply<Vec<HighlightData>>, ScholiastError> {
    let rows = Store::new(&state.pool).get_highlights(&url_hash).await?;
    Ok(Reply::new(rows.into_iter().map(|r| r.highlight).collect()))
}

#[tauri::command]
pub async fn delete_highlight(
    app: AppHandle,
    state: State<'_, AppState>,
    highlight_id: String,
) -> Result<Reply<bool>, ScholiastError> {
    let owner = Store::new(&state.pool).delete_highlight(&highlight_id).await?;
    let deleted = owner.is_some();
    if let Some(hash) = owner {
        emit_changed(&app, "highlights", &hash);
        Store::new(&state.pool).enqueue(&hash).await?;
    }
    Ok(Reply::new(deleted))
}

#[tauri::command]
pub async fn update_highlight_color(
    app: AppHandle,
    state: State<'_, AppState>,
    highlight_id: String,
    color: String,
) -> Result<Reply<bool>, ScholiastError> {
    let owner = Store::new(&state.pool)
        .set_highlight_color(&highlight_id, &color)
        .await?;
    let updated = owner.is_some();
    if let Some(hash) = owner {
        emit_changed(&app, "highlights", &hash);
        Store::new(&state.pool).enqueue(&hash).await?;
    }
    Ok(Reply::new(updated))
}

/// Saves one comment from its inline-marker string
/// (`body<!--timestamp:N-->`, optionally `<!--edited:M-->`); the marker id is
/// preserved exactly — sync merge keys off it.
#[tauri::command]
pub async fn save_comment(
    app: AppHandle,
    state: State<'_, AppState>,
    highlight_id: String,
    note: String,
) -> Result<Reply<CommentView>, ScholiastError> {
    let store = Store::new(&state.pool);
    store.save_comment(&highlight_id, &note).await?;
    let parsed = scholiast_core::models::parse_comment(&note);
    if let Some(hash) = store.highlight_page(&highlight_id).await? {
        emit_changed(&app, "comments", &hash);
        store.enqueue(&hash).await?;
    }
    Ok(Reply::new(parsed.into()))
}

#[tauri::command]
pub async fn list_comments(
    state: State<'_, AppState>,
    highlight_id: String,
) -> Result<Reply<Vec<CommentView>>, ScholiastError> {
    let comments: Vec<CommentView> = Store::new(&state.pool)
        .list_comments(&highlight_id)
        .await?
        .into_iter()
        .map(Into::into)
        .collect();
    Ok(Reply::new(comments))
}

#[tauri::command]
pub async fn delete_comment(
    app: AppHandle,
    state: State<'_, AppState>,
    comment_id: String,
) -> Result<Reply<bool>, ScholiastError> {
    let owner = Store::new(&state.pool).delete_comment(&comment_id).await?;
    let deleted = owner.is_some();
    if let Some(hash) = owner {
        emit_changed(&app, "comments", &hash);
        Store::new(&state.pool).enqueue(&hash).await?;
    }
    Ok(Reply::new(deleted))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::highlights::HighlightsRepo;
    use crate::store::test_support;
    use scholiast_core::models::TextHighlight;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const DIRTY_ARTICLE: &str = include_str!(
        "../../../crates/core/tests/fixtures/reader/dirty-article.html"
    );
    const JUNK_PAGE: &str =
        include_str!("../../../crates/core/tests/fixtures/reader/junk-nav-page.html");

    /// Serves `/a`; the returned `MockServer` must be held for the whole
    /// test — dropping it frees the port while sibling tests run, and a
    /// rebound port would serve another test's mock.
    async fn mount(body: &str, status: u16) -> (MockServer, String) {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/a"))
            .respond_with(
                ResponseTemplate::new(status)
                    .set_body_string(body)
                    .insert_header("Content-Type", "text/html; charset=utf-8"),
            )
            .mount(&server)
            .await;
        let url = format!("{}/a", server.uri());
        (server, url)
    }

    #[test]
    fn stub_title_comes_from_host_and_path() {
        assert_eq!(
            derive_title_from_url("https://en.wikipedia.org/wiki/Highlighter?action=edit#top"),
            "en.wikipedia.org/wiki/Highlighter"
        );
        assert_eq!(derive_title_from_url("https://example.com/"), "example.com");
    }

    #[tokio::test]
    async fn capture_stores_sanitized_body_with_extractor_title() {
        let (_server, url) = mount(DIRTY_ARTICLE, 200).await;
        let pool = test_support::memory_pool().await;
        let store = Store::new(&pool);

        let result = capture_article(&store, &url, None).await.unwrap();
        assert_eq!(result.title, "The Hidden Lives of Highlighters");

        let (title, body): (Option<String>, Option<String>) =
            sqlx::query_as("SELECT title, source_markdown FROM pages WHERE url_hash = ?")
                .bind(&result.url_hash)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(title.as_deref(), Some(result.title.as_str()));
        let body = body.expect("body stored");
        assert!(body.contains("<h2>"), "article body: {body}");
        assert!(body.contains("<blockquote>"));
        assert!(!body.contains("<script"));
        assert!(!body.contains("onclick"));
        assert!(!body.contains("<form"));
        assert!(
            body.contains("/images/header.jpg"),
            "relative img made absolute against capture url"
        );
    }

    #[tokio::test]
    async fn recapture_updates_row_in_place_without_duplicates() {
        let (_server, url) = mount(DIRTY_ARTICLE, 200).await;
        let pool = test_support::memory_pool().await;
        let store = Store::new(&pool);

        let first = capture_article(&store, &url, None).await.unwrap();
        let captured_first: Option<i64> =
            sqlx::query_scalar("SELECT captured_at FROM pages WHERE url_hash = ?")
                .bind(&first.url_hash)
                .fetch_one(&pool)
                .await
                .unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        let second = capture_article(&store, &url, None).await.unwrap();
        assert_eq!(first.url_hash, second.url_hash);

        let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pages")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rows, 1, "re-capture must not duplicate the page");
        let captured_second: i64 =
            sqlx::query_scalar("SELECT captured_at FROM pages WHERE url_hash = ?")
                .bind(&first.url_hash)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(captured_second > captured_first.unwrap(), "captured_at refreshed");
    }

    #[tokio::test]
    async fn blocked_capture_maps_to_typed_fetch_blocked() {
        let (_server, url) = mount("", 403).await;
        let pool = test_support::memory_pool().await;
        let store = Store::new(&pool);
        let err = capture_article(&store, &url, None).await.unwrap_err();
        assert!(matches!(err, ScholiastError::FetchBlocked(403)), "{err}");
        assert_eq!(err.kind(), "fetchBlocked");
        // Nothing was persisted for a failed capture.
        let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pages")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rows, 0);
    }

    #[tokio::test]
    async fn junk_page_maps_to_not_readable() {
        let (_server, url) = mount(JUNK_PAGE, 200).await;
        let pool = test_support::memory_pool().await;
        let store = Store::new(&pool);
        let err = capture_article(&store, &url, None).await.unwrap_err();
        assert!(matches!(err, ScholiastError::NotReadable(_)), "{err}");
    }

    #[tokio::test]
    async fn non_http_urls_are_rejected_up_front() {
        let pool = test_support::memory_pool().await;
        let store = Store::new(&pool);
        for bad in ["", "   ", "ftp://example.com/x", "javascript:alert(1)"] {
            let err = capture_article(&store, bad, None).await.unwrap_err();
            assert!(matches!(err, ScholiastError::InvalidInput(_)), "{bad}: {err}");
        }
    }

    #[tokio::test]
    async fn explicit_title_override_wins_over_extractor() {
        let (_server, url) = mount(DIRTY_ARTICLE, 200).await;
        let pool = test_support::memory_pool().await;
        let store = Store::new(&pool);
        let result = capture_article(&store, &url, Some("My reading copy"))
            .await
            .unwrap();
        assert_eq!(result.title, "My reading copy");
        let title: Option<String> =
            sqlx::query_scalar("SELECT title FROM pages WHERE url_hash = ?")
                .bind(&result.url_hash)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(title.as_deref(), Some("My reading copy"));
    }

    #[tokio::test]
    async fn reply_envelope_wraps_page_view() {
        let pool = test_support::memory_pool().await;
        let store = Store::new(&pool);
        let hash = store.upsert_page("https://example.com/r", Some("R")).await.unwrap();

        let page = store.get_page(&hash).await.unwrap().unwrap();
        let view = Reply::new(Some(PageView {
            url_hash: page.url_hash,
            url: page.url,
            title: page.title,
            body: page.source_markdown,
            captured_at: page.captured_at,
            updated_at: page.updated_at,
        }));
        let value = serde_json::to_value(&view).unwrap();
        assert_eq!(value["ok"], json!(true));
        assert_eq!(value["data"]["urlHash"], json!(hash));
        assert_eq!(value["data"]["title"], json!("R"));
        assert_eq!(value["data"]["capturedAt"], json!(null));

        // Command-shaped highlight save through the same repo path the
        // handler uses, then listed back in extension shape (`type:"text"`).
        store
            .save_highlight(
                &hash,
                &HighlightData::Text(TextHighlight {
                    id: "77".into(),
                    xpath: None,
                    start_offset: Some(0),
                    end_offset: Some(4),
                    content: "wiki".into(),
                    notes: vec!["hi<!--timestamp:5-->".into()],
                    color: Some("red".into()),
                    group_id: None,
                    updated_at: None,
                    anchor: None,
                    image_edit: None,
                    extra: Default::default(),
                }),
            )
            .await
            .unwrap();
        let listed: Vec<serde_json::Value> = store
            .get_highlights(&hash)
            .await
            .unwrap()
            .into_iter()
            .map(|r| serde_json::to_value(&r.highlight).unwrap())
            .collect();
        assert_eq!(listed[0]["type"], json!("text"));
        assert_eq!(listed[0]["startOffset"], json!(0));
        assert_eq!(listed[0]["notes"], json!(["hi<!--timestamp:5-->"]));
        assert_eq!(
            serde_json::to_value(Reply::new(listed.clone())).unwrap()["ok"],
            json!(true)
        );

        // Comment listing rides the same envelope shape.
        let comments: Vec<CommentView> = store
            .list_comments("77")
            .await
            .unwrap()
            .into_iter()
            .map(Into::into)
            .collect();
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].id, "5");
        assert_eq!(
            serde_json::to_value(Reply::new(comments)).unwrap()["data"][0]["createdAt"],
            json!(5)
        );
    }

    /// Task-32 exit evidence: the full reader loop against a REAL article —
    /// live fetch → extraction → persist → highlight in all three colors →
    /// comment → recolor → delete + restore (the undo path) → re-read.
    /// Ignored by default so `cargo test` stays hermetic; run explicitly:
    ///   cargo test -p scholiast --lib real_article -- --ignored --nocapture
    #[tokio::test]
    #[ignore = "hits the real network (en.wikipedia.org)"]
    async fn real_article_extract_annotate_persist_loop() {
        use crate::store::highlights::AnnotationRepo;
        use crate::store::highlights::PagesRepo;
        use scholiast_core::models::{AnnotationAnchor, TextQuoteAnchor};

        let pool = test_support::memory_pool().await;
        let store = Store::new(&pool);

        // 1. Real capture: DNS, TLS, HTML, readability, sanitize.
        // (example.com itself has no article-like content and is correctly
        // rejected with NotReadable — a stable article page is required.)
        let added = capture_article(&store, "https://en.wikipedia.org/wiki/Highlighter", None)
            .await
            .expect("capture wikipedia Highlighter");
        println!("e2e: title={:?} hash={}", added.title, added.url_hash);
        let page = PagesRepo::get_page(&store, &added.url_hash)
            .await
            .unwrap()
            .expect("page row");
        let body = page.source_markdown.expect("sanitized body stored");
        assert!(!body.contains("<script"));
        println!("e2e: body {} bytes", body.len());

        // 2. Three highlights, one per color (as the UI's swatches would).
        let anchor_for = |quote: &str| AnnotationAnchor {
            quote: TextQuoteAnchor {
                quote: quote.into(),
                prefix: String::new(),
                suffix: String::new(),
                occurrence: 0,
            },
            structural: None,
            image: None,
        };
        for (id, quote, color) in [
            ("hl-y", "Example Domain", "yellow"),
            ("hl-r", "illustrative examples", "red"),
            ("hl-g", "documentation", "green"),
        ] {
            store
                .save_highlight(
                    &added.url_hash,
                    &HighlightData::Text(TextHighlight {
                        id: id.into(),
                        xpath: None,
                        start_offset: None,
                        end_offset: None,
                        content: quote.into(),
                        notes: vec![],
                        color: Some(color.into()),
                        group_id: None,
                        updated_at: Some(crate::store::now_ms()),
                        anchor: Some(anchor_for(quote)),
                        image_edit: None,
                        extra: Default::default(),
                    }),
                )
                .await
                .unwrap();
        }

        // 3. Comment on the first (inline-marker identity preserved).
        let note = scholiast_core::models::format_note("read later", 1_724_000_000_000);
        AnnotationRepo::save_comment(&store, "hl-y", &note).await.unwrap();

        // 4. Recolor yellow→green through the command-layer repo path.
        AnnotationRepo::set_highlight_color(&store, "hl-y", "green")
            .await
            .unwrap();

        // 5. Delete-with-undo: snapshot → delete → restore same payload.
        let before = HighlightsRepo::get_highlights(&store, &added.url_hash)
            .await
            .unwrap();
        let snap = before.iter().find(|r| r.highlight.id() == "hl-r").unwrap();
        let snap_json = serde_json::to_string(&snap.highlight).unwrap();
        AnnotationRepo::delete_highlight(&store, "hl-r").await.unwrap();
        assert!(HighlightsRepo::get_highlights(&store, &added.url_hash)
            .await
            .unwrap()
            .iter()
            .all(|r| r.highlight.id() != "hl-r"));
        let restored: HighlightData = serde_json::from_str(&snap_json).unwrap();
        store
            .save_highlight(&added.url_hash, &restored)
            .await
            .unwrap();

        // 6. Re-read everything after the round of mutations.
        let mut final_hls = HighlightsRepo::get_highlights(&store, &added.url_hash)
            .await
            .unwrap();
        final_hls.sort_by(|a, b| a.highlight.id().cmp(b.highlight.id()));
        let colors: Vec<&str> = final_hls
            .iter()
            .map(|r| match &r.highlight {
                HighlightData::Text(t) => t.color.as_deref().unwrap_or(""),
                HighlightData::Element(e) => e.color.as_deref().unwrap_or(""),
            })
            .collect();
        // Sorted by id: hl-g kept its green; hl-r came back red via the
        // undo restore (snapshot byte-equal); hl-y was recolored to green.
        assert_eq!(colors, vec!["green", "red", "green"]);
        let comments = AnnotationRepo::list_comments(&store, "hl-y").await.unwrap();
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].body, "read later");
        assert_eq!(comments[0].id, "1724000000000");
        println!("e2e: loop complete — 3 highlights, comment, recolor, undo-restore");
    }
}
