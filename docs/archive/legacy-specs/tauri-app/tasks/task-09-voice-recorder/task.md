# Task 09: Voice Recorder Pipeline

Status: DONE
Wave: 1
Depends on: task-01

## Scope & Owned Files
Rust:
- `src-tauri/src/stt/recording.rs` — session management: `voice_begin() -> sessionId`, `voice_append_chunk(sessionId, i16 PCM base64)`, `voice_finish(sessionId) -> wavPath`, `voice_cancel(sessionId)`; WAV writer (16 kHz mono PCM16) streaming to app-data `voice/<session>.wav`
Frontend:
- `src/voice/useVoiceRecorder.ts` — getUserMedia({audio:{channelCount:1}}) → AudioWorklet resampling to 16 kHz Int16 → chunked invokes; tap-to-toggle API `{recording, elapsed, start(), stop()->Promise<path>, cancel()}`
- `src/components/MicButton.tsx` — record states (idle / pulsing red ring + elapsed / processing); hard cap 120 s auto-stop with friendly toast
- Worklet file `src/voice/resample-worklet.js`

## Integration contract
Player auto-pause/resume around recording is wired where used (tasks 10/13/30 call `playerBridge.pause()` on start and resume after save/cancel) — expose an `onStateChange` callback option here.

## Acceptance Criteria
- Rust unit test: chunk assembly produces valid WAV header + payload (parse back)
- Vitest: hook state machine with mocked media devices + IPC (start/stop/cancel/cap)
- Manual smoke logged: recorded file plays, correct sample rate (ffprobe)

## Notes
No VAD (tap-to-toggle). Permissions prompt handling documented for all three engines in LOG.md.
