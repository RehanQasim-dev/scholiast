# VoiceRecorder — interface contract (Task 09)

Consumers: **Task 07** (comment editor sheet / MicButton host), **Task 10** (Groq/Gemini
transcribers), **Task 11** (local STT). This is the full contract; the code is the source of truth.

## 1. The recorder

```kotlin
interface VoiceRecorder {
    val state: StateFlow<RecorderState>          // collect to drive the mic UI
    fun start(scope: CoroutineScope)             // Idle/Stopped/Error → Recording
    fun stop(): FloatArray                       // Recording → Stopped(samples); returns samples
    fun cancel()                                 // any state → Idle (discards samples)
}
```

Production impl: `AndroidVoiceRecorder` (in `VoiceRecorder.kt`). Own it via
`VoiceRecorderViewModel` so recording survives rotation.

## 2. RecorderState

```kotlin
sealed interface RecorderState {
    data object Idle : RecorderState
    data class Recording(val elapsedMs: Long, val magnitude: Float) : RecorderState
    data object Processing : RecorderState
    data class Stopped(val samples: FloatArray) : RecorderState
    data class Error(val message: String) : RecorderState
}
```

Transitions:

```
Idle ──start──▶ Recording ──stop──▶ Stopped(samples) ──markProcessing()──▶ Processing ──complete()──▶ Idle
                  │
                  └──cancel──▶ Idle          (any state) ──fail(msg)──▶ Error ──start──▶ Recording
```

- `Recording(elapsedMs, magnitude)` updates continuously while recording (magnitude ∈ [0, 1),
  the FUTO curve `1 - 0.1^(24*rms)` — drive the pulsing ring with it).
- `Stopped(samples)` is terminal; `stop()` also returns the same array synchronously.
- `Processing` is entered by the ViewModel after stop (while a transcriber runs); the recorder's
  concrete class exposes `markProcessing()` / `complete()` for that, outside the interface.
- `Error(msg)` on: permission denied/revoked, `AudioRecord` init failure (mic busy). The mic
  button renders it with a settings link.

## 3. Audio format

- **16 kHz, mono, 16-bit signed PCM**, `MediaRecorder.AudioSource.VOICE_RECOGNITION` (same as
  FUTO). `RECORDER_SAMPLE_RATE = 16000`.
- `stop()` returns floats normalized to [-1, 1) — one per sample, in order.
- Local STT (Task 11 / whisper.cpp) consumes the `FloatArray` directly.

## 4. WAV helper (Task 10 — Groq/Gemini upload)

```kotlin
object WavWriter {
    fun encodeWav(samples: FloatArray, cacheDir: File): File  // → cacheDir/voice/voice-<ts>.wav
    fun write(samples: FloatArray, file: File)                 // explicit target file
    fun quantize(sample: Float): Short
}
```

Pure JVM (no Android deps); the ViewModel convenience is `voiceRecorderViewModel.encodeWav(samples)`.
16 kHz mono 16-bit PCM little-endian RIFF/WAVE.

## 5. Behaviour notes

- **Tap-to-toggle:** tap starts, tap stops. Swipe-down cancels (discards). Both handled by the
  ViewModel + `MicButton`; the recorder itself is dumb about gestures.
- **Max length:** ~2 min (`16000 * 120` samples); the read loop auto-stops when full and the
  recorder sets `lastStopWasAuto = true` — emit the friendly toast from that.
- **Buffer growth:** starts at 30 s of floats, expands +30 s when full (FUTO semantics).
- **Audio focus:** `AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE` requested on start, abandoned on
  stop/cancel — the lecture video keeps playing normally otherwise.
- **Threading:** recording runs in the scope passed to `start()` (use `viewModelScope`).
  `stop()`/`cancel()` are safe to call from any thread; a read may finish up to one chunk
  (100 ms) after `stop()` returns, but the snapshot is fenced so samples are exact.
- **Video auto-pause:** Task 05's `PlayerBridge` is not built yet — `VoiceRecorderViewModel`
  exposes `onPauseRequested` / `onResumeRequested` lambdas; wire them to the bridge in the
  integration pass (recording start → pause, stop/cancel → resume).

## 6. Permission flow (ViewModel-owned)

1. `toggle()` → no `RECORD_AUDIO` permission → emits `VoiceEvent.RequestPermission`.
2. Screen shows rationale dialog, launches `ActivityResultContracts.RequestPermission`.
3. `onPermissionResult(granted)` → granted: `start(scope)`; denied: recorder → `Error`,
   screen shows settings shortcut (`VoiceEvent.OpenAppSettings`).