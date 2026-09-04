# Technical Spec: Tauri Margin-Anchored Comment Cards

## Context
Reader annotations today live in `ThreadPanel` (own scroll list, newest-first)
beside the article via `SplitterPane`, or in a bottom sheet when narrow.
The extension instead anchors collapsed cards beside source lines in one
scroll flow (`src/utils/comment-overlays.ts`: absolute column, document-order
stacking, gutter reservation, `COMMENT_BOX_WIDTH 384 / MIN 220 / MAX_SHARE
0.45`). This spec ports that UX onto the app's tokens and React surfaces.

Key files:
- `scholiast_tauri/src/reader/ThreadPanel.tsx` (state + render to split)
- `scholiast_tauri/src/reader/ThreadCard.tsx` (reused collapsed/expanded card)
- `scholiast_tauri/src/reader/highlightPaint.ts` (`findHighlightRange`)
- `scholiast_tauri/src/routes/Reader.tsx` (scroller + SplitterPane wiring)
- `scholiast_tauri/src/lib/store.ts` (prefs)

## Proposed Changes & Module Seams

- **`marginLayout.ts` (new, pure)**: `layoutMarginColumn(items: {key,
  anchorTop, height}[], gap)` → `{key, top}[]`. Stable sort by anchor
  (`Infinity` = unplaced, sinks last), walk `top = max(anchor, prevBottom +
  gap)`. Unit-tested; mirrors the extension's no-overlap stacking.
- **`useThreadModel.ts` (new hook, extracted from ThreadPanel)**: entries
  grouping, `activeKey` + `activate` (scroll-to-highlight + reply focus),
  reply draft/tag/send, recolor/delete/edit mutations with optimistic patches
  + undo, `j/k` + `selectRequest` effects. `ThreadPanel` keeps its exact JSX
  over this hook (batch 1 must keep `ThreadPanel.test.tsx` green); batch 2
  consumers reuse it. No second mutation implementation (plan §3.2: React
  ephemeral UI state only; Rust still owns persistence via `readerIpc`).
- **`ReplyComposer.tsx` (new, presentational, extracted from ThreadPanel)**:
  textarea + format row + send + `TagAutocomplete`, optional quote-context
  slot. Rendered at the panel bottom (unchanged) and inside the expanded
  margin card.
- **`useMarginAnchors.ts` (new)**: per entry, representative highlight id →
  `findHighlightRange(id).getBoundingClientRect().top - stackRect.top`
  (viewport-diff ⇒ scroll-independent content coords). Re-runs on entries,
  `layoutKey` (font/column/theme/mode), `resize`, `reader:repaint`, and stack
  `ResizeObserver` (images/fonts reflowing the article).
- **`MarginColumn.tsx` (new)**: absolute `inset-y-0 right-0` layer inside the
  article stack (pointer-events-none except cards + splitter). Measures card
  heights via refs + `ResizeObserver` (collapsed estimate until measured),
  places with `layoutMarginColumn`, renders `ThreadCard` + inline
  `ReplyComposer` when active. Owns the invisible full-height splitter that
  writes the `reader.margin_width` pref (new key, default 340, clamped to a
  viewport share like the extension's 0.45 cap).
- **`Reader.tsx`**: reader-mode + `!isNarrow` + `annotationsOpen` renders the
  margin stack (article fixed at `columnWidth`, stack `mx-auto`, margin layer
  right) instead of `SplitterPane`; undo toast rendered floating. Narrow
  sheet, web-mode panel, and all highlight/selection flows untouched.
- **Batch 2 — web mode** (`tasks/02`): paint stored highlights inside the
  same-origin `srcDoc` iframe (anchor capture on selection + injected paint
  script, mirroring `highlightPaint.ts`), measure marks via
  `iframe.contentDocument`, render the margin layer as an overlay column that
  tracks iframe inner scroll (same-origin scroll listener, rAF-throttled).
  `ThreadPanel` retires from Reader only after batch 2 verifies.

## Testing and Validation
- **Test 1 (margin stacking)**: overlap/gap/document-order/unplaced-last
  cases for `layoutMarginColumn`. Validates invariants 2, 3.
- **Test 2 (panel unchanged)**: existing `ThreadPanel`/`ThreadCard` suites
  stay green after the hook extraction. Validates invariant 10.
- **Test 3 (wiring)**: margin stack renders beside `ArticleView` when wide +
  open, sheet when narrow; splitter persists pref (RTL: existing component
  tests + `tsc --noEmit`).
- **Test 4 (web mode, batch 2)**: anchor measure + scroll tracking.

## Execution Slicing (Batches)
- Batch 1: tasks/01 (reader-mode margin column). No Rust changes.
- Batch 2: tasks/02 (web/iframe margin column + anchor capture/paint).
