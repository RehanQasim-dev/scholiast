# 01: Comment Editor Sheet & Autocomplete

**What to build:** Comment Editor Sheet & Autocomplete

**Blocked by:** None

**Status:** completed

- [x] Floating composer sheet with markdown formatting and tag autocomplete (Invariants 1, 2, 3)

## Scope & Implementation Notes
# Task 07: Comment Editor Sheet

Status: DONE
Wave: 2
Depends on: task-02

## Scope & Owned Files
- `scholiast_tauri/src/components/CommentEditorSheet.tsx` — bottom sheet (desktop: centered modal ≥560px)
- Light-markdown editing surface: bold / italic / link / bullet buttons operating on the textarea with native undo semantics; `#tag` autocomplete dropdown fed by command `list_tags` (task-02 store) filtered by prefix; arrows navigate, Enter/Tab/click insert, Esc closes without killing draft
- Footer: **MicButton** (slot — wired by task-09/10) + **KeyboardButton** side-by-side; timestamp chip (tap→seek); Save / Cancel (Save = primary purple); `Ctrl+Enter` saves
- Draft lifecycle: cancel/Esc keeps draft once for confirm-discard toast; empty drafts discarded silently
- On save: creates `note` item at captured `currentTime` (or attaches to provided frame/transcript item) via task-02 commands; stamps `<!--timestamp:N-->`

## Acceptance Criteria
- Component tests: save flow writes item + invalidates queries; tag insert; Ctrl+Enter; discard-confirm path

## Notes
Formatting bar mirrors the extension's comment editor semantics but textarea-level (no contenteditable in v1).


## Execution History & Log
# Task 07 — Comment Editor Sheet

## [2026-08-23 22:51] task-07 agent
- **What I learned:**
  - `list_tags()` and `save_video_item({urlHash, item})` confirmed in `src-tauri/src/commands/videos.rs`; Tauri maps JS camelCase args → Rust snake_case params (`urlHash` → `url_hash`), matching the `Home.test.tsx` convention.
  - `VideoItem` serde shape over IPC (crates/core models.rs): camelCase renames for `videoTime`/`updatedAt`/`timeEnd`, `kind` serialized lowercase (`"note"`), notes are `"text<!--timestamp:N-->"` strings with **digits-only** N (`noteMarkdown.ts` ID_RE enforces `\d+`).
  - `gen_video_id` is a pure Rust fn in `normalize.rs`, **not a Tauri command** — no IPC path exists. Format = lowercase-base36 unix-millis + 5 random base36 chars.
  - Query keys in use: `["videos","recent"]` (Home.tsx), `["videoItems", urlHash]` (task-06 spec); task-06's NotesTab landed mid-task and its transient typecheck breakage resolved itself before my final gate run.
- **Decisions made:**
  - ID generation is client-side, mirroring `gen_video_id` exactly: `${Date.now().toString(36)}${5 crypto-random base36 chars}` (with Math.random fallback). Divergence logged per instructions; if a `gen_video_id` command lands later, swap the call site in `CommentEditorSheet.genVideoItemId`.
  - Confirm-discard implemented as keep-once semantics (extension §3.2 spirit): first cancel/Esc with text keeps the draft + toast "Draft kept. Cancel again to discard it."; reopening prefills from the kept draft; the second cancel discards silently. Empty drafts always close silently, nothing kept. Kept draft lives in a ref so the parent may unmount/remount freely.
  - Formatting bar is manual markdown insertion around the textarea selection with caret restore via `setSelectionRange` after commit — no `document.execCommand`. Tradeoff: controlled re-render resets the native undo stack, so Ctrl+Z after a formatting click won't revert just the insertion (accepted per task brief).
  - Timestamp chip rendered inline in the sheet footer (task-06 owns `TimestampChip.tsx`) — M:SS via a local `formatVideoTime`; tap seeks through `playerBridge.commands.seekTo`. Dedupe into task-06's shared helper when both land together.
  - MicButton slot renders only when `onVoiceDraft?` is provided (real voice chain = task-10); KeyboardButton refocuses the textarea.
  - API kept prop-driven: `<CommentEditorSheet open target={{urlHash,currentTime}} onClose onSave?(target, meta) attachTo? onVoiceDraft? />`; no hook exported (YAGNI). `attachTo` appends the note to an existing frame/transcript item instead of creating one.
  - Save stamps `<!--timestamp:${Date.now()}-->`, invalidates `["videoItems", urlHash]` + `["videos","recent"]`, then fires `onSave(target, {id,text,videoTime,attachedTo?})`. Save failure toasts and keeps the sheet open with the draft intact.
  - Tag autocomplete: `list_tags` cached via TanStack Query (`staleTime: Infinity`), case-insensitive prefix match, max 6 suggestions; ArrowUp/Down cycle, Enter/Tab/click insert `#tag `, Esc closes only the dropdown (stopPropagation) so the sheet stays open.
- **Open questions:** none blocking. (Integration note: when task-06's `TimestampChip`/`formatVideoTime` port exists, replace the local copies here.)
- **Progress:** All deliverables done. Files created: `src/components/CommentEditorSheet.tsx`, `src/components/TagAutocomplete.tsx`, `src/components/KeyboardButton.tsx`, `src/components/CommentEditorSheet.test.tsx`. Tests cover tag insert, Ctrl+Enter payload + query invalidation, discard-confirm-once lifecycle, keyboard-button focus. Gates: `pnpm lint` clean · `pnpm typecheck` clean · `pnpm vitest run` 8 files / 70 tests all passing. One bug caught by tests during development (tag insert anchored after the `#`, producing `##tag`) — fixed and covered. Status set to DONE.

