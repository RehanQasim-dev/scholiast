# Task 19: Settings Screen

Status: DONE
Wave: 4
Depends on: task-10, task-11, task-16, task-02

## Scope & Owned Files
- `scholiast_tauri/src/routes/Settings.tsx` — grouped sections, capped-width column, dark tokens:
  - **Speech**: Groq/Gemini key fields (set-once via keyring commands, show "configured" state + Test buttons), model-id fields, speech-language select (default English), prompt editors (`prompt.add_comment`, `prompt.edit_comment`) with restore-defaults, local-model manager UI (list/download/activate/delete + active badge)
  - **Sync**: connect/disconnect, status card slot (task-18), storage used
  - **Playback**: default speed, seek-step size
  - **Appearance**: density toggle; dark-only note
  - **Data**: Delete local data / Delete Drive data — typed confirmation naming exact counts (commands `wipe_local_data`, `wipe_drive_data` implemented here against store + Drive REST)
  - **About**: version (tauri getVersion), privacy note (what goes to Groq/Gemini/Drive)
- All prefs through the typed store facade (`src/lib/store.ts`); Rust-side writes emit `store://changed`

## Acceptance Criteria
- Component tests: section render, prompt edit persistence, wipe confirm gating
- Manual gate: keys set → Test buttons green; wipes guarded

## Notes
Player screen stays clean — nothing playback-related lives here beyond defaults.
