# Task 30 — Voice comment flow (bubble → transcribe → preview → save)

Status: DONE

## Objective
Speak-a-note end-to-end inside the Reader: mic on the pill opens the compact recording bubble,
stop runs the existing transcriber chain, transcription lands pre-filled in the comment editor
(Quick preview), Save appends to the highlight's `notes[]` with the timestamp format, and
dismissing keeps the draft.

Plan: `../scholiast_web_annot_app_plan.md` §4.5, §5.6, §6.5 (VoiceBubble/toast rows).

## Scope — files you OWN (in `../android/`)
- `ui/reader/VoiceBubble.kt` — ~180×48dp bubble anchored below the pill anchor (clamped to
  viewport), pulsing ring (linear, subtle), elapsed time (tabular figures), tap-to-toggle stop,
  error state with Retry/Discard. Enter: scale+fade from mic point 150ms; exit fade.
- `ui/reader/VoiceNoteController.kt` — orchestrates: reuse `ui/voice/VoiceRecorder` +
  `SpeechDependencies` transcriber chain exactly as the player's flow does (Groq → Gemini-prompt
  → local FUTO; offline dims cloud options). Session draft map `drafts: Map<highlightId, String>`
  lives here. Exposes StateFlow<Phase> (Idle/Recording/Transcribing/DraftReady/Error).
- `ui/reader/ReaderVoiceIntegration.kt` — the wiring layer between ReaderViewModel/Screen events
  and the controller: mic-pressed → start; stopped → transcribe → open CommentEditorSheet
  (existing component) PRE-FILLED; Save → `PageHighlightRepository.upsert` with note
  `"text<!--timestamp:N-->"`; Dismiss → keep draft; reopening a thread restores draft text into
  the editor box. Toast "Note attached" + haptic on save (same frame).
- `ui/reader/ReaderViewModel.kt` — MINIMAL additive edits only: expose the two events
  (`onMicPressed(highlightDraftTarget)`, save/draft hooks) needed by your integration file.
  Do not restructure Task 28's code; mark edits with `// VOICE-WIRE` comments.
- Tests: `VoiceNoteControllerTest` with fake recorder/transcriber — phases transition, draft
  kept on dismiss and restored, save appends correctly-formatted note (timestamp parse check),
  error path surfaces retry without data loss.

## Requirements
- No video-pause semantics here. Cloud-offline → local STT automatically when configured.
- Latency audit: transcription fills the field in the same frame it returns; no spinners except
  the bubble's own recording/transcribing states.
- Editor reuse: hide diagram/image buttons in Reader context (v1 drop list §2).

## Acceptance criteria
- Controller tests pass; manual path documented in LOG.md for Task 32's end-to-end verification.
- Draft survives sheet dismissal within session (test proves restore).

## Agent notes
- Tasks 28/29 land first — read their LOG.md APIs. You may NOT edit SwatchPill/Painter files;
  consume their callbacks.
