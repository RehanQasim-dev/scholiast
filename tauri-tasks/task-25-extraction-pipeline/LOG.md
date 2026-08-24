# Task 25 — Extraction Pipeline (LOG)

## 2026-08-24 — IN PROGRESS

- Set task Status → IN PROGRESS. Read plan §6.9, task.md, task-23 contract
  (`crates/core/src/sanitize.rs` trait + `NoopSanitizer`), `commands/reader.rs`,
  `store/pages.rs`, `store/highlights.rs` (PagesRepo), `error.rs`, extension
  `page-source-capture.ts` (fire-and-forget capture; failure = retryable).
- **Extractor choice**: probed crates.io via `cargo info`:
  - `readability` v0.3.0 (kumabook) — stale (~2023), drags unmaintained deps
    (`unhtml`); rejected.
  - `dom_smoothie` v0.18.0 (niklak) — actively maintained pure-Rust port of
    Mozilla Readability (release June 2026), faithful title/byline/content
    extraction incl. JSON-LD/OpenGraph metadata. **CHOSEN** — it is the
    maintained readability crate today and satisfies plan §6.9.
  - `scraper` v0.27.0 added to `crates/core` for the sanitizer's DOM walk
    (html5ever parse; hand-rolling an entity-correct tokenizer riskier than a
    vetted parser). `url` for relative→absolute resolution.
- Deps added: `crates/core`: scraper, url, ego-tree (type needed for the tree
  walk). `src-tauri`: dom_smoothie, encoding_rs. reqwest (charset+rustls) +
  wiremock dev-dep already present.

## 2026-08-24 — Implementation

### crates/core/src/sanitize.rs (full impl)
- Kept the task-23 contract (`Sanitizer` trait, object-safe) + `NoopSanitizer`;
  added `AllowlistSanitizer { base_url }` and pure free fn
  `sanitize_html(html, base_url: Option<&str>)`.
- Policy: allowlist exactly per task (p,h1-h6,ul/ol/li,blockquote,img,a,
  em,strong,i,b,code,pre,br,hr,figure,figcaption,table set). Attributes:
  only `img[src,alt]`, `a[href]`; everything else stripped (style/class/id/
  data-*/on* gone; srcset/sizes can't survive). `script/style/noscript/
  template/iframe/svg/math/video/audio/object/embed/canvas/head/meta/link/
  base/form controls` dropped **with subtree**; other unknown tags unwrapped
  so text inside span/div wrappers survives. Comments/doctypes/PIs never
  emitted. Text+attr values re-escaped on output → idempotent sanitize.
- URLs: browser-like cleaning (trim, strip control chars), RFC 3986 join via
  `url::Url::join` (relative, protocol-relative, #frag), then http(s)-only
  enforcement → javascript:/data:/mailto: dropped.
- Tests: 17 inline (structure passthrough, script/style/iframe/svg removal,
  event-attr stripping, relative→absolute, srcset drop, javascript:/data:
  refusal, unwrap semantics, entity round-trip, idempotence, fixture-driven).

### crates/core/src/error.rs
- Added three variants for the capture path (frontend distinguishes by
  `kind`): `Network(String)` → `"network"`, `FetchBlocked(u16)` →
  `"fetchBlocked"` (message carries "HTTP 403 Forbidden"-style static text;
  wire shape `{ kind, message }` unchanged), `NotReadable(String)` →
  `"notReadable"`. Existing variants untouched.

### src-tauri/src/reader/extract.rs (new module)
- `fetch_html`: reqwest GET, desktop Chrome UA, 30 s timeout; non-success
  status → `FetchBlocked(status)`; connect/DNS/timeout/body → `Network`.
  Decode order mirrors browsers: BOM → Content-Type charset param →
  `<meta charset>` sniff (first 4 KiB) → UTF-8 lossy (`encoding_rs`).
- `extract_article`: `dom_smoothie::Readability::new(html, Some(url), None)`
  → `is_probably_readable()` gate (nav-only shells would otherwise "succeed"
  with menu links) → `parse()` → empty content ⇒ `NotReadable`.
- `capture_article_html`: fetch (async IO) then extract+sanitize inside
  `tokio::task::spawn_blocking` (Readability walks the whole DOM).
- Tests (wiremock): latin1 via header charset; meta-charset fallback when the
  header lacks one; 403 → FetchBlocked(403); refused connect → Network;
  fixture extraction (title/byline/body, stable across runs); nav-heavy junk
  page → NotReadable; full pipeline sanitizes + makes URLs absolute.

### Fixtures (crates/core/tests/fixtures/reader/)
- `dirty-article.html`: realistic blog post with scripts/styles/event attrs/
  iframe/svg/forms, relative + protocol-relative img/a, srcset/sizes,
  blockquote/list/table/pre — used by both core sanitize tests and src-tauri
  extraction tests.
- `junk-nav-page.html`: nav/cookie/login/footer chrome with zero article
  prose — must fail the readability gate.

### commands/reader.rs (add_article internals)
- New `capture_article(store,url,title_override)` helper + slim command that
  emits `db://changed:pages`. Pipeline runs before any DB write, so a blocked/
  unreadable capture persists nothing. Title precedence: explicit override >
  extractor title > URL-derived fallback (`derive_title_from_url` kept).
- **Idempotent re-capture**: `pages.url_hash` keys the normalized URL; body +
  `captured_at` are refreshed on the single existing row (verified: COUNT=1,
  captured_at strictly increases). This required a direct UPDATE in
  commands/reader.rs because `PagesRepo::set_source_markdown` deliberately
  COALESCEs (extension-side immutable-once rule) and store/* is forbidden to
  this task — deviation logged below.
- DB-level integration tests with wiremock: stores sanitized body w/ extractor
  title; re-capture updates in place without duplicates; 403 → fetchBlocked
  and no row persisted; junk page → notReadable; non-http(s) input rejected
  up front; explicit title override wins.

## 2026-08-24 — Debugging notes (for future waves)

- Concurrent wiremock tests cross-served each other's mocks (junk-URL test
  received article HTML; a 403 test got 200). Two causes fixed:
  1. helpers dropped `MockServer` before the test ended → its ephemeral port
     could be rebound by a sibling test mid-flight. Helpers now return the
     server; tests hold it to completion.
  2. a process-wide shared reqwest client pooled keep-alive connections that
     outlived their server. `make_client()` now builds per fetch — a capture
     issues exactly one GET, so pooling bought nothing anyway.
- `encoding_rs::Encoding::decode` takes `&'static self`; keep the `&'static`
  through helpers instead of an anonymous lifetime.

## 2026-08-24 — DONE

- Gates from `scholiast_tauri/`:
  - `cargo clippy --workspace --all-targets -- -D warnings` ✅ clean.
  - `cargo test --workspace` ✅ 160 passed / 0 failed (scholiast lib 93,
    core 23, cue 8, golden 5, merge 3, normalize 28). Reader suite green 4×
    consecutively (flake class eliminated).
- Status → DONE.

## Deviations & ownership notes

1. **Extractor = `dom_smoothie`, not the `readability` crate** — sanctioned
   by the task ("pick a maintained one"): `readability` 0.3.0 is dormant with
   unmaintained transitive deps; dom_smoothie is the maintained Readability
   port (June 2026 release).
2. **crates/core gained deps** (scraper, url, ego-tree) though task-23 called
   the stub "zero dependencies". Justified: an allowlist sanitizer needs an
   entity-correct HTML parser and RFC 3986 URL joins; both vetted choices.
3. **One scaffold line added to `src-tauri/src/lib.rs`**: `mod reader;`
   (integration touch outside strict file ownership — the new module dir is
   unreachable without it; flagged here per AGENTS.md rule).
4. **Re-capture UPDATE written directly in commands/reader.rs** instead of a
   new PagesRepo method: store/* is forbidden to this task and
   `set_source_markdown`'s COALESCE contradicts the required re-capture-
   updates semantics. Integration task may hoist this into the repo layer.
5. **Sibling concurrency observed**: task-27 landed `SyncQueueRepo::enqueue`
   calls into reader.rs's other commands while this task was in flight
   (initially red, then completed on their side). My edits stayed within
   add_article internals + tests; final workspace gates green including
   their code.
