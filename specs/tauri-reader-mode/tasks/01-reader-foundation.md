# 01: Reader Foundation & Pages Repository

**What to build:** Reader Foundation & Pages Repository

**Blocked by:** None

**Status:** completed

- [x] pages table and repository commands in Rust backend (Invariant 1)

## Scope & Implementation Notes
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


## Execution History & Log
# Task 23 — Reader Foundation (LOG)

## 2026-08-24 — Status: DONE

### Delivered
- **Migration `0002_reader.sql`**: idempotent `CREATE INDEX IF NOT EXISTS` for
  `highlights(url_hash)` + `comments(highlight_id)` (both already existed in 0001 —
  re-declared so pre-split DBs converge), plus new `pages(updated_at)`. Verified on a
  fresh temp **file** DB in `migrations_apply_on_fresh_temp_file_db`.
- **`store/pages.rs` (NEW)**: `ArticlesRepo` — `list_articles()` → camelCase
  `ArticleSummary {urlHash,url,title,domain,updatedAt}` ordered by recency with a
  dependency-free `domain_of` host parser; `touch_updated_at()` (annotated
  `#[allow(dead_code)]`: contract for wave 28+, exercised by tests).
- **`store/highlights.rs` (APPENDED)**: pre-existing scaffolding file already held
  `PagesRepo`/`HighlightsRepo` (full-page replace, used by sync). Added the per-item
  `AnnotationRepo`: single-highlight upsert (thread rides along, comments replaced),
  delete (returns owning page hash; FK cascades comments), recolor, comment
  save/list/delete keyed by inline-timestamp marker ids preserved EXACTLY, and
  `highlight_page` for event routing. Every write bumps the highlight + page
  timestamps.
- **`commands/reader.rs` (NEW)**: all 11 commands registered at the END of lib.rs's
  handler list — `add_article, list_articles, get_page, delete_article,
  save_highlight, list_highlights, delete_highlight, update_highlight_color,
  save_comment, list_comments, delete_comment` — Reply envelope, local
  `emit_changed` helper (replicated, videos.rs untouched): writes emit
  `db://changed:pages|highlights|comments`. `add_article` STUB: no fetch, title
  derived from URL host+path (`derive_title_from_url`), raw empty body stored via
  immutable `set_source_markdown`; signature stable for task 25.
- **`crates/core/src/sanitize.rs` (NEW)**: task-01 stub did not exist yet, so created
  it — pure, zero deps: `Sanitizer` trait + `NoopSanitizer` + object-safety/contract
  tests. Registered in core `lib.rs` (one-line addition, flagged below).
- **Frontend**: `src/lib/readerIpc.ts` (typed wrappers for all commands);
  reader pref keys `reader.font_step` / `reader.serif` appended to the existing
  store.ts facade (no recreation); `Home.tsx` gained an "Add article" secondary
  field next to OpenLinkField that invokes `add_article({url})` then navigates;
  `Reader.tsx` placeholder replaced with a minimal centered reading pane querying
  `['page', urlHash]`, capture-pending empty state, and font-step/serif toggles
  bound to prefs (inline typography vars; full design deferred to task 26).

### Deviations / notes for orchestrator
1. **Navigation param**: Home routes to `/reader?url=…&h=<urlHash>` (spec said
   `/reader?url=…`). Reader queries by hash; porting normalize+sha256 to TS would
   duplicate `core::normalize`, so add_article's returned hash is passed explicitly.
2. **`store/highlights.rs` was NOT new** — waves 2/17 pre-created it as scaffolding
   (its header says repos land in waves 23–32). Treated as owned per this task's
   ownership grant; existing traits left untouched, additions are append-style.
3. **Shared-file touches**: `crates/core/src/lib.rs` (+1 line module registration),
   `src-tauri/src/store/mod.rs` (+1 line), `src-tauri/src/commands/mod.rs` (+1 line),
   `src-tauri/src/lib.rs` (11 handler entries at end), `src/lib/store.ts` (+2 keys) —
   all additive.
4. **Concurrent sibling work**: task-18 edited `Home.tsx` mid-flight (added
   `<SyncStatusBar/>`) without its import, briefly breaking shared lint/typecheck/
   vitest gates. I repaired only my owned file (added their missing import); their
   component/hook errors were resolved by them shortly after. Final snapshot is
   fully green with no outstanding sibling breakage.

### Gates (final, from `scholiast_tauri/`)
- `cargo clippy --workspace --all-targets -- -D warnings` ✅ 0 errors
- `cargo test --workspace` ✅ 126 passed (incl. 8 new: migration-on-fresh-temp-file,
  article list/touch round-trips, highlight save/recolor/delete cascade,
  comment-marker preservation, page-delete cascade, stub-title derivation,
  Reply-envelope integration shape)
- `pnpm lint` ✅ · `pnpm typecheck` ✅ 0 errors · `pnpm vitest run` ✅ 134/134

