# 07: Selection & Stylus Highlighting

**What to build:** Selection & Stylus Highlighting

**Blocked by:** 02, 06

**Status:** completed

- [x] CSS Custom Highlight API paint, SwatchPopup, and S-Pen gesture detection (Invariants 3, 4)

## Scope & Implementation Notes
# Task 29: Selection + Highlights Painting

Status: DONE
Wave: 8
Depends on: task-24

## Scope & Owned Files
- `scholiast_tauri/src/reader/highlightPaint.ts` — paint/unpaint saved text highlights over the rendered article using **CSS Custom Highlight API** (`CSS.highlights` per color), resolution order: stored xpath first → task-24 quote-anchor fallback (whitespace-insensitive + fuzzy tiers) → "unplaced" badge list
- `src/components/SwatchPopup.tsx` (shared component — coordinate with task-13's usage): yellow/red/green + 💬
- Creation flow: mouse selection inside ArticleView → popup → color → build portable anchor (task-24 capture side) + xpath when available → save highlight via reader commands (+enqueue sync)
- Repaint on mount/scroll via rAF-coalesced pass; grouped multi-range selections share `groupId`
- Click painted range → opens thread panel (task-31 surface)

## Acceptance Criteria
- jsdom/vitest: anchor create→resolve round-trip against fixture DOMs
- Component test: selection→popup→highlight persisted + repainted
- Manual gate logged: reload page → highlights reappear at correct spans

## Notes
Feature-detect Highlight API; fallback path = wrapped <mark> spans behind a flag (documented).


## Execution History & Log
# Task 29 — Selection + Highlights Painting (LOG)

## 2026-08-24 — start
- Status → IN PROGRESS.
- Contracts read: golden `src/lib/anchor/anchor.ts` (`createAnchor`, `resolveAnchor(anchor, root, surface, rootText?)`,
  `buildTextMap`, `locateRange`, `toDomRange`), `readerIpc.ts` (`save_highlight/list_highlights/
  update_highlight_color/delete_highlight`), `src-tauri/src/commands/reader.rs` arg shapes, and
  `crates/core/src/models.rs` serde names for `HighlightData::Text`
  (`{type:"text", id, xpath?, startOffset?, endOffset?, content, notes[], color?, groupId?, updatedAt?, anchor?}`,
  anchor = `{quote:{quote,prefix,suffix,occurrence}, structural?:{surface,xpath,startOffset,endOffset}}`).
- Plan §6.9 step 3 read. ArticleView task-26 tests located (must stay green).

## 2026-08-24 — implementation landed
- `src/reader/highlight-overlays.css`: `::highlight(sc-hl-yellow|red|green)` rules, fallback
  `mark.sc-hl-*` styles, `.sc-unplaced-chip` notice.
- `src/reader/highlightPaint.ts`: feature-detected CSS Custom Highlight API (one registry per
  color token); resolution = stored anchor → synthesized structural anchor from legacy
  xpath+startOffset/endOffset → bare-content quote, all through golden `resolveAnchor` with a
  single shared `buildTextMap` walk; unplaced ids returned; rAF-coalesced `schedulePaint`;
  `findHighlightRange(id)` for scroll-to; `unpaint`/`dispose`.
  - NOTE vs task brief: xpath resolution uses the golden module's `elementFromXPath`, not raw
    `document.evaluate` — the stored xpaths are the golden `xpathForElement` relative form
    (`./p[1]/…`), and this keeps create/resolve perfectly symmetric.
  - Fallback flag documented here: when `CSS.highlights` is missing (older WebKitGTK, jsdom),
    ranges are wrapped in `<mark class="sc-hl sc-hl-<color>" data-sc-hl="<id>">` spans behind
    the identical `paint/unpaint/schedulePaint/findHighlightRange` API.
- `src/reader/useHighlights.ts`: `['highlights', urlHash]` query over `list_highlights`;
  `createFromSelection(range, color)` (color param added — it comes from the popup pick),
  optimistic insert → `save_highlight` → invalidate; `recolor`/`remove` optimistic → IPC →
  invalidate. Multi-block decision: **full grouping implemented** (one stored highlight per
  leafmost block, shared `groupId`) — task-24 `createAnchor` is a pure per-range function over
  the rendered DOM, so per-block anchors are independent and sound; no clamp needed.
- `src/reader/ArticleView.tsx` (additive edits): optional `urlHash` / `onHighlightClick` props;
  same-file `HighlightsLayer` owns paint lifecycle (query settle + resize + `reader:repaint`),
  mouseup/selection-settle → SwatchPopup (task-13 component reused untouched), pick →
  createFromSelection → immediate repaint via optimistic insert, painted-range click
  hit-testing (mark spans directly; static ranges via caretPositionFromPoint/caretRangeFromPoint
  + `isPointInRange`), dismissible unplaced-count footer chip with a11y label. All task-26
  rendering/typography behavior preserved; hooks live in the layer so provider-less tests pass.
- Deviation: SwatchPopup 💬 currently just closes the popup — thread panel wiring is task-31.
Gates so far: typecheck ✓ lint ✓ ArticleView.test.tsx 5/5 ✓.

## 2026-08-24 — DONE
Gates (from `scholiast_tauri/`): `pnpm typecheck` ✓ · `pnpm lint` ✓ ·
`pnpm vitest run` ✓ **28 files / 187 tests**, incl. 22 new:
`highlightPaint.test.ts` (13: anchor create→persist→resolve round-trip, per-color registries,
legacy xpath path, unplaced, recolor repaint, image-skip, fallback mark wrap/unwrap incl. wrapped-
text equality, schedulePaint coalesce/cancel), `useHighlights.test.tsx` (5: list, optimistic
recolor, camelCase payload + portable-anchor shape, multi-block shared groupId, optimistic remove),
`ArticleView.highlights.test.tsx` (4: selection→popup→persist+repaint, painted-click →
onHighlightClick, unplaced chip + dismiss, no-urlHash inert). Pre-existing task-26
`ArticleView.test.tsx` 5/5 green.

### Bugs caught by the tests during this task
- `wrapRange` mis-used `splitText`'s return value (it returns the TAIL node) — the wrap targeted
  the wrong slice and threw IndexSizeError for mid-node ranges; fixed to split-tail-without-
  reassign then split-head, and the test now asserts the wrapped text equals the quote.
- `clampRangeToElement` branches were inverted; grouped selections produced whole-range pieces.
  Fixed against `Range.comparePoint` semantics ((el,0) ≡ first-child position).

### Anchor API consumed (task-24 golden)
`createAnchor(range, root, "web")` at capture; `resolveAnchor(anchor, root, "web", rootText)` at
paint with one shared `buildTextMap(root).text`; `locateRange`/`toDomRange` in tests. Stored-shape
bridge (`storedToAnchor`): portable anchor → legacy top-level xpath/startOffset/endOffset
synthesized as structural → bare-content quote.

### xpath-vs-quote stats approach
`paint()` returns `{placed[], unplaced[]}` per pass; resolution is xpath-first inside
`resolveAnchor` (structural verified against quote before use), quote tiers next. The layer keeps
only the unplaced count visible (dismissible a11y chip); placed/unplaced id lists are available to
future instrumentation from the same stats object. Per-tier hit counts (xpath vs exact vs ws vs
fuzzy) are NOT yet instrumented — resolveAnchor doesn't report which tier won; noted as future
work if placement analytics are wanted.

### Deviations & decisions
1. xpath resolution uses golden `elementFromXPath`, not raw `document.evaluate` — stored xpaths
   are `xpathForElement`'s relative form; symmetry with creation beats spec-path purity.
2. `createFromSelection(range, color)` takes color explicitly (popup pick supplies it).
3. Multi-block: full grouping implemented (one highlight per leafmost block sharing groupId);
   no clamp needed — per-block anchors are independent and sound.
4. SwatchPopup 💬 closes the popup only; thread panel wiring is task-31.
5. Fallback `<mark>` spans documented (no `CSS.highlights`: older WebKitGTK, jsdom).
6. Manual gate "reload → highlights reappear" NOT executed here (headless env, no webview):
   covered logically by paint-from-storage tests; needs a `pnpm tauri dev` smoke pass.

