# Task 30: Reader Voice Comments

Status: DONE
Wave: 9
Depends on: task-28, task-29

## Scope & Owned Files
- Wire the full voice chain into reader thread inputs (task-31 panel + any inline reply boxes):
  - MicButton → `useVoiceRecorder` (task-09) → Groq verbatim / Gemini prompted draft insert (task-10) with player-pause hook disabled (no video context)
  - Offline dimming per plan §6.11 (local STT path active when configured)
- Voice-edit flow on existing reader comments (VoiceEditSheet reuse) — Gemini-only gating identical to video side
- Recording state must not scroll the panel; elapsed indicator anchored to the input row

## Acceptance Criteria
- Component tests: record→draft insertion in thread box; cancel restores prior text
- Manual gate logged: speak a comment offline via local model end-to-end

## Notes
Pure composition task — fix integration seams here rather than editing task-09/10 internals.
