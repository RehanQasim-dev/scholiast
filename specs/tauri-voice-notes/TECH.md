# Technical Spec: Tauri Voice Notes Architecture

## Context
Captures audio on mobile and desktop devices with zero latency. Provides local off-grid transcription via whisper.cpp bindings.

Key files:
- `scholiast_tauri/src-tauri/src/commands/stt.rs` @ fed294b
- `scholiast_tauri/src/voice/` @ fed294b

## Proposed Changes & Module Seams
- **Web Audio Pipeline**: AudioWorklet capturing 16kHz mono PCM and streaming chunks over Tauri IPC.
- **Local Whisper Worker**: Dedicated background thread managing GGML models and streaming partial hypotheses.
- **Cloud Transcribers**: Reqwest HTTP client interfacing with Groq and Gemini APIs.

## Testing and Validation
- **Test 1 (AudioWorklet 16kHz PCM streaming)**: Validates Behavior Invariant 1.
- **Test 2 (VAD silence detection)**: Validates Behavior Invariant 2.
- **Test 3 (Whisper worker model verification)**: Validates Behavior Invariant 3.

## Execution Slicing (Batches)
- Batch 1: Task 01 (Recorder), Task 02 (Cloud STT), Task 03 (Local Whisper STT).
