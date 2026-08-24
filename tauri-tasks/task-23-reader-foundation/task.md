# Task 23: Reader Foundation

Status: DONE
Wave: 6
Depends on: task-17

## Scope & Owned Files
- Migration `0002_reader.sql` (pages/highlights/comments/drawings/diagrams tables already exist from 0001 — add any indexes: `highlights(url_hash)`, FTS-lite `pages(title)` LIKE index if needed)
- Repository commands (`src-tauri/src/commands/reader.rs`): `add_article_stub(url) -> urlHash` (extraction stub returns title+raw body), `list_articles()`, `get_page(urlHash)`, `delete_article(urlHash)`, plus generic annotation commands shared with video flow where sensible
- `ReaderPrefs` in prefs store: fontStep, serif toggle, column width
- Sanitizer contract module `crates/core/src/sanitize.rs` (pure, input HTML string → output sanitized string; implemented fully in task-25 — here: interface + unit-test scaffolding)
- Home integration point: "Add article" entry calls `add_article` then routes `/reader?url=…`

## Acceptance Criteria
- Commands tested against temp DB; `db://changed:pages` emitted
- Route renders placeholder reading pane fed by `get_page`

## Notes
Highlights/comments tables are the extension's shapes — do not alter field semantics.
