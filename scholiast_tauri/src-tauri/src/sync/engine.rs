//! The sync engine: assemble local state into a `PageRecord`, push blobs +
//! page JSON, and reconcile against Drive with the shared 3-way merge.
//!
//! Layout parity with the extension: one Drive file per page
//! (`pages/page-<urlhash>.json`, no image bytes), frame JPEGs and diagram
//! PNG/scene blobs beside it. `sync_meta` carries `{file_id,
//! head_revision_id}`; `sync_snapshots` holds the last-reconciled record
//! (the merge base, tombstones included); `sync_queue` lists dirty pages.
//! Offline failures propagate as errors and leave all three untouched.

use std::path::{Path, PathBuf};

use scholiast_core::error::ScholiastError;
use scholiast_core::merge::{fingerprint, merge_page_record};
use scholiast_core::models::{HighlightData, PageRecord};
use serde::Serialize;
use sqlx::Row;

use crate::drive::rest::{DriveRest, DRIVE_BASE_URL};
use crate::store::highlights::{DiagramsRepo as HlDiagramsRepo, DrawingsRepo, HighlightsRepo};
use crate::store::highlights::PagesRepo;
use crate::store::sync_meta::{SnapshotsRepo, SyncMetaRepo, SyncQueueRepo};
use crate::store::video_items::VideoItemsRepo;
use crate::store::videos::VideosRepo;
use crate::store::{now_ms, Store};
use crate::store::{assembly};

/// Progress payload emitted as `sync://progress` during long operations.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgress {
    pub phase: String,
    pub done: usize,
    pub total: usize,
    pub title: String,
    pub url: String,
}

/// What a full reconcile did.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutcome {
    pub pages: usize,
    pub pushed: usize,
    pub downloaded: usize,
    pub skipped: usize,
}

type ProgressSink<'a> = Box<dyn FnMut(SyncProgress) + Send + Sync + 'a>;

pub struct SyncEngine<'a> {
    store: Store<'a>,
    drive: DriveRest,
    data_dir: PathBuf,
    progress: ProgressSink<'a>,
}

enum ReconcileResult {
    Idle,
    Skipped,
    Downloaded,
    Pushed,
}

impl<'a> SyncEngine<'a> {
    /// Production constructor: real Drive endpoints + keyring-backed tokens.
    pub fn new(
        pool: &'a sqlx::SqlitePool,
        data_dir: PathBuf,
        progress: impl FnMut(SyncProgress) + Send + Sync + 'a,
    ) -> Self {
        Self::with_drive(
            pool,
            DriveRest::new(DRIVE_BASE_URL, crate::drive::rest::production_provider()),
            data_dir,
            Box::new(progress),
        )
    }


    /// Injectable transport — tests point `drive` at a wiremock server.
    pub fn with_drive(
        pool: &'a sqlx::SqlitePool,
        drive: DriveRest,
        data_dir: PathBuf,
        progress: ProgressSink<'a>,
    ) -> Self {
        SyncEngine {
            store: Store::new(pool),
            drive,
            data_dir,
            progress,
        }
    }

    /// No-progress engine for read-only checks (`is_page_in_sync`).
    pub fn quiet(pool: &'a sqlx::SqlitePool, data_dir: PathBuf) -> Self {
        Self::with_drive(
            pool,
            DriveRest::new(DRIVE_BASE_URL, crate::drive::rest::production_provider()),
            data_dir,
            Box::new(|_| {}),
        )
    }

    async fn report(&mut self, phase: &str, done: usize, total: usize, hash: &str) {
        (self.progress)(SyncProgress {
            phase: phase.to_string(),
            done,
            total,
            title: hash.to_string(),
            url: assembly::page_url_of(&self.store, hash).await,
        });
    }

    async fn assemble(&self, hash: &str) -> Result<PageRecord, ScholiastError> {
        assembly::assemble_local_page(&self.store, hash).await
    }

    fn frames_dir(&self) -> PathBuf {
        self.data_dir.join("frames")
    }

    /// The diagrams row's stored png_path (absolute from capture, or relative
    /// to the data dir).
    async fn diagram_png_path(&self, hash: &str, diagram_id: &str) -> PathBuf {
        let raw: Option<Option<String>> = sqlx::query_scalar(
            "SELECT png_path FROM diagrams WHERE page_url_hash = ? AND id = ?",
        )
        .bind(hash)
        .bind(diagram_id)
        .fetch_optional(self.store.pool)
        .await
        .ok()
        .flatten();
        match raw.flatten() {
            Some(path) if Path::new(&path).is_absolute() => PathBuf::from(path),
            Some(path) => self.data_dir.join(path),
            None => self
                .data_dir
                .join("diagrams")
                .join(format!("{diagram_id}.png")),
        }
    }

    /// Uploads blobs missing a `driveId` (frame JPEGs, diagram PNG + scene
    /// JSON) and stamps the ids back onto their rows.
    async fn upload_missing_blobs(
        &mut self,
        hash: &str,
        record: &mut PageRecord,
    ) -> Result<(), ScholiastError> {
        for item in record.video_items.iter_mut() {
            let Some(frame) = item.frame.as_mut() else {
                continue;
            };
            if frame.drive_id.is_some() {
                continue;
            }
            let jpg = self.frames_dir().join(format!("{}.jpg", item.id));
            let Some(bytes) = read_if_exists(&jpg).await? else {
                continue;
            };
            let uploaded = self
                .drive
                .upload_multipart(
                    &format!("frames/frame-{}.jpg", item.id),
                    bytes,
                    "image/jpeg",
                )
                .await?;
            frame.drive_id = Some(uploaded.id);
            sqlx::query("UPDATE video_items SET frame_drive_id = ? WHERE id = ?")
                .bind(frame.drive_id.as_deref())
                .bind(&item.id)
                .execute(self.store.pool)
                .await
                .map_err(crate::store::dberr)?;
        }

        for diagram in record.diagrams.iter_mut() {
            let png_path = self.diagram_png_path(hash, &diagram.id).await;
            if diagram.drive_id.is_none() {
                if let Some(bytes) = read_if_exists(&png_path).await? {
                    let uploaded = self
                        .drive
                        .upload_multipart(
                            &format!("diagrams/diagram-{}.png", diagram.id),
                            bytes,
                            "image/png",
                        )
                        .await?;
                    diagram.drive_id = Some(uploaded.id);
                }
            }
            if diagram.scene_drive_id.is_none() {
                if let Some(scene) = diagram.scene_data.clone() {
                    let json = serde_json::to_vec(&scene)
                        .map_err(|e| ScholiastError::Internal(e.to_string()))?;
                    let uploaded = self
                        .drive
                        .upload_multipart(
                            &format!("diagrams/diagram-{}.scene.json", diagram.id),
                            json,
                            "application/json",
                        )
                        .await?;
                    diagram.scene_drive_id = Some(uploaded.id);
                }
            }
            sqlx::query("UPDATE diagrams SET png_drive_id = ?, scene_drive_id = ? WHERE id = ?")
                .bind(diagram.drive_id.as_deref())
                .bind(diagram.scene_drive_id.as_deref())
                .bind(&diagram.id)
                .execute(self.store.pool)
                .await
                .map_err(crate::store::dberr)?;
        }
        Ok(())
    }

    /// Composes the record to upload: the assembled local state merged
    /// against the snapshot standing in as the last-known remote, so local
    /// deletions become tombstones and prior tombstones survive the push.
    async fn compose_push(
        &mut self,
        hash: &str,
        mut assembled: PageRecord,
    ) -> Result<PageRecord, ScholiastError> {
        self.upload_missing_blobs(hash, &mut assembled).await?;
        let snapshot = self.store.get_snapshot(hash).await?;
        Ok(merge_page_record(
            snapshot.as_ref(),
            Some(&assembled),
            snapshot.as_ref(),
            now_ms(),
        ))
    }

    /// Pushes one page: blobs first, then the page JSON (create or
    /// CAS-guarded update), then bookkeeping (`sync_meta` + `sync_snapshots`).
    pub async fn push_page(&mut self, hash: &str) -> Result<(), ScholiastError> {
        self.report("pushing", 0, 1, hash).await;
        let assembled = self.assemble(hash).await?;
        let record = self.compose_push(hash, assembled).await?;

        let json =
            serde_json::to_vec(&record).map_err(|e| ScholiastError::Internal(e.to_string()))?;
        let name = scholiast_core::normalize::page_file_name(hash);

        let meta = self.store.get_meta(hash).await?;
        let uploaded = match meta.as_ref().and_then(|m| m.file_id.as_deref()) {
            Some(file_id) => {
                self.drive
                    .update_multipart(
                        file_id,
                        json,
                        "application/json",
                        meta.as_ref().and_then(|m| m.head_revision_id.as_deref()),
                    )
                    .await?
            }
            None => {
                self.drive
                    .upload_multipart(&name, json, "application/json")
                    .await?
            }
        };

        self.store
            .put_meta(
                hash,
                &uploaded.id,
                uploaded.head_revision_id.as_deref().unwrap_or(""),
            )
            .await?;
        self.store.put_snapshot(hash, &record).await?;
        Ok(())
    }

    /// Full reconcile: walk every remote `pages/*` plus every local page,
    /// skip provably-unchanged ones, merge+apply+re-push the rest, then drain
    /// the dirty queue. Returns the outcome plus every page whose local store
    /// changed (for `db://changed:*` emission by the command layer).
    pub async fn pull_full(&mut self) -> Result<(SyncOutcome, Vec<String>), ScholiastError> {
        self.report("discovering", 0, 1, "").await;
        let remote_files = self.drive.list_files("pages/").await?;
        let remote: Vec<(String, crate::drive::rest::DriveFileMeta)> = remote_files
            .into_iter()
            .filter_map(|file| hash_from_name(&file.name).map(|hash| (hash, file)))
            .collect();

        let local_hashes = assembly::list_page_hashes(&self.store).await?;
        // Remote-first order, then locals not present remotely.
        let mut ordered: Vec<String> =
            remote.iter().map(|(h, _)| h.clone()).collect();
        for hash in local_hashes {
            if !ordered.contains(&hash) {
                ordered.push(hash);
            }
        }
        let total = ordered.len();

        let mut outcome = SyncOutcome {
            pages: total,
            ..Default::default()
        };
        let mut touched: Vec<String> = Vec::new();
        for (index, hash) in ordered.iter().enumerate() {
            self.report("reconciling", index + 1, total, hash).await;
            let entry = remote
                .iter()
                .find(|(rh, _)| rh == hash)
                .map(|(_, f)| f.clone());
            let mut changed_local = false;
            match self.reconcile_page(hash, entry.as_ref()).await? {
                ReconcileResult::Skipped => outcome.skipped += 1,
                ReconcileResult::Idle => {}
                ReconcileResult::Downloaded => {
                    outcome.downloaded += 1;
                    changed_local = true;
                }
                ReconcileResult::Pushed => {
                    outcome.pushed += 1;
                    changed_local = true;
                }
            }
            if changed_local && !touched.contains(hash) {
                touched.push(hash.clone());
            }
        }
        self.drain_queue().await?;
        Ok((outcome, touched))
    }

    /// Pages enqueued while offline leave the queue once their content
    /// fingerprints like the snapshot (i.e. they were just reconciled).
    async fn drain_queue(&mut self) -> Result<u32, ScholiastError> {
        let pending = self.store.pending().await?;
        let mut drained = 0u32;
        for hash in pending {
            let matches_snapshot = {
                let local = self.assemble(&hash).await?;
                match self.store.get_snapshot(&hash).await? {
                    Some(snap) => fingerprint(&local) == fingerprint(&snap),
                    None => is_empty_record(&local),
                }
            };
            if matches_snapshot {
                self.store.dequeue(&hash).await?;
                drained += 1;
            }
        }
        Ok(drained)
    }

    async fn reconcile_page(
        &mut self,
        hash: &str,
        remote_file: Option<&crate::drive::rest::DriveFileMeta>,
    ) -> Result<ReconcileResult, ScholiastError> {
        let meta = self.store.get_meta(hash).await?;
        let snapshot = self.store.get_snapshot(hash).await?;
        let local = self.assemble(hash).await?;

        match remote_file {
            Some(file) => {
                // Skip without network work only when the Drive revision is
                // the one we recorded AND local content still fingerprints
                // like the snapshot (tombstones excluded on both sides).
                let revision_matches = meta.as_ref().is_some_and(|m| {
                    m.file_id.as_deref() == Some(file.id.as_str())
                        && m.head_revision_id.as_deref() == file.head_revision_id.as_deref()
                });
                let content_matches = snapshot
                    .as_ref()
                    .is_some_and(|snap| fingerprint(&local) == fingerprint(snap));
                if revision_matches && content_matches {
                    return Ok(ReconcileResult::Skipped);
                }

                let bytes = self.drive.download(&file.id).await?;
                let remote_record: PageRecord = serde_json::from_slice(&bytes).map_err(|e| {
                    ScholiastError::InvalidInput(format!(
                        "unparseable page record {}: {e}",
                        file.name
                    ))
                })?;
                let merged = merge_page_record(
                    snapshot.as_ref(),
                    Some(&local),
                    Some(&remote_record),
                    now_ms(),
                );
                apply_page(self.store.pool, hash, &merged).await?;
                // The snapshot is the RE-ASSEMBLED projection of the merged
                // record (task-17 rule): the DB imposes its own row order and
                // defaults, so snapshotting raw merge output would never
                // fingerprint-match the local state again and every later
                // poll would re-download. Tombstones ride in `merged` — keep
                // them from there.
                let mut projected = self.assemble(hash).await?;
                projected.tombstones = merged.tombstones.clone();

                // Re-push when reconciliation changed the shared truth
                // relative to what Drive currently holds (extension rule):
                // deletions ride out as tombstones even though the live
                // entity fingerprint may match the local one.
                let drive_stale =
                    fingerprint(&merged) != fingerprint(&remote_record);
                if drive_stale {
                    let json = serde_json::to_vec(&merged)
                        .map_err(|e| ScholiastError::Internal(e.to_string()))?;
                    // No extra CAS GET here: the revision we merged against
                    // IS file.head_revision_id from the fresh listing.
                    let uploaded = self
                        .drive
                        .update_multipart(&file.id, json, "application/json", None)
                        .await?;
                    self.store
                        .put_meta(
                            hash,
                            &uploaded.id,
                            uploaded.head_revision_id.as_deref().unwrap_or(""),
                        )
                        .await?;
                    self.store.put_snapshot(hash, &projected).await?;
                    self.pull_missing_blobs(hash).await?;
                    Ok(ReconcileResult::Pushed)
                } else {
                    // Local was already up to date; adopt remote revision +
                    // tombstones as the new baseline.
                    self.store
                        .put_meta(
                            hash,
                            &file.id,
                            file.head_revision_id.as_deref().unwrap_or(""),
                        )
                        .await?;
                    self.store.put_snapshot(hash, &projected).await?;
                    self.pull_missing_blobs(hash).await?;
                    Ok(ReconcileResult::Downloaded)
                }
            }
            None => {
                // Local-only page: push when it has anything to say.
                let queued = self.store.pending().await?.iter().any(|q| q == hash);
                let drifted = !match &snapshot {
                    Some(snap) => fingerprint(&local) == fingerprint(snap),
                    None => true,
                };
                if (!queued && !drifted) || is_empty_record(&local) {
                    return Ok(ReconcileResult::Idle);
                }
                self.push_page(hash).await?;
                self.store.dequeue(hash).await?;
                Ok(ReconcileResult::Pushed)
            }
        }
    }

    /// Pulls frame/diagram blobs whose `driveId` is known but whose local
    /// file is absent. Returns how many blobs landed.
    pub async fn pull_missing_blobs(&self, hash: &str) -> Result<usize, ScholiastError> {
        let mut pulled = 0usize;

        let frame_ids: Vec<String> =
            sqlx::query("SELECT id FROM video_items WHERE url_hash = ? AND kind = 'frame'")
                .bind(hash)
                .fetch_all(self.store.pool)
                .await
                .map_err(crate::store::dberr)?
                .into_iter()
                .filter_map(|row| row.try_get("id").ok())
                .collect();
        for item_id in frame_ids {
            let drive_id: Option<String> =
                sqlx::query_scalar("SELECT frame_drive_id FROM video_items WHERE id = ?")
                    .bind(&item_id)
                    .fetch_one(self.store.pool)
                    .await
                    .map_err(crate::store::dberr)?;
            let Some(drive_id) = drive_id else {
                continue;
            };
            let target = self.frames_dir().join(format!("{item_id}.jpg"));
            if !target.is_file() {
                write_bytes(&target, self.drive.download(&drive_id).await?).await?;
                pulled += 1;
            }
        }

        for diagram in assembly::diagrams_for_page(&self.store, hash).await? {
            if let Some(png_drive) = diagram.drive_id.clone() {
                let target = self.diagram_png_path(hash, &diagram.id).await;
                if !target.is_file() {
                    write_bytes(&target, self.drive.download(&png_drive).await?).await?;
                    pulled += 1;
                }
            }
            if diagram.scene_data.is_none() {
                if let Some(scene_drive) = diagram.scene_drive_id.clone() {
                    let bytes = self.drive.download(&scene_drive).await?;
                    let scene_json = String::from_utf8_lossy(&bytes).to_string();
                    sqlx::query("UPDATE diagrams SET scene_json = ? WHERE id = ?")
                        .bind(&scene_json)
                        .bind(&diagram.id)
                        .execute(self.store.pool)
                        .await
                        .map_err(crate::store::dberr)?;
                    pulled += 1;
                }
            }
        }
        Ok(pulled)
    }

    /// Whether one page is provably in sync: the recorded revision matches
    /// the live Drive file AND local content still fingerprints like the
    /// snapshot (and nothing sits in the dirty queue).
    pub async fn is_page_in_sync(&mut self, hash: &str) -> Result<bool, ScholiastError> {
        let name = scholiast_core::normalize::page_file_name(hash);
        let files = self.drive.list_files("pages/").await?;
        let Some(file) = files.iter().find(|f| f.name == name) else {
            return Ok(false);
        };
        let meta = self.store.get_meta(hash).await?;
        let revision_matches = meta.as_ref().is_some_and(|m| {
            m.file_id.as_deref() == Some(file.id.as_str())
                && m.head_revision_id.as_deref() == file.head_revision_id.as_deref()
        });
        if !revision_matches {
            return Ok(false);
        }
        if self.store.pending().await?.iter().any(|q| q == hash) {
            return Ok(false);
        }
        let local = self.assemble(hash).await?;
        match self.store.get_snapshot(hash).await? {
            Some(snap) => Ok(fingerprint(&local) == fingerprint(&snap)),
            None => Ok(is_empty_record(&local)),
        }
    }
}

fn is_empty_record(record: &PageRecord) -> bool {
    record.highlights.is_empty()
        && record.drawings.is_empty()
        && record.video_items.is_empty()
        && record.diagrams.is_empty()
}

/// Writes merged state back to the store: upserts the merged entities and
/// lets full-page replaces drop tombstoned ones. Deterministic timestamps (0
/// when an entity carries none) keep repeated cycles fingerprint-stable —
/// never wall-clock here.
pub async fn apply_page(
    pool: &sqlx::SqlitePool,
    url_hash: &str,
    record: &PageRecord,
) -> Result<(), ScholiastError> {
    let store = Store::new(pool);

    if !record.url.is_empty() {
        PagesRepo::upsert_page(&store, &record.url, record.title.as_deref()).await?;
        if record.video_id.is_some() || !record.video_items.is_empty() {
            VideosRepo::upsert_video(
                &store,
                &record.url,
                record.title.as_deref(),
                record.video_id.as_deref(),
            )
            .await?;
        }
    }

    let mut highlights = record.highlights.clone();
    for hl in highlights.iter_mut() {
        ensure_updated_at(hl);
    }
    HighlightsRepo::save_highlights(&store, url_hash, &highlights).await?;

    DrawingsRepo::save_drawings(&store, url_hash, &record.drawings).await?;

    let existing_ids: Vec<String> =
        sqlx::query("SELECT id FROM video_items WHERE url_hash = ?")
            .bind(url_hash)
            .fetch_all(pool)
            .await
            .map_err(crate::store::dberr)?
            .into_iter()
            .filter_map(|row| row.try_get("id").ok())
            .collect();
    for id in existing_ids {
        if !record.video_items.iter().any(|item| item.id == id) {
            VideoItemsRepo::delete_video_item(&store, url_hash, &id).await?;
        }
    }
    for item in &record.video_items {
        let mut item = item.clone();
        if item.updated_at.is_none() {
            item.updated_at = Some(0);
        }
        VideoItemsRepo::save_video_item(&store, url_hash, &item).await?;
    }

    // Diagrams are global rows stamped with the page hash: drop this page's
    // stale ones, then upsert the merged set.
    let stale: Vec<String> = sqlx::query("SELECT id FROM diagrams WHERE page_url_hash = ?")
        .bind(url_hash)
        .fetch_all(pool)
        .await
        .map_err(crate::store::dberr)?
        .into_iter()
        .filter_map(|row| row.try_get::<String, _>("id").ok())
        .filter(|id| !record.diagrams.iter().any(|d| d.id == *id))
        .collect();
    for id in stale {
        HlDiagramsRepo::delete_diagram(&store, &id).await?;
    }
    for diagram in &record.diagrams {
        HlDiagramsRepo::save_diagram(&store, Some(url_hash), diagram).await?;
    }

    Ok(())
}

fn ensure_updated_at(hl: &mut HighlightData) {
    match hl {
        HighlightData::Text(t) => {
            if t.updated_at.is_none() {
                t.updated_at = Some(0);
            }
        }
        HighlightData::Element(e) => {
            if e.updated_at.is_none() {
                e.updated_at = Some(0);
            }
        }
    }
}

fn hash_from_name(name: &str) -> Option<String> {
    name.strip_prefix("pages/page-")?
        .strip_suffix(".json")
        .map(str::to_string)
}

async fn read_if_exists(path: &Path) -> Result<Option<Vec<u8>>, ScholiastError> {
    if path.is_file() {
        Ok(Some(
            tokio::fs::read(path)
                .await
                .map_err(|e| ScholiastError::Io(format!("{}: {e}", path.display())))?,
        ))
    } else {
        Ok(None)
    }
}

async fn write_bytes(path: &Path, bytes: Vec<u8>) -> Result<(), ScholiastError> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| ScholiastError::Io(e.to_string()))?;
    }
    tokio::fs::write(path, bytes)
        .await
        .map_err(|e| ScholiastError::Io(format!("{}: {e}", path.display())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::test_support::memory_pool;
    use scholiast_core::models::{
        AnnotationAnchor, DiagramMeta, FrameImage, PageDrawing, TextHighlight, TextQuoteAnchor,
        VideoItem, VideoItemKind,
    };
    use scholiast_core::normalize::{normalize_url, url_hash};
    use serde_json::json;
    use std::sync::Arc;
    use wiremock::matchers::{body_string_contains, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn hash_of(url: &str) -> String {
        url_hash(&normalize_url(url))
    }

    fn token_provider() -> crate::drive::rest::TokenProvider {
        Arc::new(|_force| {
            Box::pin(async { Ok("tok".to_string()) }) as crate::drive::rest::TokenFuture
        })
    }

    fn quiet_engine(
        pool: &sqlx::SqlitePool,
        drive: DriveRest,
        dir: PathBuf,
    ) -> SyncEngine<'_> {
        SyncEngine::with_drive(pool, drive, dir, Box::new(|_| {}))
    }

    async fn seed_reader_page(store: &Store<'_>, url: &str, color: &str, updated_at: i64) -> String {
        let hash = PagesRepo::upsert_page(store, url, Some("Example")).await.unwrap();
        let highlight = HighlightData::Text(TextHighlight {
            id: "h1".into(),
            xpath: Some("/html/body/p[1]".into()),
            start_offset: Some(0),
            end_offset: Some(5),
            content: "hello".into(),
            notes: vec![],
            color: Some(color.into()),
            group_id: None,
            updated_at: Some(updated_at),
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
        HighlightsRepo::save_highlights(store, &hash, &[highlight]).await.unwrap();
        hash
    }

    fn record_with_highlight(hash_url: &str, color: &str, updated_at: i64) -> PageRecord {
        let mut record = PageRecord::empty(hash_url);
        record.title = Some("Example".into());
        record.highlights.push(HighlightData::Text(TextHighlight {
            id: "h1".into(),
            xpath: None,
            start_offset: None,
            end_offset: None,
            content: "hello".into(),
            notes: vec![],
            color: Some(color.into()),
            group_id: None,
            updated_at: Some(updated_at),
            anchor: None,
            image_edit: None,
            extra: Default::default(),
        }));
        record
    }

    #[tokio::test]
    async fn assembly_round_trip_through_apply_page() {
        let pool_a = memory_pool().await;
        let store_a = Store::new(&pool_a);
        let url = "https://youtu.be/dQw4w9WgXcQ";
        let hash = hash_of(url);
        VideosRepo::upsert_video(&store_a, url, Some("Lecture"), Some("dQw4w9WgXcQ"))
            .await
            .unwrap();

        let item = VideoItem {
            id: "it1".into(),
            kind: VideoItemKind::Frame,
            video_time: 61.5,
            frame: Some(FrameImage {
                data_url: None,
                drive_id: Some("blob-1".into()),
                w: 1280,
                h: 720,
                extra: Default::default(),
            }),
            markup: None,
            notes: vec![scholiast_core::models::format_note("note", 100)],
            updated_at: Some(101),
            time_end: None,
            quote: None,
            color: None,
            anchor: None,
            excalidraw_scene: None,
            extra: Default::default(),
        };
        VideoItemsRepo::save_video_item(&store_a, &hash, &item).await.unwrap();
        HlDiagramsRepo::save_diagram(
            &store_a,
            Some(&hash),
            &DiagramMeta {
                id: "dg1".into(),
                scene_data: Some(json!({"elements": []})),
                updated_at: Some(9),
                drive_id: None,
                scene_drive_id: None,
                pasted: false,
                image_for_highlight: None,
                page_url: None,
                extra: Default::default(),
            },
        )
        .await
        .unwrap();
        DrawingsRepo::save_drawings(
            &store_a,
            &hash,
            &[PageDrawing {
                id: "s1".into(),
                color: None,
                width: None,
                points: vec![1.0, 2.0, 3.0],
                updated_at: Some(7),
                extra: Default::default(),
            }],
        )
        .await
        .unwrap();
        // A reader-page highlight rides along too.
        let _ = seed_reader_page(&store_a, url, "yellow", 42).await;

        let assembled_a = assemble_local(&store_a, &hash).await;

        let pool_b = memory_pool().await;
        apply_page(&pool_b, &hash, &assembled_a).await.unwrap();
        let store_b = Store::new(&pool_b);
        let assembled_b = assemble_local(&store_b, &hash).await;

        assert_eq!(assembled_a, assembled_b, "apply(assemble(x)) is a fixpoint");
        assert_eq!(fingerprint(&assembled_a), fingerprint(&assembled_b));
    }

    async fn assemble_local(store: &Store<'_>, hash: &str) -> PageRecord {
        crate::store::assembly::assemble_local_page(store, hash).await.unwrap()
    }

    #[tokio::test]
    async fn push_uploads_blobs_then_record_and_stamps_ids() {
        let server = MockServer::start().await;
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("frames")).unwrap();
        std::fs::write(dir.path().join("frames").join("it1.jpg"), b"jpeg-bytes").unwrap();
        std::fs::create_dir_all(dir.path().join("diagrams")).unwrap();
        std::fs::write(dir.path().join("diagrams").join("dg1.png"), b"png-bytes").unwrap();

        let pool = memory_pool().await;
        let store = Store::new(&pool);
        let url = "https://youtu.be/dQw4w9WgXcQ";
        let hash = hash_of(url);
        VideosRepo::upsert_video(&store, url, Some("Lecture"), Some("dQw4w9WgXcQ"))
            .await
            .unwrap();
        VideoItemsRepo::save_video_item(
            &store,
            &hash,
            &VideoItem {
                id: "it1".into(),
                kind: VideoItemKind::Frame,
                video_time: 5.0,
                frame: Some(FrameImage {
                    data_url: None,
                    drive_id: None,
                    w: 320,
                    h: 180,
                    extra: Default::default(),
                }),
                markup: None,
                notes: vec![],
                updated_at: Some(1),
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
        HlDiagramsRepo::save_diagram(
            &store,
            Some(&hash),
            &DiagramMeta {
                id: "dg1".into(),
                scene_data: Some(json!({"v": 1})),
                updated_at: Some(2),
                drive_id: None,
                scene_drive_id: None,
                pasted: false,
                image_for_highlight: None,
                page_url: None,
                extra: Default::default(),
            },
        )
        .await
        .unwrap();

        let page_name = format!("pages/page-{hash}.json");
        for (marker, blob_id) in [
            ("frames/frame-it1.jpg", "frame-blob"),
            ("diagrams/diagram-dg1.png", "png-blob"),
            ("diagrams/diagram-dg1.scene.json", "scene-blob"),
            (page_name.as_str(), "page-file"),
        ] {
            Mock::given(method("POST"))
                .and(path("/upload/drive/v3/files"))
                .and(query_param("uploadType", "multipart"))
                .and(body_string_contains(format!("\x22name\x22:\x22{marker}\x22").as_str()))
                .respond_with(
                    ResponseTemplate::new(200)
                        .set_body_json(json!({"id": blob_id, "headRevisionId": "1"})),
                )
                .expect(1)
                .mount(&server)
                .await;
        }

        let mut engine = quiet_engine(
            &pool,
            DriveRest::new(&server.uri(), token_provider()),
            dir.path().to_path_buf(),
        );
        engine.push_page(&hash).await.unwrap();

        let meta = store.get_meta(&hash).await.unwrap().unwrap();
        assert_eq!(meta.file_id.as_deref(), Some("page-file"));
        assert_eq!(meta.head_revision_id.as_deref(), Some("1"));
        let snapshot = store.get_snapshot(&hash).await.unwrap().unwrap();
        assert_eq!(
            snapshot.video_items[0].frame.as_ref().unwrap().drive_id.as_deref(),
            Some("frame-blob"),
            "stamped onto the pushed record"
        );
        assert_eq!(snapshot.diagrams[0].drive_id.as_deref(), Some("png-blob"));
        assert_eq!(snapshot.diagrams[0].scene_drive_id.as_deref(), Some("scene-blob"));

        let stored_drive_id: Option<String> =
            sqlx::query_scalar("SELECT frame_drive_id FROM video_items WHERE id = 'it1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(stored_drive_id.as_deref(), Some("frame-blob"));
    }

    #[tokio::test]
    async fn pull_resolves_two_device_conflict_per_merge_rules() {
        let server = MockServer::start().await;
        let dir = tempfile::tempdir().unwrap();
        let pool = memory_pool().await;
        let store = Store::new(&pool);
        let url = "https://example.com/a";
        let hash = hash_of(url);

        // Base state (what both devices last reconciled).
        seed_reader_page(&store, url, "yellow", 10).await;
        store.put_snapshot(&hash, &record_with_highlight(url, "yellow", 10)).await.unwrap();
        store.put_meta(&hash, "f1", "11").await.unwrap();

        // Device A edits locally to green @30.
        HighlightsRepo::save_highlights(
            &store,
            &hash,
            &[HighlightData::Text(TextHighlight {
                id: "h1".into(),
                xpath: None,
                start_offset: None,
                end_offset: None,
                content: "hello".into(),
                notes: vec![],
                color: Some("green".into()),
                group_id: None,
                updated_at: Some(30),
                anchor: None,
                image_edit: None,
                extra: Default::default(),
            })],
        )
        .await
        .unwrap();
        store.enqueue(&hash).await.unwrap();

        // Device B pushed red @20 meanwhile.
        Mock::given(method("GET"))
            .and(path("/drive/v3/files"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "files": [{"id": "f1", "name": format!("pages/page-{hash}.json"), "headRevisionId": "12"}]
            })))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/f1"))
            .and(query_param("alt", "media"))
            .respond_with(ResponseTemplate::new(200).set_body_string(
                serde_json::to_string(&record_with_highlight(url, "red", 20)).unwrap(),
            ))
            .expect(1)
            .mount(&server)
            .await;
        // The merged winner (green @30) is re-pushed with the merged tombstones.
        Mock::given(method("PATCH"))
            .and(path("/upload/drive/v3/files/f1"))
            .and(body_string_contains("\x22color\x22:\x22green\x22"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "id": "f1", "headRevisionId": "13"
            })))
            .expect(1)
            .mount(&server)
            .await;

        let mut engine = quiet_engine(
            &pool,
            DriveRest::new(&server.uri(), token_provider()),
            dir.path().to_path_buf(),
        );
        let (outcome, touched) = engine.pull_full().await.unwrap();

        assert_eq!(outcome.pages, 1);
        assert_eq!(outcome.pushed, 1, "local won and re-pushed");
        assert!(touched.contains(&hash));

        let highlights = HighlightsRepo::get_highlights(&store, &hash).await.unwrap();
        match &highlights[0].highlight {
            HighlightData::Text(t) => assert_eq!(t.color.as_deref(), Some("green")),
            other => panic!("unexpected highlight {other:?}"),
        }
        let meta = store.get_meta(&hash).await.unwrap().unwrap();
        assert_eq!(meta.head_revision_id.as_deref(), Some("13"));
        // The queue drains once content fingerprints like the new snapshot.
        assert!(store.pending().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn unchanged_pages_skip_without_network_work() {
        let server = MockServer::start().await;
        let dir = tempfile::tempdir().unwrap();
        let pool = memory_pool().await;
        let store = Store::new(&pool);
        let url = "https://example.com/skip";
        let hash = hash_of(url);

        seed_reader_page(&store, url, "yellow", 10).await;
        // Snapshot mirrors the assembled truth so the page provably matches.
        let baseline = assemble_local(&store, &hash).await;
        store.put_snapshot(&hash, &baseline).await.unwrap();
        store.put_meta(&hash, "f1", "11").await.unwrap();

        // Three listings: reconcile run one, run two, then is_page_in_sync.
        // No download/PATCH mocks at all — an unchanged page must not touch
        // anything beyond files.list.
        Mock::given(method("GET"))
            .and(path("/drive/v3/files"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "files": [{"id": "f1", "name": format!("pages/page-{hash}.json"), "headRevisionId": "11"}]
            })))
            .expect(3)
            .mount(&server)
            .await;

        let mut engine = quiet_engine(
            &pool,
            DriveRest::new(&server.uri(), token_provider()),
            dir.path().to_path_buf(),
        );

        let (first, _) = engine.pull_full().await.unwrap();
        assert_eq!(first.skipped, 1, "revision + fingerprint match skips");
        assert_eq!(first.downloaded, 0);

        let (second, _) = engine.pull_full().await.unwrap();
        assert_eq!(second.skipped, 1, "still skipping on repeat");

        let in_sync = engine.is_page_in_sync(&hash).await.unwrap();
        assert!(in_sync);
    }

    #[tokio::test]
    async fn offline_failure_leaves_queue_and_bookkeeping_intact() {
        let pool = memory_pool().await;
        let store = Store::new(&pool);
        let url = "https://example.com/offline";
        let hash = hash_of(url);
        seed_reader_page(&store, url, "yellow", 10).await;
        store.enqueue(&hash).await.unwrap();

        // Port 9 (discard) refuses connections — no server at all.
        let dead = DriveRest::new("http://127.0.0.1:9", token_provider());
        let mut engine = quiet_engine(&pool, dead, std::env::temp_dir());

        let err = engine.pull_full().await.unwrap_err();
        assert!(matches!(err, ScholiastError::Internal(_) | ScholiastError::Io(_)));
        assert_eq!(store.pending().await.unwrap(), vec![hash], "queue untouched");
    }
}
