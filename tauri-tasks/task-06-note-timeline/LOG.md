# Task 06 — Note Timeline

## [2026-08-23T00:00Z] task-06-note-timeline
**status:** IN PROGRESS

### learned
- IPC contract (verified in `src-tauri/src/commands/videos.rs` + `store/videos.rs`):
  - `upsert_video({ url })` → `VideoSummary`, field is **`urlHash`** (camelCase over IPC).
  - `get_video_items({ urlHash })` → `VideoItem[]`.
  - `delete_video_item({ urlHash, itemId })` → `bool`.
- `VideoItem` over IPC (`crates/core/src/models.rs`): `{ id, kind:'frame'|'note'|'transcript', videoTime:number, frame?:{dataUrl?,driveId?,w,h}, markup?, notes:string[], updatedAt?:number, timeEnd?, quote?, color? }`. **No `createdAt` over IPC** — `video_items.rs` binds created_at = updated_at on insert, so `updatedAt` asc is the creation-order tiebreak after `videoTime` asc.
- **No `ocrText` over IPC**: `row_to_item` never reads the `ocr_text` column. Typed the card against `TimelineItem = VideoItem & { ocrText?: string }` so preview priority is `ocrText → quote → first comment`; today only the latter two can fire.
- `playerBridge.commands.seekTo(seconds)` is the seek API; `usePlayerEvent("onCaptionsAvailable")` gates the Transcript tab.
- `noteMarkdown.ts`: `parseNoteMarkdown(body)` → nodes, `renderNoteNodes(nodes)` → React; `<!--timestamp:N-->` renders invisibly.
- Tokens `--sc-hl-yellow/red/green` exist in tokens.css (also exposed as Tailwind `hl-*` colors).

### decisions
- `formatVideoTime` implemented in owned `TimestampChip.tsx` (M:SS, minutes unbounded) rather than importing private-ish `formatMss` from player `Chrome.tsx` — Chrome.tsx is forbidden to edit, so convergence of the two is left to an integration task (logged as open question).
- Undo affordance built **inside NotesTab** (owned) as its own bar with Undo button + 5 s window instead of extending `components/Toast.tsx` (not owned; its API is message-only, no actions).
- PanelTabs owns captions availability via `usePlayerEvent("onCaptionsAvailable", …)` so the Player.tsx diff stays a pure mount swap. Initial emission can be missed if tabs mount after session start; later refresh ticks (1 s/3 s/6 s after ready) re-emit, acceptable until task-13.
- NotesTab derives `urlHash` itself: `upsert_video({url})` first (idempotent), then `get_video_items({urlHash})`.

### open questions
- Should `row_to_item` surface `ocr_text` over IPC (task owner: store/Rust)? Card is ready for it.
- Converge `Chrome.formatMss` / `TimestampChip.formatVideoTime` into one shared module?
- Empty-state copy was not specified in task.md; wrote "No notes yet." + hint referencing capture/note flows.

### progress
- Read task.md, plan §6.4, ipc/playerBridge/noteMarkdown/Player/models/commands+store sources.
- Implemented TimestampChip (formatVideoTime M:SS + range variant, seek dispatch), NoteCard (kind icons, chips, FrameThumb stub w×h, color rail mapping, thread preview via renderNoteNodes(parseNoteMarkdown), line-clamp-2), NotesTab (['video',url] upsert → ['videoItems',urlHash] query, orderItems export, optimistic delete + sticky Undo bar 5 s window + finalize-on-unmount, db://changed:video_items invalidation), PanelTabs (Notes | Transcript, transcript disabled-until-captions via usePlayerEvent), Player.tsx minimal mount swap.
- Added `VideoItem` type + `getVideoItems`/`deleteVideoItem` wrappers to `src/lib/ipc.ts` (shared infra file; additive, follows existing wrapper pattern — flagged here per ownership rules since ipc.ts wasn't in the owned list).
- Tests (`src/components/NotesTab.test.tsx`): orderItems asc/tiebreak/no-mutate; chip seek dispatch + M:SS & range formats; color-rail token mapping + frame stub size; timestamp-id hidden in preview; NotesTab ordering; empty-state copy; delete→undo restore with zero backend calls; delete commit after grace with exact args. 8 tests.

## [2026-08-23T01:05Z] task-06-note-timeline — DONE

### gates
- `pnpm lint` ✅ · `pnpm typecheck` ✅ · `pnpm vitest run` ✅ 70/70 (stable across 3 consecutive runs).

### exact command arg names used (verified against src-tauri/src/commands/videos.rs)
- `upsert_video({ url })` → `VideoSummary.urlHash`
- `get_video_items({ urlHash })` → `VideoItem[]`
- `delete_video_item({ urlHash, itemId })` → `boolean`

### files touched
- `scholiast_tauri/src/components/TimestampChip.tsx` (new)
- `scholiast_tauri/src/components/NoteCard.tsx` (new)
- `scholiast_tauri/src/components/NotesTab.tsx` (new)
- `scholiast_tauri/src/components/PanelTabs.tsx` (new)
- `scholiast_tauri/src/components/NotesTab.test.tsx` (new, the one test file)
- `scholiast_tauri/src/routes/Player.tsx` (minimal: +1 import, aside placeholder → `<PanelTabs url={url} />`)
- `scholiast_tauri/src/lib/ipc.ts` (additive: VideoItem type + 2 wrappers — see note above)
- `tauri-tasks/task-06-note-timeline/task.md` (status)

### notes for integration
- Ordering tiebreak uses `updatedAt ?? 0` asc (no createdAt over IPC).
- Preview priority `ocrText → quote → first comment`; ocrText currently never arrives (store doesn't read the column) but the card accepts it.
- Transcript tab enables on any `onCaptionsAvailable(true)` emission; if tabs mount after session start it waits for a later tick — task-13 may want a bridge getter.
