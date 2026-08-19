# Task 02 — Shared data model (Kotlin DTOs + Room schema)

Status: DONE

## Objective
Define the app's single source of data truth: the kotlinx.serialization DTOs that mirror the desktop extension's TS types byte-for-byte, plus the Room database schema. Every other task consumes these types.

## Scope — files you OWN (in `../android/app/src/main/java/com/scholiast/android/`)
- `data/model/` — all `@Serializable` DTOs: `VideoItem`, `TranscriptAnchor`, `FrameImage`, `VideoMarkup` (+ `Stroke`, `Line`, `TextLabel`, `Rect`, `Arrow`), `VideoPage` (PageRecord: `version`, `url`, `title`, `videoId`, `highlights`, `drawings`, `videoItems`, `diagrams`, `tombstones`), `PageSource`
- `data/db/` — Room: `AppDatabase`, `VideoPageEntity` (urlHash PK, url, videoId, title, itemsJson, updatedAt, snapJson, fileId, headRevisionId), `OcrTextEntity` (itemId PK, text, source, createdAt), `SyncMetaEntity`, DAOs, `TypeConverters` (JSON columns)
- `data/notes/` — `VideoItemRepository` interface + Room-backed implementation (upsert page, load page, list recent pages, add/update/delete items, note timestamp parsing helpers)

## References (read first)
- `../scholiast_mobile_app_plan.md`: §2 (byte-compatible data), §4.2 (exact Kotlin DTO shapes — copy them), §4.3 (local persistence table), §4.5 (Drive layout), §3.3 (package layout)
- Desktop sources to mirror: `../src/utils/video/video-storage.ts` (VideoItem DTOs), `../shared/merge.ts` (PageRecord shape), `../src/utils/video/video-notes.ts` (note string format `text<!--timestamp:N--><!--edited:M-->`)

## Requirements
- Field names and JSON serialization must match the TS types exactly (kotlinx `@SerialName` where the field name differs from Kotlin conventions; `explicitNulls = false` if the TS omits nulls).
- `notes: List<String>` with the `<!--timestamp:...--><!--edited:...-->` embedded format — provide parse/format helpers in this task (used by every editor/rendering task).
- `excalidrawScene` preserved as `JsonElement`, ignored by the app.
- `ocrText: String?` app-only additive field on VideoItem (allowed — additive fields don't break desktop compat).
- Room: JSON columns via converters; expose `@Transaction` page-load that returns the parsed DTO.
- Repository must be testable: interface + impl, constructor-injected DAOs.

## Acceptance criteria
- Unit tests prove a `VideoItem` serializes to the exact JSON the TS `video-storage.ts` would produce (use fixtures: copy sample JSON from the desktop repo's tests or construct equivalent ones, including a frame item with markup, a transcript item with anchor, and a note item with edited comments).
- `notes` parse/format round-trips with embedded timestamps.
- Room schema builds (`./gradlew :app:kaptDebugKotlin` or KSP equivalent succeeds); migrations documented for v1 (schema v1 only is fine).

## Agent notes
- This task is the contract for tasks 06, 07, 08, 13, 14, 15, 17, 20 — keep the DTO shapes exactly as the plan defines them and note any deviation in your LOG.md.
- Where the desktop repo uses `Long` timestamps (updatedAt in ms), match that; do not invent new units.
- Write your log to `LOG.md` as you work.