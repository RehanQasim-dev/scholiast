# Task 09 — Voice recorder (tap-to-toggle)

Status: DONE

## Objective
The mic input layer: tap-to-toggle recording with PCM streaming (FUTO-style), permissions, and the pulsing-ring recorder UI. Produces samples the transcribers (Tasks 10/11) consume.

## Scope — files you OWN (in `../android/app/src/main/java/com/scholiast/android/`)
- `ui/voice/VoiceRecorder.kt` — the recorder: `AudioRecord` 16 kHz mono PCM-16 (`VOICE_RECOGNITION`), float-sample accumulation into a growing buffer (30 s initial, expandable), RMS magnitude updates, max-length guard (2 min)
- `ui/voice/MicButton.kt` — the tap-to-toggle mic UI (idle / recording pulsing red ring + elapsed / processing / error states)
- `ui/voice/VoiceRecorderTest.kt` — unit tests for buffer growth + state machine
- `ui/voice/VoiceRecorder.Interface.md` — the contract used by Tasks 07/10/11 (or document the interface in the file header + LOG.md)

## References (read first)
- `../scholiast_mobile_app_plan.md`: §2 (tap-to-toggle, auto-pause/resume video), §5.5.1 (recorder spec), §6.2 (`MicButton`)
- FUTO source to model: `../android-keyboard/voiceinput-shared/src/main/java/org/futo/voiceinput/shared/AudioRecognizer.kt` — port the recording loop (`recordingJob`: read 1600-sample chunks, accumulate floats, magnitude `1 - 0.1^(24*rms)`, expand buffer +30 s when full), minus VAD/Bluetooth/mic-blocked extras

## Requirements
- Interface: `VoiceRecorder { fun start(scope); fun stop(): FloatArray; fun cancel(); val state: StateFlow<RecorderState> }` — `RecorderState = Idle | Recording(elapsedMs, magnitude) | Processing | Error(msg) | Stopped(samples)`.
- Tap-to-toggle: first tap starts, second tap stops and returns the samples; swipe-down cancels (discards samples).
- Video auto-pause on record start, resume on stop/cancel — via `PlayerBridge` interface (Task 05); if absent, expose `onPauseRequested`/`onResumeRequested` callbacks.
- Permission: request `RECORD_AUDIO` at first use with a rationale; denied → Error state with a settings link.
- Audio focus: request `AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE` on start, abandon on stop (so the lecture keeps playing normally otherwise).
- Max length guard: 2 min → auto-stop with a friendly toast.
- Must survive rotation (ViewModel-hosted scope or `rememberCoroutineScope` in the owning screen; recorder owned by a ViewModel, not the composable).

## Acceptance criteria
- Tap-tap records and returns >0 samples; magnitude updates flow to the UI ring.
- Cancel discards; error states (no permission, mic busy) map to UI.
- Unit tests: state machine transitions, buffer growth past 30 s, stop-returns-samples.
- Integration-ready contract documented for Task 10 (Groq consumes `FloatArray`? — decide: Task 10's Groq API needs a WAV/MP3 file. Provide `encodeWav(samples): File` helper in this task so Groq can upload; local STT consumes the FloatArray directly).

## Agent notes
- Port the FUTO recording loop faithfully (it's battle-tested); you may skip the VAD auto-stop entirely — tap-to-toggle means explicit stop.
- The wav encoder: 16 kHz mono 16-bit PCM WAV written to `cacheDir/voice/<ts>.wav`.
- Write your log to `LOG.md` as you work.