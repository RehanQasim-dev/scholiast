# Task 06: Note Timeline

Status: DONE
Wave: 2
Depends on: task-02

## Scope & Owned Files
- `scholiast_tauri/src/components/NotesTab.tsx` — time-ordered item cards (frames, notes, transcript highlights), newest-last; query `['videoItems', urlHash]`
- `src/components/NoteCard.tsx` — kind icon, `M:SS` chip (click → `playerBridge.seekTo`), quote/preview, collapsed thread preview, color rail for transcript highlights
- `src/components/TimestampChip.tsx` — mono/tabular, formats via shared `formatVideoTime` port
- Thread preview consumes task-08 renderer output (stub-safe until it lands)
- Panel tabs shell (`Notes` / `Transcript` disabled-until-captions) mounted in Player route's right panel slot

## Acceptance Criteria
- Component tests: ordering by videoTime then createdAt; chip seek dispatch; empty state copy
- Delete item wired with optimistic removal + undo toast (rollback on timeout)

## Notes
Frame thumbnails render from disk path via asset protocol when task-14 lands — leave a `<FrameThumb>` stub now.
