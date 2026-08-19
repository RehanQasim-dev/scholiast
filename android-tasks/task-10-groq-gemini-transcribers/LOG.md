# 10-groq-gemini-transcribers — Agent log

Log entries appended while working on this task (see README.md, "Agent logging protocol").

## [2026-08-19 21:23] resume-session (orchestrator-directed RESUME)
- **What I learned:** Prior sessions produced nothing (empty log). Task 09's recorder is 16 kHz mono
  PCM-16 floats; `WavWriter` (pure JVM, in `ui.voice`) encodes FloatArray → WAV for Groq/Gemini.
  Catalog has OkHttp 4.12.0 + kotlinx-serialization-json 1.9.0 + okhttp-mockwebserver 4.12.0
  (testImplementation) — no new deps needed. No prefs/SpeechSettings exist yet (Task 19 not built).
  Existing client style: `TranscriptClient` — OkHttp, blocking `execute()` under `withContext(IO)`,
  typed sealed results, MockWebServer tests in `src/test`.
- **Decisions made:** Followed the orchestrator's RESUME layout: files live in
  `domain/transcribe/` (Transcriber.kt, GroqTranscriber.kt, GeminiTranscriber.kt, ApiKeyProvider.kt,
  TranscriberTest.kt) instead of task.md's `domain/voice/` + pipeline/sheet list. The voice-edit
  pipeline (`domain/edit/VoiceEditPipeline.kt`) and sheet (`ui/voice/VoiceEditSheet.kt`) are deferred
  to a follow-up session — this session delivers the transcriber layer + tests per the RESUME. The
  Gemini edit flow is supported via an extra `transcribeWithPrompt` method (prompt not in the base
  interface per RESUME signature). `SpeechSettings` (keys/prompts/modelIds/language) is defined here
  as the injected interface Task 19 implements; `ApiKeyProvider.apiKey(Service)` is defined for
  Task 16's Keystore impl. Model id defaults pinned to plan §5.11: `whisper-large-v3-turbo`,
  `gemini-3.6-flash`.
- **Open questions:** None blocking. Note for Task 19: implement `SpeechSettings : ApiKeyProvider`
  with the six members here; note for integration: wire `TranscriberRegistry.forAddComment()` into
  the comment editor mic once Task 07/19 land.
- **Progress:** task.md set IN PROGRESS. Wrote the 5 owned files (Transcriber interface + AudioSource
  + TranscriptionResult + registry, Groq REST client, Gemini REST client with inline + Files-API
  long-audio path, ApiKeyProvider/SpeechSettings, MockWebServer tests). Build + unit tests pending.

## [2026-08-19 21:58] completion-session (verification)
- **What I learned:** The full `assembleDevDebug` cannot pass in the shared tree: Task 11's
  `app/build.gradle.kts` adds `externalNativeBuild` + `ndkVersion 28.2.14247001`, but the SDK's NDK
  dir contains only `source.properties` (not installed) → `configureCMakeDebug` fails and `-x`
  exclusions don't prune the per-ABI tasks. Additionally, parallel agents (Tasks 11/07-08) were
  writing broken/incomplete files into the same tree the whole time (a fresh KSP run then crashes
  with a silent `IllegalStateException` on their files, e.g. `FutoTranscriber.kt` importing a
  `domain.voice` package that no longer existed; they re-created files after I moved them aside
  once). My own verification therefore used a temporary build: native block removed from
  `app/build.gradle.kts` + other tasks' files moved to `/tmp/opencode/moved{,2,3}/`.
- **Decisions made:** Followed the sanctioned workaround: byte-identical restore of every touched
  file afterwards, verified by sha256 (`build.gradle.kts` restored to
  `412a3b60…a290a8`). Test-file fixes were mine alone (implementation was correct): Gemini base URL
  had a trailing slash so MockWebServer saw `//v1beta/…` paths; my test consumed the request body
  before the RIFF check; and `contents` is a `JsonArray`, not `JsonObject` (ClassCastException in
  my test's parse helper, fixed via a `parts()` helper). Removed an unused `RecordedRequest` import.
- **Progress:** `./gradlew :app:assembleDevDebug` BUILD SUCCESSFUL (with temp build). Full unit
  suite `:app:testDevDebugUnitTest` passes: **192 tests, 0 failures** across 11 suites, of which
  `TranscriberTest` = 22 tests covering Groq multipart happy path + segment→`WordTimestamp` +
  FloatSamples temp-wav + error mapping (401/429/500/plain-body/connection-refused/not-configured),
  Gemini inline base64 + prompt body, `transcribeWithPrompt` edit flow, Files-API 4-request sequence
  (start/control-PUT/DELETE/generateContent), error mapping, and registry selection. KSP hiccup
  mid-way was stale incremental state + parallel writers; `clean` + moves resolved it.
- **Left for later (per RESUME):** `domain/edit/VoiceEditPipeline.kt` + `ui/voice/VoiceEditSheet.kt`
  (voice-edit state machine + sheet) in a follow-up session; Task 19's real `SpeechSettings`
  (DataStore/Keystore); Task 16's `ApiKeyProvider` Keystore impl. FutoTranscriber.kt (Task 11) was
  restored byte-identical (may still not compile — not mine).

