# Task 04: Home Screen

Status: DONE
Wave: 2
Depends on: task-02

## Scope & Owned Files
- `scholiast_tauri/src/routes/Home.tsx`
- `src/components/OpenLinkField.tsx` — large input + paste button; Enter opens `/player?url=…` after client-side `extractVideoId` validation (invalid → toast)
- `src/components/RecentGrid.tsx` — 2-col grid cards: thumbnail (fetched via `https://i.ytimg.com/vi/<id>/mqdefault.jpg`), title, note count, last-opened; click → player route (resume handled by player task reading `resume_at`)
- Sync status chip in header (reads `sync://progress` listener state; stub-safe pre-task-18)
- Deep-link entry: handle `scholiast://open?url=` → navigate to player (plugin already registered by task-01)

## Behavior details
Plan §6.1/§7.4. Empty state copy: "Paste a YouTube link to start taking notes." Dark tokens only; tabular figures for counts.

## Acceptance Criteria
- Component tests: render grid from mocked query, open-link validation (valid/invalid URL), navigation on card click.
- Query keys per plan §3.4 (`['videos','recent']`); invalidation on `db://changed:videos`.
