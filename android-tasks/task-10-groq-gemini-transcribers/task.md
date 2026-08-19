# Task 10 — Groq Whisper + Gemini transcribers & voice-edit pipeline

Status: DONE

## Objective
The cloud transcription + AI edit layer: Groq Whisper for add-comment speech, Gemini for the voice-edit flow (audio + prompt → preview → Accept/Discard), plus the Settings plumbing for keys, prompts, and model IDs.

## Scope — files you OWN (in `../android/app/src/main/java/com/scholiast/android/`)
- `domain/voice/Transcriber.kt` — the interface + `GroqTranscriber` + `GeminiTranscriber` + `LocalSTTTranscriber` stub (Task 11 fills it)
- `domain/voice/GroqClient.kt` — OkHttp client for `POST https://api.groq.com/openai/v1/audio/transcriptions` (model default `whisper-large-v3-turbo`)
- `domain/voice/GeminiClient.kt` — OkHttp client for Gemini `generateContent` (model default `gemini-3.6-flash`), audio inline + prompt
- `domain/edit/VoiceEditPipeline.kt` — the voice-edit state machine (record → Gemini → preview → Accept/Discard/Retry), `GeminiNotConfigured` → disabled + toast
- `ui/voice/VoiceEditSheet.kt` — the edit sheet UI (original text, mic, editable prompt, Accept/Discard/Retry)
- `domain/voice/VoiceClientsTest.kt` — MockWebServer tests for both APIs

## References (read first)
- `../scholiast_mobile_app_plan.md`: §2 (add-comment = Groq Whisper → verbatim; Gemini configured → audio+prompt → Gemini; edit = Gemini preview; no-Gemini = disabled+toast), §5.5.2, §5.5.3 (the 6-step edit flow), §5.5.6 (settings panel: keys, prompts, model IDs, speech language — values live in Task 19's prefs, read via an injected `SpeechSettings` interface), §5.5.5 (Transcriber interface)
- FUTO for the local-transcriber stub shape: Task 11's `LocalSTTTranscriber`

## Requirements
- `Transcriber { suspend fun transcribe(audio: AudioSource, language: String?): TranscriptionResult }` — `AudioSource` = `WavFile(file)` (from Task 09's encoder) or `FloatSamples(samples)` (local STT). Result = `Transcription(text, source: Groq|Gemini|Local, error?)`.
- Groq: multipart upload of the WAV (16 kHz mono), `model` from settings, `language` from the speech-language setting; error mapping (401, 429, network).
- Gemini add-comment: audio inline (base64) + the editable add-comment prompt from settings; response text becomes the draft verbatim.
- Voice-edit: audio + edit prompt → Gemini → preview shown under the original; **Accept** replaces the comment text and stamps `<!--edited:N-->` (Task 02 helper); **Discard** keeps original; **Retry** re-records; **no Gemini key → the edit action is disabled with a toast** "Set up Gemini in Settings".
- Settings access: define `SpeechSettings` interface (apiKeys, prompts, modelIds, speechLanguage) with a default in-memory impl; Task 19 provides the real DataStore/Keystore one — code against the interface.
- All clients suspend, cancellation-aware (`withContext(NonCancellable)` not required; propagate cancellation).

## Acceptance criteria
- MockWebServer tests: Groq happy path (WAV upload → text), Gemini inline-audio request shape, error mapping.
- Voice-edit pipeline state machine tests: accept stamps edited marker, discard keeps original, retry re-runs.
- No-Gemini path returns a typed result the UI renders as disabled+toast.

## Agent notes
- Do not hardcode keys — always via `SpeechSettings`.
- The Gemini request shape: `{ contents:[{ parts:[ {inlineData:{mimeType, data}}, {text: prompt} ] }] }` — verify against current Gemini REST docs if possible.
- Write your log to `LOG.md` as you work.