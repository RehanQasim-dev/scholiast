# Task 03: URL Normalization & ID Generation

Status: DONE
Wave: 1
Depends on: task-02

## Scope & Owned Files
- `scholiast_tauri/crates/core/src/normalize.rs`
  - `normalize_url(&str) -> String` — strip fragment; drop `utm_*`, `fbclid`, `_ga`; YouTube-specific `t`/`start` stripping; keep order-stable query encoding identical to the TS/Kotlin ports.
  - `url_hash(&str) -> String` — SHA-256 prefix, same length scheme as repo (`pageFileName` compat).
  - `extract_video_id(&str) -> Option<String>` — watch?v=, youtu.be/, shorts/, live/.
  - `page_file_name(hash) -> String` → `pages/page-<hash>.json`.
  - `gen_video_id() -> String` — base36 ms timestamp + random suffix, matching `genVideoId`.

## Reference sources (read before porting)
- Extension: `../src/utils/highlighter.ts` (normalizeUrl), `shared/merge.ts` (pageFileName)
- Kotlin port: `../android/app/src/main/java/com/scholiast/android/data/normalize/`

## Acceptance Criteria
- Unit tests ported from the Dart port (`normalize_test.dart`) — all vectors pass byte-for-byte.
- Property test: normalize is idempotent; hash is stable.

## Notes
This module feeds Drive file naming and every FK — correctness here is data integrity.
