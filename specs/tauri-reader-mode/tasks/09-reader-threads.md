# 09: Reader Thread Panel & Actions

**What to build:** Reader Thread Panel & Actions

**Blocked by:** 07

**Status:** completed

- [x] Side panel comment threads, reply nesting, and recoloring (Invariant 4)

## Scope & Implementation Notes
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


## Execution History & Log
# Task 31 — Thread Panel + Actions (LOG)

## 2026-08-24 — start
- Status → IN PROGRESS.
- Contracts read: `useHighlights.ts` public API (`highlights/recolor/remove/createFromSelection`,
  query key `["highlights", urlHash]`, notes ride on each highlight), `readerIpc.ts` exact args
  (`save_comment {highlightId, note}` → `CommentView{id,body,createdAt,editedAt}`;
  `list_comments`; `delete_comment {commentId}`; `update_highlight_color {highlightId,color}`;
  `delete_highlight {highlightId}`; `save_highlight {urlHash, highlight}` upserts by id),
  `src-tauri/src/commands/reader.rs` + `store/highlights.rs` (comments stored parsed, marker
  strings rebuilt as `body<!--timestamp:N-->[<!--edited:M-->]`, id preserved),
  `noteMarkdown.ts` (`parseNoteMarkdown`/`renderNoteNodes`/`serializeToPlainText`/`stripHiddenIds`),
  `highlightPaint.ts` exports (`findHighlightRange`, `schedulePaint`, `paintedHighlightIds`),
  `ArticleView.tsx` (`onHighlightClick?` + `urlHash?` props ready from task-29),
  `Reader.tsx` reserved `thread-panel-slot` aside, `useReaderKeyboard.ts`
  (`reader:next-annotation` CustomEvent `{direction:1|-1}`), `Toast.tsx` (message-only API,
  no action buttons), `TagAutocomplete.tsx` exports, tokens.css (`--sc-hl-*`, `--color-hl-*`).
- Concurrent siblings noted: task-28 owns Reader.tsx (my edit will be minimal/append-only at the
  reserved slot), task-30 wires mic into CommentEditorSheet (consuming public props only).

## 2026-08-24 — implementation landed
- `src/reader/ThreadCard.tsx`: one card per annotation — quote header with color left-rail +
  `color-mix` tinted bg + 2-line clamp + meta line (relative time from creation-ts decode,
  reply count); hover actions = 3-swatch recolor row (own color disabled) + single-click delete;
  when active, thread renders below via `renderNoteNodes(parseNoteMarkdown(note))` (edited badge +
  hidden timestamp ids come free from the shared renderer), per-comment hover Edit/Delete,
  inline edit textarea prefilled via `stripHiddenIds`. Exports `parseThreadComments`
  (marker strings → `{highlightId, id, note, createdAt, editedAt}`), `createdTs` (base36 id head
  decode — "when made", dashboard ordering semantics), `relativeTime`, `COLOR_TOKENS`.
- `src/reader/ThreadPanel.tsx`: groups highlights by `groupId ?? id` (extension semantics — a
  multi-block selection is ONE thread; comments merged across members sorted by createdAt; new
  replies target the first member), newest-first by createdTs. Consumes `useHighlights()` public
  API for list/recolor/remove; mirrors its query key `["highlights", urlHash]` for optimistic
  comment patches so article repaint flows through HighlightsLayer's existing effect. Reply
  composer pinned at panel bottom for the active thread only: quote chip above input, same four
  format buttons as CommentEditorSheet (B/I/Link/•List over textarea selection), TagAutocomplete
  reuse (`list_tags`, arrows/Enter/Tab/Esc identical). j/k contract: window listener on
  `reader:next-annotation {direction}` → wrap-around walk of visible order → activate + card
  scrollIntoView(nearest) + reply focus. `scrollToHighlight(id)` retries `findHighlightRange`
  ~10 rAFs then scrolls block:center (smooth unless prefers-reduced-motion; guarded for jsdom).
  External `selectRequest {id, nonce}` prop for ArticleView clicks.
- Undo pattern: one slot above composer, latest op wins, 5s timer. Delete annotation snapshots
  every member payload BEFORE hook.remove(); Undo re-saves each via save_highlight (same ids/
  anchors/notes) → invalidate. Delete comment snapshots the exact marker string + position;
  Undo re-inserts optimistically and re-saves via save_comment (INSERT OR REPLACE keeps the id).
  Edit rebuilds `body<!--timestamp:SAME_ID--><!--edited:NOW-->` — ids preserved EXACTLY.
- `src/routes/Reader.tsx` (minimal wiring only): import ThreadPanel + selectRequest state +
  handleHighlightClick; ArticleView gains `urlHash={urlHash}` + `onHighlightClick`; reserved
  aside now mounts ThreadPanel, width `w-[320px]` when urlHash && !focusMode else w-0 (removed
  aria-hidden placeholder). No other structure touched.

## Decisions (per brief "choose & log")
1. **Reply box = slim inline composer, NOT CommentEditorSheet.** The sheet hardwires
   `save_video_item` internally (its onSave fires AFTER persisting a video item), so mounting it
   would write reader comments into the video store; fixing that means editing forbidden files.
   Reused instead: TagAutocomplete component + the sheet's exact four formatting transforms +
   identical markdown conventions/tags query key. Mic slot intentionally absent here — task-30's
   chain lands in the sheet/MicButton; panel integration point noted for integration task.
2. **Edit = inline textarea prefilled via stripHiddenIds** (byte-equal to
   serializeToPlainText∘parseNoteMarkdown for well-formed markers, which Rust guarantees by
   storing parsed comments only). Simpler than swapping the whole card to editor mode.
3. **Undo affordance = in-panel bar** ("Deleted … / Comment deleted." + Undo button, 5 s) instead
   of toast(): Toast.tsx (components root, forbidden) has a message-only API with
   pointer-events-none — no action-button surface without editing it. Functionally equivalent.
4. Panel additionally collapses in focus mode (consistent with rail/topbar collapse); brief only
   required hiding when no article selected.

## Deviations / notes
- SwatchPopup 💬 still just closes the popup (ArticleView.tsx forbidden): creating-a-comment-
  from-selection wiring remains for the integration task; everything downstream (select thread,
  scroll, reply) works once an annotation exists or is clicked.
- Card meta shows creation time (id-decoded), not updatedAt — comments must not reorder threads.

## 2026-08-24 — DONE
Gates (from `scholiast_tauri/`): `pnpm lint` ✓ clean · `pnpm typecheck` ✓ clean ·
`pnpm vitest run` ✓ **30 files / 206 tests** incl. 8 new in `ThreadPanel.test.tsx`
(cards newest-first render + expand + reply autofocus; empty-state hint; recolor IPC + refetch;
annotation delete→undo re-saves same payload and restores after invalidate; j/k cycle both
directions; reply persists fresh `<!--timestamp:N-->`; edit keeps id exactly + stamps edited;
comment delete→undo restores original marker string byte-for-byte). Mocked-ipc store simulates
Rust truth so invalidation refetches observe persisted state.
Concurrent siblings during gates: task-30 mid-edit transiently broke `useVoiceComment.ts`
typecheck + `CommentEditorSheet.test.tsx` mic testids — verified unrelated (owned by them),
re-ran after their fix: all green. My blast radius (src/reader/**, Reader.test, App.test)
was green throughout.
Manual gate "two annotations threaded without layout jump on expand/collapse" NOT executed
(headless env, no webview): expansion is cache-driven re-render of one card section (no panel
reflow of siblings — cards keep stable keys/order); needs a `pnpm tauri dev` smoke pass.

