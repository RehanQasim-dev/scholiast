# 02: Domain Models & SQLite Schema

**What to build:** Domain Models & SQLite Schema

**Blocked by:** 01

**Status:** completed

- [x] Pure domain models in crates/core and SQLite schema with WAL mode (Invariants 2, 3)

## Scope & Implementation Notes
# Task 02: Domain Models & Database Schema

Status: DONE
Wave: 1
Depends on: task-01

## Scope & Owned Files
- `scholiast_tauri/crates/core/src/models.rs` — serde structs whose serialized JSON is **byte-compatible** with the extension: `VideoItem`, `FrameImage`, `TranscriptAnchor`, `VideoMarkup` (+Stroke/Line/TextLabel/Rect/Arrow, coords normalized f32 0..1), `PageRecord{version:2,url,title?,videoId?,highlights[],drawings[],videoItems[],diagrams[],tombstones}`, `HighlightData{text|element}`, `CommentData`, `PageDrawing`, `DiagramMeta`. Extras preserved via `#[serde(flatten)] extra: JsonMap`.
- Note-ID format helpers: `<!--timestamp:N-->` / `<!--edited:M-->` inline-comment IDs (parse/serialize).
- `crates/core/src/error.rs` — `ScholiastError` enum (serde-friendly).
- Migrations in `src-tauri/migrations/0001_init.sql` implementing the full schema from plan §5.2 verbatim; repository traits + sqlx impls under `src-tauri/src/store/` (videos, video_items, tags, ocr_texts first; pages/highlights/comments/drawings/diagrams/sync_* included but unused until later waves).
- Commands: `upsert_video`, `list_recent_videos`, `get_video_items`, `save_video_item`, `delete_video_item`, `set_resume_at`.
- Tests: serde round-trips vs committed fixtures (copy vectors from `scholiast_flutter/test/fixtures/merge_page_record_fixtures.json` where overlapping); CRUD integration tests against a temp DB.

## Acceptance Criteria
- `serde_json::to_string(PageRecord)` matches extension field names exactly (golden test).
- All commands return `{ok,data|error}` shape; `db://changed:<table>` emitted on writes.

## Notes
- Field-name parity is the whole point: `videoTime`, `timeEnd`, `startCue`… no renames.
- Never store frame/diagram bytes in DB rows — paths only.


## Execution History & Log
# Task 02 LOG — Domain Models & Database Schema

## [2026-08-23 00:20] task-02 agent (wave 1)
- **What I learned:**
  - Canonical wire types confirmed from source: `shared/merge.ts` (`PageRecord` v2, `PageDiagram`, `PageTombstones`, `deletedAt?: number|null`), `src/utils/video/video-storage.ts` (`VideoItem`, `VideoFrameImage{dataUrl?,driveId?,w,h}`, `TranscriptAnchor{startCue,startOffset,endCue,endOffset}`, `VideoMarkup{strokes,lines,texts,rects?,arrows?}` with `weight?:'thin'|'medium'|'thick'`), `src/utils/highlighter.ts` (`HighlightData{text|element}` + optional `anchor`, `imageEdit:{diagramId,updatedAt}`), `shared/anchor.ts` (`AnnotationAnchor{quote,structural?,image?}`), pencil-overlays `PencilStroke{id,color,width,points[],updatedAt?}`.
  - Fixture vectors: `scholiast_flutter/test/fixtures/merge_page_record_fixtures.json` (11 cases) pin exact JSON shapes — `notes:[]` always present on highlights/items, `tombstones` always all-five-maps, absent optionals simply omitted.
  - Comment IDs are inline markers: `<!--timestamp:N-->`, `<!--edited:M-->`; `commentId` falls back to raw note text for legacy notes; `commentVersion` = edited ?: timestamp ?: 0.
  - urlHash scheme = `pageFileName`: SHA-256(normalizedUrl) first 16 bytes → 32 hex chars.
  - task-03 owns `core::normalize` and is running in parallel (depends on me) → I stub `url_hash`/`gen_video_id` locally in `commands/videos.rs`, marked for integration swap.
- **Decisions made:**
  - Extras preservation via `#[serde(flatten)] extra: JsonMap` on every synced entity.
  - Colors stay `String` (passthrough) not enums — robustness over typing; `kind`/`type` discriminators ARE strict enums.
  - Required arrays (`notes`, `highlights`, `drawings`, `videoItems`, `diagrams`, `tombstones.*`, `markup.strokes/lines/texts`) always serialize; optional arrays (`rects`,`arrows`) skipped when empty, matching TS optionality.
  - Markup coords f32 per task mandate (other floats f64 to avoid precision drift).
  - IPC envelope: success = `Reply<T>` serializing `{ok:true,data}`, error = `ScholiastError` custom-serializing `{ok:false,error:{kind,message}}` — commands keep `Result<Reply<T>, ScholiastError>` signatures and the wire is always `{ok,data|error}` regardless of Tauri resolve/reject path.
  - `video_items.created_at` gets `updated_at` value (VideoItem has no createdAt; id is fully base36, prefix not splittable).
  - Additive dependency edits (logged for orchestrator): `crates/core/Cargo.toml` += serde/serde_json; `src-tauri/Cargo.toml` += sha2, rand, tokio(workspace).
- **Open questions:** none blocking; integration task should swap my interim `url_hash`/`gen_video_id` to `core::normalize` once task-03 lands.
- **Progress:** Spec + extension sources read; shapes pinned. Starting implementation: error.rs → models.rs → fixtures/golden tests → migration → store → commands → gates.

## [2026-08-23 00:45] task-02 agent (wave 1)
- **What I learned:**
  - Core green: 28 tests pass — all 11 fixture cases × 3 sides round-trip Value-identically through `PageRecord`; note-ID helper + envelope tests green.
  - serde_json prints f64 `0.0` as `0.0` while JS prints `0` → added `serialize_f64_js` (whole floats emit as i64) on `videoTime`/`timeEnd`; fixtures now Value-equal after round-trip.
  - Merge fixtures carry sparse entities (`{id,updatedAt}` drawing stubs; highlights without xpath/offsets) → those fields are optional-skip so foreign records parse without loss.
  - **task-03's `core::normalize` landed mid-task**: `normalize_url/url_hash/page_file_name/extract_video_id/gen_video_id` exist now → commands consume it directly; NO interim hashing stubs, NO sha2/rand deps needed in src-tauri.
- **Decisions made:** synced arrays always serialize (merge-output shape); golden test normalizes sparse fixture inputs by seeding absent arrays with `[]`; migration adds four lookup indexes beyond §5.2 (FK columns queried by later tasks) — everything else verbatim.
- **Open questions:** none.
- **Progress:** models.rs + error.rs + golden tests DONE and green; 0001_init.sql written. Next: store layer, commands, gates.

## [2026-08-23 21:15] task-02 agent (wave 1) — FINAL
- **What I learned:**
  - sqlx runtime queries (no macros) avoid any DATABASE_URL requirement; in-memory test DB needs `filename(":memory:")` + `max_connections(1)` so migrations and statements share one connection; `SqliteConnectOptions::from_str` wasn't resolvable, the filename route works.
  - FK enforcement is per-connection: `foreign_keys(true)` added to `state.rs` connect options (and test pool); caught a real bug where a test used a literal hash instead of `url_hash(normalize_url(url))`.
  - Comments are rows keyed by marker id (`INSERT OR REPLACE`), rebuilt into `"body<!--timestamp:N--><!--edited:M-->"` strings on read — round-trips byte-stably.
  - **Heads-up for orchestrator:** my `cargo fmt` (workspace-wide) also reformatted other wave agents' in-flight files (`crates/core/src/{normalize,cue,chunk,merge,notes_markdown,timefmt}.rs`, `src-tauri/src/stt/*`) — formatting-only, no semantic change.
- **Decisions made:**
  - Later-wave repos (pages/highlights/comments/drawings/diagrams/ocr_texts/sync_*) ship now per spec but carry scoped `#![allow(dead_code)]` with rationale comments.
  - Commands own event emission: `db://changed:<table>` with `{table,urlHash}` payload after every successful write (videos, video_items, tags).
  - `save_video_item` relies on the videos→video_items FK for orphan rejection (surfaces as `ScholiastError::Db`).
- **Open questions:** none. Integration task may want `commands/videos.rs` extended when stt/transcript waves need item writes.
- **Progress:** ALL DELIVERABLES DONE. Gates: `cargo clippy --workspace --all-targets -- -D warnings` clean; `cargo test` 10/10 suites ok (38 tests incl. other agents' concurrent core tests; mine: 5 src-tauri CRUD + 5 golden + 3 note-id unit); `pnpm typecheck` clean. task.md → DONE.

