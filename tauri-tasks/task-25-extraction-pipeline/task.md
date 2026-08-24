# Task 25: Article Extraction Pipeline

Status: DONE
Wave: 7
Depends on: task-23

## Scope & Owned Files
- `src-tauri/src/reader/extract.rs`:
  - fetch via reqwest (UA spoofing, charset detection from headers/meta, 30 s timeout)
  - `readability` crate extraction → title/byline/body HTML
  - sanitizer: allowlist tags (p,h1-h6,ul/ol/li,blockquote,img{src,alt},a[href],em,strong,code,pre,br,hr,figure/figcaption,table set), strip style/class/id/event attrs, resolve relative URLs against base
- Wire into task-23's `add_article` (replace stub): store sanitized HTML into `pages.source_markdown`(column holds HTML body per plan §5.2 naming), title, captured_at
- Errors: paywalled/blocked (403/anti-bot) → typed error surfaced as Reader empty-state variant; non-article pages → "not readable" variant

## Reference sources
Extension `page-source-capture.ts` (Defuddle) semantics; Kotlin `ExtractionPipeline` task-25 notes.

## Acceptance Criteria
- Integration tests against saved HTML fixtures: extraction stability, sanitization strips scripts/styles/iframes, relative→absolute URL rewriting
- Idempotent re-capture does not duplicate rows

## Notes
Images stay remote URLs (no proxying) — matches extension behavior.
