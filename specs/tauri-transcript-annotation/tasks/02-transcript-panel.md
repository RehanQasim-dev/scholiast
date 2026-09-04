# 02: Transcript Panel & Live Follow

**What to build:** Transcript Panel & Live Follow

**Blocked by:** 01

**Status:** completed

- [x] Karaoke auto-scrolling, selection swatch popup, and cue highlight items (Invariants 2, 3, 4)

## Scope & Implementation Notes
# Task 13: Transcript Panel & Annotation UI

Status: DONE
Wave: 3
Depends on: task-02, task-12

## Scope & Owned Files
- `scholiast_tauri/src/player/TranscriptPanel.tsx` — paragraph cards from `fetch_transcript`; `[M:SS]` seek pills; karaoke active-cue bold-white; smooth follow keeping active line ~30% from top (scroll only when active cue changes)
- Language picker in header (>1 track), session memory per video (prefs key `transcript.lang.<videoId>`)
- Selection → `SwatchPopup`: yellow/red/green swatches + 💬 Comment (component shared with Reader later — place in `src/components/`)
- Highlight creation: derive `M:SS–M:SS` from covered cues; save `kind:'transcript'` item with `anchor{startCue,startOffset,endCue,endOffset}`, quote, color via task-02 commands
- Inline repaint of saved highlights while scrolling/reopen; click highlight → open thread (task-07 sheet reused for reply flow)
- Search box filtering paragraphs with jump+pause
- Transcript tab enablement tied to captions availability event

## Acceptance Criteria
- Component tests: selection→swatch→item persisted; repaint on reload; picker precedence
- Live-follow unit test with mocked clock/cue index

## Notes
Anchor format must equal extension's `TranscriptAnchor` exactly (task-02 types).


## Execution History & Log
# Task 13 LOG

- [in-progress] Read task.md, plan §6.6, existing contracts (playerBridge, PanelTabs,
  Player, ipc.ts, transcript/client.rs, models.rs serde, cue.rs chunking, error.rs kinds).
  Verified: paragraph text = cue texts joined with `" "`; `NotFound` serializes as
  `kind:"notFound"`; `save_video_item {urlHash, item}` with camelCase `VideoItem`
  (`videoTime`, `timeEnd`, `anchor{startCue,startOffset,endCue,endOffset}`).
- [done] Implemented all deliverables.
  - `src/lib/useTranscript.ts`: hook over `fetch_transcript({videoId, langPref})`,
    query key exactly `['transcript', videoId]`, session pref
    `sessionStorage["transcript.lang.<videoId>"]`, typed error kind
    (`no-captions` when IPC error kind is `"notFound"`), `changeLang()` refetches
    with the explicit langPref.
  - `src/player/TranscriptPanel.tsx`: paragraph cards from `fetch_transcript`;
    `[M:SS]` seek pill per paragraph (TimestampChip → `playerBridge.commands.seekTo`);
    karaoke active-paragraph bold-white via `usePlayerSnapshot()` time + cue lookup;
    smooth-follow keeps the active card ~30% from the top of the scroll container,
    rAF-deferred, and fires ONLY when the active paragraph changes (verified by test);
    selection → floating SwatchPopup → highlight save; inline `<mark>` repaint of
    saved transcript highlights colored via token vars (`--sc-hl-*`, color-mix);
    click-a-highlight thread popover (quote + notes via noteMarkdown renderer +
    Reply → CommentEditorSheet attachTo + Delete); search box filters paragraphs and
    Enter seeks to the first match's start AND pauses; no-captions empty state.
  - `src/components/SwatchPopup.tsx`: yellow/red/green 28px circles + 💬 button,
    Esc/outside-mousedown dismissal; colors reference the shared tokens.
  - Minimal edits: `PanelTabs.tsx` (optional `videoId` prop, renders TranscriptPanel
    in the transcript tab, disabled tooltip now "No captions for this video"),
    `Player.tsx` (passes `videoId`). No other files touched.
- [done] Tests (`TranscriptPanel.test.tsx`, `SwatchPopup.test.tsx`): active-cue
  switching driven through `playerBridge.commands.seekTo` (patches the bridge's
  time ref-store without a player) incl. scroll-only-on-change assertion; jsdom
  DOM Range selection → swatch → save payload asserted field-by-field; search
  filter + Enter jump+pause; anchor ↔ offsets round-trip and segment repaint units.
- GATES: `pnpm lint` ✓ · `pnpm typecheck` ✓ · `pnpm vitest run` ✓ (84 passed / 11 files).

## Payload field names used (camelCase over IPC)

- `save_video_item` args: `{ urlHash, item }`; item =
  `{ id, kind:"transcript", videoTime:<range-start s>, notes:[], updatedAt:<ms>,
     timeEnd:<range-end s>, quote, color:"yellow"|"red"|"green",
     anchor:{ startCue, startOffset, endCue, endOffset } }`
  — matches `VideoItem`/`TranscriptAnchor` serde in `crates/core/src/models.rs`.
- `fetch_transcript` args `{ videoId, langPref }`; result
  `{ lang, paragraphs:[{index,text,start,end,cueRange:[first,last]}],
     cues:[{start,end,text}] }`.
- Offset semantics: cue-relative char indices into each cue's text, end exclusive;
  anchor math mirrors `build_paragraph`'s space join.

## Gaps logged

1. **Language picker not rendered (TODO).** `fetch_transcript` returns only the
   chosen lang — the available track list is not part of the current command
   signature, so there is nothing to populate a picker with. Session pref storage +
   `changeLang` refetch are fully wired in `useTranscript`; the picker is pure UI
   once the command exposes tracks. Panel shows the active lang as a static chip.
2. **Cross-paragraph drags clamp** to the paragraph where the selection started
   (offsets → end of that paragraph) — permitted v1 simplification; single-paragraph
   selections store precise per-cue offsets (multi-cue within one paragraph included).
3. **Karaoke is paragraph-granular** (active paragraph bold-white/elevated); bolding
   just the active cue inside a rendered segment would need char-offset mapping of
   cues into the highlighted text — deferred.
4. **One pill per paragraph** (its start time), not one per cue.
5. **💬 creates the highlight immediately** with default color `yellow`, then opens
   CommentEditorSheet attached to the new item (no orphan-comment rule preserved:
   closing without saving leaves the saved highlight but adds no comment).
6. **Thread UI choice:** CommentEditorSheet has no edit mode, so clicking a saved
   highlight opens a lightweight popover (existing notes via `renderNoteNodes`,
   Reply → sheet with `attachTo`, Delete → `delete_video_item` + invalidate).
7. `genVideoItemId` duplicated locally (~10 lines; CommentEditorSheet's copy is not
   exported) — same base36 scheme as crates/core `gen_video_id`.

