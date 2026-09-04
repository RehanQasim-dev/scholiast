# 04: Article Reader Renderer

**What to build:** Article Reader Renderer

**Blocked by:** 01

**Status:** completed

- [x] Single-column dark/sepia reading view with measured typography (Invariant 2)

## Scope & Implementation Notes
# Task 26: Article Renderer

Status: DONE
Wave: 7
Depends on: task-23

## Scope & Owned Files
- `scholiast_tauri/src/reader/ArticleView.tsx` — renders sanitized article HTML from `get_page`:
  - measured single reading column (736px default, ReaderPrefs width), dark tokens, Geist chrome / serif body option
  - typography scale per plan §7 (headings, blockquote accent bar, code blocks, image max-width, hairline hr)
  - images lazy-loaded; broken-image chip fallback
- Top bar slot (title, back) — full shell belongs to task-28; keep this component embeddable
- Font-step + serif toggles applied via CSS vars from prefs; persisted on change
- Error/empty states: not-readable, offline-captured-only, deleted

## Acceptance Criteria
- Component tests render fixture articles (sanitized fixture from task-25) with expected structure
- XSS smoke: injected event handlers/styles absent after render

## Notes
No annotation logic here — task-29 paints into this DOM.


## Execution History & Log
# Task 26 — Article Renderer (LOG)

## 2026-08-24 — Status: DONE

### Delivered
- **`src/reader/ArticleView.tsx` (NEW)**: renders `get_page`'s sanitized body as a
  measured single reading column — title header + byline-if-present in Geist chrome,
  then `.sc-article-body`. Column width from prop (default **736**) capped to
  `min(<width>, 100%)` so narrow windows never overflow. Empty/error states inside
  the component: empty body → task-23 copy *"Capture pending — extraction lands in
  the next wave"*; `notReadable` variant prop swaps it; deleted article stays with
  the parent query error (Reader's existing states untouched). Optional
  `footerAction` node lets the host drop its Back-to-Home link into the state card.
- **Typography** (`src/reader/reader-typography.css`, NEW, all styles scoped under
  `.sc-article`): font scale via `--reader-font-step` on the root
  (`calc(1rem + step * 1px)`), headings sized in `em` so they stay proportional;
  serif pref (`reader.serif`) swaps only the reading typeface
  (`"Libre Caslon Text", Georgia, serif`); blockquote gets a 3px
  `var(--sc-accent)` bar; code blocks sit on `var(--sc-elevated)` (= #151824) with
  hairline border, `pre` scrolls horizontally; images max-width 100% + rounded;
  hairline `hr`; hairline-bordered tables; links in `var(--sc-accent)`, underlined
  on hover. No hardcoded hex — everything maps to `styles/tokens.css`.
- **Images**: after mount, every `<img>` gets `loading="lazy"`; an `error` listener
  swaps the failed image for a bordered chip (`.sc-article-imgchip`,
  `data-testid="broken-image-chip"`) carrying the alt text (or "Image
  unavailable"); already-broken images (`complete && naturalWidth === 0`) swap
  immediately.
- **XSS posture**: body rendered via `dangerouslySetInnerHTML` exactly as stored —
  no client-side re-sanitization (trust boundary documented on the prop: sanitizer
  is Rust-side, task-25 allowlist). As defense-in-depth against a sanitizer
  regression only, a post-mount sweep removes any `script` node / `on*` attribute /
  `javascript:` URL that slipped through, and `import.meta.env.DEV` +
  `/<script/i.test(body)` fires a `console.warn` tripwire. Invariant asserted by
  test: dirty fixture leaves **no script node, no `onerror`, no live `href`** in
  the output DOM while legitimate content survives.
- **Compose edit of `src/routes/Reader.tsx`**: kept its query (`['page', urlHash]`)
  and all pref wiring; added a `columnWidth` pref load; title header moved into
  ArticleView (top-bar shell still belongs to task-28); A−/A+/Serif toggles and the
  four parent-level states unchanged; article branch now renders `<ArticleView>`.
- **Additive store edit** (`src/lib/store.ts`, task-19 file, DONE): appended
  `readerColumnWidth: "reader.column_width"` to `PREF_KEYS` and default `736` to
  `PREF_DEFAULTS`. No behavior change for existing keys.

### Pref keys added
- `reader.column_width` (number, default 736) — alongside existing
  `reader.font_step` / `reader.serif`.

### Tests (`src/reader/ArticleView.test.tsx`, NEW — 5 tests)
Fixture structure (title/byline/h2/link/blockquote/img + `loading="lazy"`) ·
font-step/serif/column-width applied from props incl. defaults · broken-image chip
on `fireEvent.error` (img removed, alt preserved) · dirty-fixture XSS smoke (no
script node / handlers, dev warn fired) · capture-pending vs notReadable copies.

### Deviations / notes for orchestrator
1. **Post-mount hazard sweep vs "must NOT re-sanitize"**: read strictly, a raw
   `dangerouslySetInnerHTML` would leave a parsed-but-unexecuted `<script>` node in
   the DOM, contradicting the required "no script node for a dirty fixture"
   assertion. Implemented as a narrow invariant sweep (script nodes, `on*` attrs,
   `javascript:` URLs) explicitly documented as defense-in-depth, not a second
   sanitizer — legitimate content is never filtered. Flagging in case the
   orchestrator wants it dev-only instead.
2. **Byline**: `PageView` carries no byline yet (readability extraction lands in
   task-25), so Reader doesn't pass one; the prop is ready and tested via fixture.
3. **`get_page` body empty today** (task-25 not landed): Reader shows the
   capture-pending card — verified path exercised by the empty-state test.

### Gates (final, from `scholiast_tauri/`)
- `pnpm lint` ✅
- `pnpm typecheck` ✅ 0 errors
- `pnpm vitest run` ✅ 139/139 (21 files; 5 new in ArticleView.test.tsx)

