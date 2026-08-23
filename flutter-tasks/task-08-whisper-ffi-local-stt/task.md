# Task 08: Whisper FFI Local STT & Cloud AI Transcribers

Status: DONE
Wave: 2
Depends on: task-02-core-domain-models

## Scope & Owned Files
- `scholiast_flutter/lib/core/stt/whisper_bindings.dart` (Dart FFI bindings for `libwhisper.so`)
- `scholiast_flutter/lib/core/stt/whisper_isolate_worker.dart` (Off-main-thread audio inference isolate)
- `scholiast_flutter/lib/core/stt/whisper_model_manager.dart` (Download & manage GGML Whisper model files)
- `scholiast_flutter/lib/core/stt/cloud_stt_service.dart` (Groq, OpenAI, Gemini Speech-to-Text clients via Dio)
- `scholiast_flutter/lib/core/stt/stt_service.dart` (Unified speech-to-text coordinator)
- `scholiast_flutter/test/core/stt_service_test.dart`

## Acceptance Criteria
- FFI bindings load `libwhisper.so` dynamically across Android and Linux with graceful fallback when unbuilt.
- Model manager handles progress tracking and local cache in application support directory.
- Cloud STT provides fallbacks for Groq Whisper (`whisper-large-v3`), OpenAI Whisper (`whisper-1`), and Gemini audio.
- Unit tests pass with mocked FFI and HTTP responses.
- `flutter analyze` reports 0 errors/warnings.
