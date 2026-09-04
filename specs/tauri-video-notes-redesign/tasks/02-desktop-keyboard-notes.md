# Task 02: Desktop Keyboard-First In-Situ Note Composer & Keybindings [COMPLETED]

## Status: Completed & Verified
- `sc-note-terminal` bottom bar and helper banner removed on desktop.
- In-situ full-width card renders chronologically inside `NotesTab.tsx`.
- Discrete `+` header button added to `PanelTabs.tsx` next to `Notes`.
- Global hotkeys `N`, `S`, `V`, `T`, `Space` registered in `Player.tsx`.
- `Enter` = newline; `Shift+Enter`/`Ctrl+Enter` = save and resume; `Esc` = cancel and resume.
- Dynamic Save button: inline on line 1 for short drafts, shifts below text on multi-line.
- Vitest unit tests pass in `NotesTab.test.tsx`.
Replace the legacy bottom social-media chat bar on desktop with an extension-parity in-situ full-width note card, global hotkeys (`N`, `S`, `V`, `Space`, `Enter`, `Shift+Enter`, `Esc`), smart playback state memory (`wasPlaying`), and a dynamic save button.

## Owned Files
- `scholiast_tauri/src/components/NotesTab.tsx`
- `scholiast_tauri/src/components/NotesTab.test.tsx`
- `scholiast_tauri/src/routes/Player.tsx`

## Steps
1. Remove `sc-note-terminal` bottom bar and helper status strips when on desktop (`!isNarrow`).
2. Add discrete `+` button in the notes panel header next to `Notes (N)`.
3. In `Player.tsx`, register global hotkeys:
   - `N`: Pauses video, captures timestamp and `wasPlaying`, opens active in-situ composer.
   - `Space`: Toggles Play/Pause when no input is focused.
   - `S`: Captures frame snapshot.
   - `V`: Opens Voice note.
   - `T`: Toggles between Notes and Transcript panels.
4. Implement `InSituCard` in `NotesTab.tsx`:
   - Header: Timestamp chip + Discard `✕`.
   - Body: 100% full-width auto-expanding `textarea` (up to 5 lines).
   - Keybindings: `Enter` = newline; `Shift+Enter` / `Ctrl+Enter` = commit note.
   - Dynamic Save Button: Stays inline for single-line notes; drops below the text on multi-line notes.
   - `Esc`: Discards note and resumes playback if `wasPlaying === true`.
5. Verify with unit tests in `NotesTab.test.tsx`.
