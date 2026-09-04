# 06: Reader Shell & Sidebar Rail

**What to build:** Reader Shell & Sidebar Rail

**Blocked by:** 03, 04

**Status:** completed

- [x] Navigation routes, sidebar library rail, and responsive top bar (Invariants 1, 2)

## Scope & Implementation Notes
# Task 28: Reader Shell UI

Status: DONE
Wave: 8
Depends on: task-25, task-26

## Scope & Owned Files
- Extend `/reader` route into full shell:
  - sidebar library rail (from task-01 shell): saved articles list (title, domain, date, unread dot), search filter, add-article input; Ctrl+click opens source URL externally
  - top bar inside reader: breadcrumb (library / article title), font-step +/- and serif toggle, delete article (typed confirm), sync chip
- Empty states: no articles yet (copy + Add CTA), extraction-failed variant from task-25 errors
- Deep link `scholiast://open?url=` routes articles to reader when host is non-video
- Keyboard: `j/k` next/prev annotation placeholder (wired to task-31 later), `f` focus mode (hide rail)

## Acceptance Criteria
- Component tests: library list interactions, routing decisions video-vs-article URL
- Manual gate: add real article → read → adjust typography persists

## Notes
Keep ArticleView (task-26) untouched — compose around it.


## Execution History & Log
# Task 28 — Reader Shell UI — LOG

## 2026-08-24 — Implementation complete (Status: DONE)

### What shipped
- **`src/routes/Reader.tsx`** — full rebuild around `ArticleView` (untouched):
  left rail + top bar + scrollable article column + zero-width thread-panel
  slot (`data-testid="thread-panel-slot"`, reserved for task-31).
- **`src/components/reader/LibraryRail.tsx`** (+ `.test.tsx`) — 240px sub-rail:
  add-article input at top (typed error copy inline, `role="alert"`), search
  filter (client-side title/domain), saved list from query `["articles"]`
  (title → domain → relative date), active item gets accent ring +
  `aria-current`, Ctrl/Cmd+click opens the source via `plugin-opener`.
- **`src/components/reader/ReaderTopBar.tsx`** (+ `.test.tsx`) — breadcrumb
  (Library link clears selection / title), font-step −/+ clamped −2..+4
  (`reader.font_step`), serif toggle (`reader.serif`), column-width cycle
  680→736→820 (`reader.column_width`), typed-confirm delete dialog
  (`DELETE`, case-insensitive trim like DataSection) → `delete_article` →
  navigate to first remaining or the no-selection state, sync chip
  placeholder (`data-testid="sync-chip"`, inert until sync tasks land here).
- **`src/lib/useReaderKeyboard.ts`** (+ test) — see contract below.

### Rail design decision (documented per orchestrator instruction)
The LibraryRail renders **inside the Reader route** as a left sub-rail;
`src/components/Sidebar.tsx` is **not modified at all** (preferred option).
The route owns collapse behavior: focus mode wraps the rail and top bar in
width/height-transitioned containers (`w-0` / `h-0` + opacity), so the shell
collapses purely with CSS while both stay mounted (input state preserved).

### Keyboard contract for task-29 / task-31
`useReaderKeyboard` dispatches on `window`:

```
CustomEvent("reader:next-annotation", { detail: { direction: 1 | -1 } })
```

`1` = next annotation, `-1` = previous. Constant exported as
`READER_NEXT_ANNOTATION_EVENT` from `src/lib/useReaderKeyboard.ts`.
Consumers should `addEventListener` on `window` and own all
scroll/focus of annotation placeholders; the hook only emits. `f` toggles
focus mode (callback into Reader state), `g g` scrolls the article column to
top. All keys ignored in editable targets and under ctrl/meta/alt.

### Behavior notes
- Deep link `/reader?url=X&h=Y` selects the article, rings it in the rail,
  and scrolls the column to top on every `h` change.
- Article switching uses `setSearchParams({url, h})` — same param shape
  task-23 navigation produces.
- Empty states: empty library (CTA focuses the rail input,
  `ADD_ARTICLE_INPUT_ID`), extraction-failed variant fed by mapped
  `add_article` failure kinds (`fetchBlocked`→"Site blocked extraction",
  `notReadable`→"Not an article", `network`→"Offline?", `invalidInput`→URL
  hint; mapping exported as `describeAddError`), capture-pending passes
  through to `ArticleView` body-empty rendering (`notReadable={false}`).
- Library list listens for `db://changed:pages` (Rust emits it on
  add/delete/recapture) and invalidates `["articles"]`; delete also enqueues
  sync tombstones Rust-side (task-27 spine) — nothing extra needed here.

### Deviations from task.md wording
1. task.md mentions an "unread dot" in the library list; the orchestrator's
   spec supersedes with "active highlight ring" — ring implemented, no dot
   (no unread tracking exists in the schema).
2. task.md acceptance criterion "routing decisions video-vs-article URL" is
   satisfied by task-23 Home routing (YouTube links never reach /reader);
   covered by Home tests, not duplicated here.
3. No shared ConfirmDialog existed; built a minimal typed-confirm dialog
   inside `ReaderTopBar.tsx` following the DataSection pattern
   (type-the-word, case-insensitive trim). If a shared ConfirmDialog lands
   later, this one can be swapped.
4. Sync chip is a visual placeholder only (no sync-status event consumer for
   reader yet); wired for real once reader sync status events exist.

### Gates
- `pnpm lint` — clean (0 errors, 0 warnings)
- `pnpm typecheck` — clean
- `pnpm vitest run` — 25 files / 165 tests passing (includes sibling's
  ArticleView tests; mid-wave typecheck errors in their file were transient
  and cleared before final gate run)

