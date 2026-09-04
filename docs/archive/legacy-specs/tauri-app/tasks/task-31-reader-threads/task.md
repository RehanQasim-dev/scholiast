# Task 31: Thread Panel + Actions

Status: DONE
Wave: 9
Depends on: task-28

## Scope & Owned Files
- `scholiast_tauri/src/reader/ThreadPanel.tsx` — docked right panel listing the page's annotations (quote header in highlight color + comment threads below), active-thread expansion with reply box focused (WhatsApp-style pinned quote above input)
- Comment editor reuse (task-07 components) incl. mic (task-09/10 chain) and tag autocomplete
- Per-comment edit/delete (inline timestamps preserved); recolor via swatch; **delete annotation with Undo** (snapshot + restore command); reply threading identical to video notes semantics
- Clicking a thread scrolls ArticleView to its highlight (via paint API from task-29)

## Acceptance Criteria
- Component tests: add/edit/delete/recolor flows persist + invalidate queries; undo restores
- Manual gate: two annotations threaded without layout jump on expand/collapse

## Notes
Same markdown renderer (task-08) everywhere — no second implementation.
