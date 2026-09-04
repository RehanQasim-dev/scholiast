# Task 01 — Reader-mode margin column (batch 1)

Tracer bullet: collapsed margin cards beside source lines in extracted Reader
mode. No Rust changes. No web-mode changes. No narrow-screen changes.

## Owned files
- `scholiast_tauri/src/reader/marginLayout.ts` (new) + `marginLayout.test.ts`
- `scholiast_tauri/src/reader/useThreadModel.ts` (new)
- `scholiast_tauri/src/reader/ReplyComposer.tsx` (new)
- `scholiast_tauri/src/reader/useMarginAnchors.ts` (new)
- `scholiast_tauri/src/reader/MarginColumn.tsx` (new)
- `scholiast_tauri/src/reader/ThreadPanel.tsx` (hook adoption, same output)
- `scholiast_tauri/src/routes/Reader.tsx` (margin-stack wiring)
- `scholiast_tauri/src/lib/store.ts` (`reader.margin_width` pref)

## Steps
1. `marginLayout.ts`: pure stacker (doc §seams). Test overlap, gap, order,
   unplaced-last, empty.
2. `useThreadModel(urlHash)`: move entries/active/reply/mutation/undo/j-k/
   selectRequest logic out of `ThreadPanel` verbatim; return `{ entries,
   activeKey, activeEntry, activate, replyRef, replyDraft, sending, tag…,
   matches, undoState, handlers… }`. `ThreadPanel` renders identical JSX from
   it (`ThreadPanel.test.tsx` must stay green).
3. `ReplyComposer`: presentational extraction (draft/sending/matches/format
   actions/send/context slot). `ThreadPanel` bottom bar uses it unchanged.
4. `useMarginAnchors(stackRef, anchorIds, layoutKey)`: content-coords tops via
   `findHighlightRange`, re-run triggers per TECH.
5. `MarginColumn`: absolute layer + height measuring + `layoutMarginColumn` +
   `ThreadCard` reuse + inline `ReplyComposer` in the active card + invisible
   full-height splitter bound to `reader.margin_width` (default 340, clamp to
   viewport share 0.45, min 220 — extension constants).
6. `Reader.tsx`: reader-mode + wide + open → margin stack; floating undo
   toast; everything else untouched.
7. Gates: `pnpm vitest run src/reader/marginLayout.test.ts
   src/reader/ThreadPanel.test.tsx src/reader/ThreadCard*` (only these),
   `pnpm typecheck`. Smoke-boot `pnpm tauri dev` per AGENTS.md integration
   rule before merge (deferred to user session).

## LOG
- Implemented batch 1 (reader-mode margin column). `useThreadModel` extracted
  verbatim from `ThreadPanel`; panel JSX byte-identical, its 8 tests green.
- New stacking test caught `top: Infinity` for unplaced anchors — stacker now
  treats unplaced as "after previous".
- Gates: `tsc --noEmit` clean, eslint clean on touched files,
  `vitest run marginLayout ThreadPanel` 14/14 green.
- Verified surface: reader mode + wide + annotations open. Narrow sheet,
  web-mode panel, selection flows untouched. `tauri dev` smoke left to device
  session.
