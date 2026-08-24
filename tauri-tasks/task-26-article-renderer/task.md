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
