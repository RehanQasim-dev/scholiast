//! Task-27 round-trip proof: reader-shaped records survive the full sync
//! spine — `assemble_local_page` → 3-way merge → `apply_page` → assemble —
//! with comments (inline-marker ids intact), drawings, diagram pointers and
//! tombstones behaving exactly as the extension's Drive layout expects.
//!
//! The apply/assemble logic itself lives in [`super::engine`] and
//! [`crate::store::assembly`]; this module exists so every reader-specific
//! guarantee has one testable home.

#[cfg(test)]
mod tests {
    use scholiast_core::merge::{fingerprint, merge_page_record};
    use scholiast_core::models::{
        AnnotationAnchor, ElementHighlight, HighlightData, PageDrawing, PageRecord, TextHighlight,
        TextQuoteAnchor,
    };

    use crate::store::assembly::assemble_local_page;
    use crate::store::highlights::{AnnotationRepo, DrawingsRepo, HighlightsRepo, PagesRepo};
    use crate::store::sync_meta::{SnapshotsRepo, SyncMetaRepo};
    use crate::store::test_support::memory_pool;
    use crate::store::Store;
    use crate::sync::engine::apply_page;

    const URL: &str = "https://example.com/article";
    /// Fixed merge clock (ms): later than every entity version below, so
    /// tombstone GC never fires mid-test.
    const NOW: i64 = 1_700_000_020_000;

    fn text_hl(
        id: &str,
        content: &str,
        color: &str,
        updated_at: i64,
        anchor: Option<AnnotationAnchor>,
        notes: Vec<String>,
        group_id: Option<&str>,
    ) -> HighlightData {
        HighlightData::Text(TextHighlight {
            id: id.into(),
            xpath: Some("/html/body/p[1]".into()),
            start_offset: Some(3),
            end_offset: Some(3 + content.len() as i64),
            content: content.into(),
            notes,
            color: Some(color.into()),
            group_id: group_id.map(str::to_string),
            updated_at: Some(updated_at),
            anchor,
            image_edit: None,
            extra: Default::default(),
        })
    }

    fn anchor_for(quote: &str) -> AnnotationAnchor {
        AnnotationAnchor {
            quote: TextQuoteAnchor {
                quote: quote.into(),
                prefix: "before ".into(),
                suffix: " after".into(),
                occurrence: 1,
            },
            structural: None,
            image: None,
        }
    }

    fn element_hl(id: &str, color: &str, updated_at: i64) -> HighlightData {
        HighlightData::Element(ElementHighlight {
            id: id.into(),
            xpath: Some("/html/body/img[1]".into()),
            content: "<img src=\"pic.jpg\">".into(),
            notes: vec![],
            color: Some(color.into()),
            group_id: None,
            updated_at: Some(updated_at),
            anchor: None,
            image_edit: None,
            extra: Default::default(),
        })
    }

    fn sorted_ids(record: &PageRecord) -> Vec<String> {
        let mut v: Vec<String> = record.highlights.iter().map(|h| h.id().to_string()).collect();
        v.sort();
        v
    }

    /// Order-canonical view for fingerprint comparisons: the DB orders
    /// highlights by `created_at,id` while the merge orders by first-seen;
    /// neither is sync truth, so equality is asserted modulo array order.
    fn canonical(record: &PageRecord) -> PageRecord {
        let mut r = record.clone();
        r.highlights.sort_by(|a, b| a.id().cmp(b.id()));
        r
    }

    fn notes_of(record: &PageRecord, id: &str) -> Vec<String> {
        record
            .highlights
            .iter()
            .find(|h| h.id() == id)
            .map(|h| h.notes().to_vec())
            .unwrap_or_default()
    }

    /// Device A's article: 3 highlights (h1 carries a 2-comment thread, h3 is
    /// an element highlight), one freehand drawing. No video data anywhere.
    async fn seed_article_a(store: &Store<'_>) -> String {
        let hash = PagesRepo::upsert_page(store, URL, Some("Article"))
            .await
            .unwrap();
        let c1 = scholiast_core::models::format_note("first comment", 1_700_000_000_000);
        let c2 = scholiast_core::models::apply_edited(
            &scholiast_core::models::format_note("second comment", 1_700_000_005_000),
            1_700_000_009_000,
        );
        HighlightsRepo::save_highlights(
            store,
            &hash,
            &[
                text_hl(
                    "h1",
                    "hello world",
                    "yellow",
                    10,
                    Some(anchor_for("hello world")),
                    vec![c1, c2],
                    None,
                ),
                text_hl("h2", "more text", "red", 20, None, vec![], Some("g1")),
                element_hl("h3", "green", 30),
            ],
        )
        .await
        .unwrap();
        DrawingsRepo::save_drawings(
            store,
            &hash,
            &[PageDrawing {
                id: "s1".into(),
                color: Some("#facc15".into()),
                width: Some(3.0),
                points: vec![1.0, 2.0, 3.0, 4.0],
                updated_at: Some(7),
                extra: Default::default(),
            }],
        )
        .await
        .unwrap();
        hash
    }

    #[tokio::test]
    async fn assembled_article_matches_extension_shape() {
        let pool = memory_pool().await;
        let store = Store::new(&pool);
        let hash = seed_article_a(&store).await;

        let record = assemble_local_page(&store, &hash).await.unwrap();

        // Article provenance: pages-table row wins, video fields stay empty.
        assert_eq!(record.version, 2);
        assert_eq!(record.url, URL);
        assert_eq!(record.title.as_deref(), Some("Article"));
        assert_eq!(record.video_id, None);
        assert!(record.video_items.is_empty());
        let videos_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM videos WHERE url_hash = ?")
            .bind(&hash)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(videos_rows, 0, "article pages must not create videos rows");

        // Extension serde shape: type tag, camelCase offsets, embedded notes,
        // portable anchor passthrough.
        let value = serde_json::to_value(&record).unwrap();
        let find = |id: &str| {
            value["highlights"]
                .as_array()
                .unwrap()
                .iter()
                .find(|h| h["id"] == id)
                .unwrap()
                .clone()
        };
        let h1 = find("h1");
        assert_eq!(h1["type"], "text");
        assert_eq!(h1["startOffset"], 3);
        assert_eq!(h1["endOffset"], 3 + "hello world".len() as i64);
        assert_eq!(h1["color"], "yellow");
        assert_eq!(
            h1["anchor"]["quote"],
            serde_json::json!({
                "quote": "hello world",
                "prefix": "before ",
                "suffix": " after",
                "occurrence": 1
            })
        );
        assert_eq!(h1["notes"].as_array().unwrap().len(), 2);
        assert_eq!(find("h3")["type"], "element");
        assert_eq!(find("h2")["groupId"], "g1");

        assert_eq!(record.drawings.len(), 1);
        assert_eq!(record.drawings[0].id, "s1");
        assert!(record.tombstones.highlights.is_empty());
    }

    /// Remote edit over A's pushed state: recolors h3 newer, adds h4, deletes
    /// h1's second comment via the `${highlightId}:${commentTs}` tombstone.
    fn synthetic_remote(base: &PageRecord) -> PageRecord {
        let mut remote = base.clone();
        remote.highlights.retain(|h| h.id() != "h3");
        remote.highlights.push(element_hl("h3", "black", 1_700_000_012_000));
        remote.highlights.push(text_hl(
            "h4",
            "fresh from device B",
            "red",
            1_700_000_011_000,
            None,
            vec![],
            None,
        ));
        if let Some(h1) = remote.highlights.iter_mut().find(|h| h.id() == "h1") {
            h1.set_notes(vec![scholiast_core::models::format_note(
                "first comment",
                1_700_000_000_000,
            )]);
        }
        remote
            .tombstones
            .comments
            .insert("h1:1700000005000".to_string(), 1_700_000_010_000);
        remote
    }

    /// The core deliverable: assemble(A) → merge against a synthetic remote →
    /// apply to a fresh DB B → assemble(B) reproduces the merged truth
    /// (comment ids byte-exact, tombstoned comment gone, new highlight in).
    #[tokio::test]
    async fn article_round_trip_assemble_merge_apply_fixpoint() {
        let pool_a = memory_pool().await;
        let store_a = Store::new(&pool_a);
        let hash = seed_article_a(&store_a).await;
        let assembled_a = assemble_local_page(&store_a, &hash).await.unwrap();

        // Device B received A's push as its last-reconciled baseline.
        let pool_b = memory_pool().await;
        apply_page(&pool_b, &hash, &assembled_a).await.unwrap();
        let store_b = Store::new(&pool_b);
        SnapshotsRepo::put_snapshot(&store_b, &hash, &assembled_a)
            .await
            .unwrap();

        let remote = synthetic_remote(&assembled_a);
        let merged = merge_page_record(Some(&assembled_a), Some(&assembled_a), Some(&remote), NOW);

        // Merge rules held: newest-wins recolor, brand-new remote highlight,
        // comment deletion propagated as a scoped tombstone.
        assert_eq!(sorted_ids(&merged), vec!["h1", "h2", "h3", "h4"]);
        match merged.highlights.iter().find(|h| h.id() == "h3").unwrap() {
            HighlightData::Element(e) => {
                assert_eq!(e.color.as_deref(), Some("black"));
                assert_eq!(e.updated_at, Some(1_700_000_012_000));
            }
            HighlightData::Text(_) => panic!("expected element highlight"),
        }
        assert_eq!(
            notes_of(&merged, "h1"),
            vec!["first comment<!--timestamp:1700000000000-->".to_string()],
            "tombstoned comment dropped from the thread"
        );
        assert_eq!(
            merged.tombstones.comments.get("h1:1700000005000"),
            Some(&1_700_000_010_000)
        );

        // Write-back on B, then re-assemble: the DB projection must equal the
        // merged record's live content (tombstones intentionally don't
        // assemble locally — they live in Drive + sync_snapshots).
        apply_page(&pool_b, &hash, &merged).await.unwrap();
        let assembled_b = assemble_local_page(&store_b, &hash).await.unwrap();

        assert_eq!(sorted_ids(&assembled_b), sorted_ids(&merged));
        assert_eq!(assembled_b.drawings, merged.drawings);
        assert!(assembled_b.video_items.is_empty());
        assert_eq!(assembled_b.video_id, None);
        assert_eq!(
            fingerprint(&canonical(&assembled_b)),
            fingerprint(&canonical(&merged)),
            "re-assembled projection fingerprints like the merged record"
        );

        // Comment identity survived byte-exact (id column = marker digits,
        // markers rebuilt verbatim).
        let comments = AnnotationRepo::list_comments(&store_b, "h1").await.unwrap();
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].id, "1700000000000");
        assert_eq!(comments[0].body, "first comment");
        assert_eq!(comments[0].created_at, 1_700_000_000_000);
        assert_eq!(comments[0].edited_at, None);
        assert_eq!(
            notes_of(&assembled_b, "h1"),
            vec!["first comment<!--timestamp:1700000000000-->".to_string()]
        );

        // Still no videos rows on B after applying an article-shaped record.
        let videos_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM videos")
            .fetch_one(&pool_b)
            .await
            .unwrap();
        assert_eq!(videos_rows, 0);

        // Apply is idempotent: a second cycle changes nothing.
        apply_page(&pool_b, &hash, &assembled_b).await.unwrap();
        let again = assemble_local_page(&store_b, &hash).await.unwrap();
        assert_eq!(fingerprint(&again), fingerprint(&assembled_b));
    }

    mod wiremock_tests {
        use super::*;
        use crate::drive::rest::{DriveRest, TokenFuture, TokenProvider};
        use crate::sync::engine::SyncEngine;
        use std::path::PathBuf;
        use std::sync::Arc;
        use wiremock::matchers::{method, path, query_param};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        fn token_provider() -> TokenProvider {
            Arc::new(|_force| Box::pin(async { Ok("tok".to_string()) }) as TokenFuture)
        }

        fn quiet_engine(pool: &sqlx::SqlitePool, drive: DriveRest) -> SyncEngine<'_> {
            SyncEngine::with_drive(pool, drive, PathBuf::from("/tmp/opencode"), Box::new(|_| {}))
        }

        /// Extracts the page-record JSON from a hand-built multipart body: the
        /// file content is the part after the final header block.
        fn pushed_json(raw: &[u8]) -> serde_json::Value {
            let s = String::from_utf8_lossy(raw);
            let payload = s.rsplit("\r\n\r\n").next().unwrap_or(&s);
            let start = payload.find('{').expect("json object present");
            let end = payload.rfind('}').expect("json object closed") + 1;
            serde_json::from_str(payload[start..end].trim()).expect("pushed page JSON parses")
        }
        /// Local delete → push cycle → tombstone present in the pushed JSON →
        /// pull on device B removes the highlight there too.
        #[tokio::test]
        async fn deleted_highlight_rides_out_as_tombstone_and_lands_on_b() {
            let server = MockServer::start().await;

            // --- Device A: baseline previously pushed (rev 1); delete locally.
            let pool_a = memory_pool().await;
            let store_a = Store::new(&pool_a);
            let hash = seed_article_a(&store_a).await;
            let baseline = assemble_local_page(&store_a, &hash).await.unwrap();
            SnapshotsRepo::put_snapshot(&store_a, &hash, &baseline)
                .await
                .unwrap();
            SyncMetaRepo::put_meta(&store_a, &hash, "f1", "1").await.unwrap();

            assert_eq!(
                AnnotationRepo::delete_highlight(&store_a, "h2").await.unwrap(),
                Some(hash.clone())
            );

            Mock::given(method("PATCH"))
                .and(path("/upload/drive/v3/files/f1"))
                .respond_with(
                    ResponseTemplate::new(200)
                        .set_body_json(serde_json::json!({"id": "f1", "headRevisionId": "2"})),
                )
                .mount(&server)
                .await;
            // CAS pre-check GET performed by update_multipart (expected rev).
            Mock::given(method("GET"))
                .and(path("/drive/v3/files/f1"))
                .and(query_param("fields", "id,name,headRevisionId"))
                .respond_with(ResponseTemplate::new(200).set_body_json(
                    serde_json::json!({
                        "id": "f1",
                        "name": format!("pages/page-{hash}.json"),
                        "headRevisionId": "1"
                    }),
                ))
                .mount(&server)
                .await;
            let mut engine_a =
                quiet_engine(&pool_a, DriveRest::new(&server.uri(), token_provider()));
            engine_a.push_page(&hash).await.unwrap();

            // Pushed JSON carries h2 ONLY as a tombstone, never as an entity.
            let requests = server.received_requests().await.unwrap();
            let patch = requests
                .iter()
                .find(|r| r.method.as_str() == "PATCH" && r.url.path() == "/upload/drive/v3/files/f1")
                .expect("push must PATCH the page file");
            let pushed = pushed_json(&patch.body);
            let hl_ids: Vec<&str> = pushed["highlights"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|h| h["id"].as_str())
                .collect();
            assert_eq!(hl_ids, vec!["h1", "h3"]);
            assert!(pushed["tombstones"]["highlights"]
                .as_object()
                .unwrap()
                .contains_key("h2"));

            // --- Device B: holds A's original push as baseline, stale rev.
            let pool_b = memory_pool().await;
            apply_page(&pool_b, &hash, &baseline).await.unwrap();
            let store_b = Store::new(&pool_b);
            SnapshotsRepo::put_snapshot(&store_b, &hash, &baseline)
                .await
                .unwrap();
            SyncMetaRepo::put_meta(&store_b, &hash, "f1", "1").await.unwrap();

            Mock::given(method("GET"))
                .and(path("/drive/v3/files"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "files": [{
                        "id": "f1",
                        "name": format!("pages/page-{hash}.json"),
                        "headRevisionId": "2"
                    }]
                })))
                .expect(1)
                .mount(&server)
                .await;
            let pushed_json_body = serde_json::to_string(&pushed).unwrap();
            Mock::given(method("GET"))
                .and(path("/drive/v3/files/f1"))
                .and(query_param("alt", "media"))
                .respond_with(ResponseTemplate::new(200).set_body_string(pushed_json_body))
                .expect(1)
                .mount(&server)
                .await;

            let mut engine_b =
                quiet_engine(&pool_b, DriveRest::new(&server.uri(), token_provider()));
            let (outcome, touched) = engine_b.pull_full().await.unwrap();
            assert_eq!(outcome.downloaded, 1);
            assert!(touched.contains(&hash));

            // h2 is gone on B; everything else survives untouched.
            let highlights = HighlightsRepo::get_highlights(&store_b, &hash).await.unwrap();
            let got: Vec<String> = highlights
                .iter()
                .map(|r| r.highlight.id().to_string())
                .collect();
            assert_eq!(got, vec!["h1", "h3"]);
            let comments = AnnotationRepo::list_comments(&store_b, "h1").await.unwrap();
            assert_eq!(comments.len(), 2, "untouched threads survive the pull");
            let page = PagesRepo::get_page(&store_b, &hash).await.unwrap().unwrap();
            assert_eq!(page.title.as_deref(), Some("Article"));
            let meta = SyncMetaRepo::get_meta(&store_b, &hash).await.unwrap().unwrap();
            assert_eq!(meta.head_revision_id.as_deref(), Some("2"));
        }

        /// Applying an article-shaped record touches `pages.updated_at`
        /// (deliverable: write-back refreshes page recency) and never seeds
        /// the videos table.
        #[tokio::test]
        async fn article_apply_touches_page_and_never_creates_video_rows() {
            let pool = memory_pool().await;
            let store = Store::new(&pool);
            let hash = seed_article_a(&store).await;
            sqlx::query("UPDATE pages SET updated_at = 1")
                .execute(&pool)
                .await
                .unwrap();

            let record = assemble_local_page(&store, &hash).await.unwrap();
            apply_page(&pool, &hash, &record).await.unwrap();

            let updated: i64 = sqlx::query_scalar("SELECT updated_at FROM pages WHERE url_hash = ?")
                .bind(&hash)
                .fetch_one(&pool)
                .await
                .unwrap();
            assert!(updated > 1, "apply_page must touch pages.updated_at");
            let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM videos")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(rows, 0);
        }
    }
}
