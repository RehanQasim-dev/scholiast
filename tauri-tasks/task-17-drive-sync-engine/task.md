# Task 17: Drive Sync Engine

Status: DONE
Wave: 4
Depends on: task-16, task-02

## Scope & Owned Files
- `crates/core/src/merge.rs` — port of `shared/merge.ts::mergePageRecord`: newest-wins per item, per-page tombstones (+GC), comment merge preserving inline-timestamp IDs, `pageFileName`. **Golden tests** must reproduce TS outputs from committed fixtures (reuse `scholiast_flutter/test/fixtures/merge_page_record_*` vectors).
- `src-tauri/src/sync/engine.rs`:
  - `assemble_local_page(urlHash)` from store tables (videos/items/drawings/diagram pointers/highlights-ready)
  - push: upload missing blobs (`frames/frame-<id>.jpg`, `diagrams/diagram-<id>.png|.scene.json`) → PUT `pages/page-<hash>.json` CAS on `headRevisionId` → update `sync_meta`+`sync_snapshots`
  - pull/full reconcile: list `pages/*` as manifest; skip unchanged (revision match AND local fingerprint == snapshot fingerprint, tombstones-excluded like extension); else download → merge → write-back + re-upload if changed → pull missing blobs
  - offline-safe errors leave queue intact
- `src-tauri/src/drive/rest.rs` — Drive REST client (list/upload/update/download, appdata params)
- Commands: `sync_now()`, `is_page_in_sync(urlHash)`
- Integration tests with wiremock covering push/pull/conflict paths

## Acceptance Criteria
- Golden merge tests byte-equal to fixtures (CI-blocking)
- Engine test: two-device conflict scenario resolves per merge rules

## Notes
Image bytes never enter JSON payloads (pointers only). Emit `db://changed:*` after merged writes.
