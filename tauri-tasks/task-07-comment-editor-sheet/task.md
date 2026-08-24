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
