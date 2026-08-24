# Task 11: Local STT (whisper-rs)

Status: DONE
Wave: 1
Depends on: task-01

## Scope & Owned Files
- `src-tauri/src/stt/local.rs` — `whisper-rs` integration behind cargo feature `local-stt`:
  - dedicated worker thread owning one inference context (queue of jobs)
  - cooperative cancel flag (mirrors FUTO `WhisperGGML` semantics); partial-segment callback → emit `stt://partial {sessionId,text}`; final → `stt://final`
  - language param; no_timestamps for <25 s clips; thread count clamp 2..16
- `src-tauri/src/stt/models.rs` — model manager: catalog (tiny_en default; base_en/small_en) from keyboard.futo.tech endpoints + SHA-256 pins copied from FUTO `Models.kt`; download to app-data `models/`, verify checksum, set active pref
- Commands: `stt_local_transcribe(wavPath,{language}) -> finalText`, `stt_local_cancel(sessionId)`, `list_models()/download_model(id)/set_active_model(id)`
- Implements the same `Transcriber` trait as task-10 (VERBATIM cap)

## Acceptance Criteria
- Unit test: WAV→PCM feed → deterministic tiny-model output on a bundled 2 s sample (feature-gated CI skip if model absent)
- Cancel path returns promptly mid-inference

## Notes
FUTO Source First License 1.1 — personal use only; engine swap (sherpa-onnx) documented as pre-distribution TODO in LOG.md.
