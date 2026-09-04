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
