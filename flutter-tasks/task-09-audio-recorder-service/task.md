# Task 09: Audio Recorder Service

Status: DONE
Wave: 2
Depends on: task-01-scaffold-toolchain

## Scope & Owned Files
- `scholiast_flutter/lib/core/audio/audio_recorder_service.dart` (16kHz 16-bit mono recording, amplitude stream, duration timer)
- `scholiast_flutter/lib/core/audio/wav_encoder.dart` (PCM to 16kHz mono WAV header encoder)
- `scholiast_flutter/test/core/audio_recorder_test.dart`

## Acceptance Criteria
- `AudioRecorderService` records 16kHz 16-bit mono audio on Android and Linux.
- Emits real-time amplitude/decibel levels for visual wave animations.
- Converts raw PCM or encodes directly to 16kHz mono WAV for Whisper consumption.
- Unit tests verify WAV header generation and recorder state machine.
- `flutter analyze` reports 0 errors/warnings.
