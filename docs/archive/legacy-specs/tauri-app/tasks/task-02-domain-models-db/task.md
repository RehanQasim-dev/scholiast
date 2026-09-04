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
