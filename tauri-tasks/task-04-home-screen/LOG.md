# LOG — Task 04: Home Screen

## [2026-08-23 ~22:55] task-04

### Learned
- `VideoSummary` (src-tauri/src/store/videos.rs) serializes camelCase: `{ urlHash, url,
  videoId?, title?, resumeAt: f64, updatedAt: i64 }`. **No note-count field exists**, so the
  task.md "note count" badge is omitted gracefully per orchestrator instruction.
- `Reply<T>` = `{ ok: true, data }` (crates/core/src/error.rs); errors serialize as
  `{ ok:false, error:{kind,message} }` — verified before writing the unwrap helper.
- `extractVideoId` already lives in `src/routes/Player.tsx:17` (handles watch/youtu.be/
  shorts/live/embed + bare 11-char ids). Imported rather than duplicated; a later integration
  wave may want to move it to `src/lib/`.
- jsdom does **not** auto-fire `error` on unloadable `<img src>`; and `alt=""` images get ARIA
  role `presentation`, so they are invisible to `*ByRole("img")` queries. Tests query by
  attribute and fire `error` manually.

### Decisions
- Created unowned `src/lib/ipc.ts`: generic `invokeCommand<T>` that unwraps the envelope only
  when the payload looks like `{ ok: boolean }` (raw payloads pass through), plus typed
  wrappers `listRecentVideos()` / `upsertVideo()` and the shared `VideoSummary` type.
- Home's OpenLinkField fires `upsert_video({url, videoId})` fire-and-forget on valid submit
  (plan §6.2: open → upsert row). Without it the recents grid never gains rows from Home
  actions. Failure is silent; Rust emits `db://changed:videos`, which invalidates
  `['videos','recent']`.
- URL normalization client-side = canonical watch url (`canonicalWatchUrl`); Rust re-normalizes
  for hashing, so no drift.
- Card click navigates to `/player?url=…&resume=<floor(resumeAt)>` only when `resumeAt > 0`;
  Player route reads both params as-is (verified Player.tsx).
- Resume chip shows "Resume at M:SS"; timestamps use `tabular-nums`; relative time formatter is
  inline in RecentGrid (just now/Xm/Xh/Xd, then short date).
- Empty state copy exactly per task.md; loading renders two pulse skeletons; error renders a
  quiet retry-free notice.
- **Skipped (orchestrator override):** sync status chip (`sync://progress`) and deep-link entry
  (`scholiast://open?url=`) were in task.md scope but explicitly excluded by the orchestrator
  brief ("Deep-link: skip", chip stub-safe pre-task-18).

### Cross-file touch (integration note)
- `src/App.test.tsx` had to be wrapped in `QueryClientProvider`: Home now mounts a TanStack
  query, so rendering `<App/>` without the provider threw. Minimal edit (import + wrapper);
  everything else untouched. Flagging here since App.test.tsx is not an owned file.

### Open questions
- Should note-count badges appear once a `noteCount` field lands on `VideoSummary`? The card
  layout has room next to the relative time; trivial follow-up.
- Sync chip placement/design deferred to task-18 integration.

### Progress
- Gates green: `pnpm lint` ✓ · `pnpm typecheck` ✓ · `pnpm vitest run` 56/56 across 6 files.
- Files created: `src/lib/ipc.ts`, `src/components/OpenLinkField.tsx`,
  `src/components/RecentGrid.tsx`, `src/routes/Home.test.tsx`.
- Files rewritten: `src/routes/Home.tsx` (hero + grid + `db://changed:videos` invalidation
  listener with test-env guard + ToastHost mount). Kept `<h1>Home</h1>` required by
  App.test.tsx.
