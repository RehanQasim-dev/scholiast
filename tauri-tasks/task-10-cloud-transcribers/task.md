# Task 10: Cloud Transcribers (Groq + Gemini)

Status: DONE
Wave: 2
Depends on: task-09

## Scope & Owned Files
- `crates/core/src/stt.rs`? No — service layer lives in `src-tauri/src/stt/`:
  - `mod.rs` — `Transcriber` trait per plan §6.5.5 (+`Caps{VERBATIM|PROMPTED}`), provider registry chosen by configured keys (keyring reads)
  - `groq.rs` — `POST https://api.groq.com/openai/v1/audio/transcriptions`, multipart file upload, `model=whisper-large-v3-turbo` default (overridable pref), `language`
  - `gemini.rs` — audio inline + system-instruction prompt → `generateContent` (model id pref `gemini-flash-latest`)
  - `models.rs` — download/verify GGML models list is task-11's; here only shared HTTP error taxonomy + Test-connection pings
- Commands: `stt_transcribe(path, {language}) -> text`, `stt_edit_text(path, prompt, original) -> text`
- Prompts read from prefs store: `prompt.add_comment`, `prompt.edit_comment` with plan §6.5.6 defaults seeded on first run
- Frontend: `src/voice/VoiceEditSheet.tsx` — original text, big mic, editable prompt, preview pane, **Accept/Discard/Retry**; Accept replaces body + stamps `<!--edited:N-->`. Mic disabled + "Set up speech in Settings" when no provider configured; Gemini-missing → edit-by-voice disabled toast
- Wire MicButton in CommentEditorSheet (task-07 slot): record → transcribe → verbatim/prompted draft insert

## Acceptance Criteria
- wiremock integration tests for both clients (success, 401, 429 paths)
- Sheet component tests: accept/discard/retry state machine

## Notes
Keys NEVER logged; errors surface provider-agnostically ("Speech failed: <status>").
