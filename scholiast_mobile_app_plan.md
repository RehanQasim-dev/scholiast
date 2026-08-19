

# Scholiast for Android Tablet — Implementation Plan

> A native Kotlin + Jetpack Compose app for timestamped, voice-first, stylus-friendly YouTube lecture note-taking, synced to Google Drive and compatible with the existing Scholiast desktop extension's data format.

## 0. Document purpose

This plan specifies the full architecture, data model, every feature's behavior, the dark UI design system, the keyboard-less interaction model, build setup, testing strategy, milestones, and risks for the Android tablet app. Open decisions from the Q&A are captured in §2; items the user has not yet answered are marked ***(assumed — pending confirmation)*** and listed in §11.

---

## 1. Product overview

### 1.1 Goal
While watching a YouTube lecture on an Android tablet (Samsung Tab, S-Pen), the user can:
1. View a live-following transcript in a docked panel.
2. Highlight transcript lines and attach comments.
3. Tap to create a timestamped note, or capture and mark up a video frame.
4. Add and edit comments **by voice** (Whisper/Gemini; local STT offline).
5. Keep everything synced to Google Drive using the same per-page layout the desktop extension and Obsidian companion plugin already use.

### 1.2 Device & persona
- Samsung Galaxy Tab with S-Pen, Android 11+ (API 30) — **confirmed**.
- User sits in a lecture; the tablet lies on the desk; interactions are touch/stylus; physical keyboard absent.
- Internet present most of the time; offline must degrade gracefully (local STT works, cloud features disabled/dimmed).

### 1.3 Design principles
1. **Keyboard-less first** — every action reachable by tap/stylus; voice is the primary text input.
2. **Stylus-native** — pressure, hover-based palm rejection, eraser support on drawing surfaces.
3. **Dark by default** — black/very-dark surfaces, white text, high contrast.
4. **Offline-aware** — cloud-dependent features visibly disabled when offline; local paths keep working.
5. **Data-compatible with the desktop extension** — same JSON schema, same Drive layout, same merge rules.

---

## 2. Locked decisions (from Q&A)

| Area | Decision |
|---|---|
| Architecture | Full native Kotlin + Jetpack Compose; WebView **only** for the YouTube player |
| Player | Bare IFrame-API player in a WebView, dark chrome, own controls |
| Voice — add comment | Audio → Groq Whisper → text inserted as-is; if Gemini configured, audio + user prompt → Gemini response used directly |
| Voice — edit comment | Audio + prompt → Gemini → preview → **Accept/Discard**; **without Gemini: action disabled + "Set up Gemini in Settings" toast** |
| Prompts | User-editable in API settings panel; defaults ship with the app |
| Transcript | Full: live follow + color-highlight + comments on highlights |
| Sync | Google Drive (same layout/merge as repo), manual OAuth via Custom Tab (no Play Services) |
| Draw tools | Pencil, highlighter, eraser, colors, undo/redo; S-Pen pressure + palm rejection |
| Video input | Paste URL + Android share-intent ("Share to Scholiast") |
| Frame OCR | **Immediately at frame-comment save** (async, low priority) — text ready before flashcards exist; via **Gemma 4** |
| Chat with lecture | v1.1 |
| Flashcards | v1.1 — Gemini generates quizzes from notes; OCR text (frames) or transcript text (around timestamp) as source. Export: **markdown file now, `.apkg` later** |
| Voice reach | Only inside text fields |
| Keyboard | **Opt-in** — a small keyboard icon sits next to the mic inside comment fields; tapping it opens the OS keyboard. Focusing a field does **not** auto-open the keyboard |
| Handwriting | Out of scope |
| Note content | Light markdown + `#tags` |
| Offline | Local STT from **FUTO Keyboard** (cloned at `android-keyboard/`; whisper.cpp GGML engine, see §5.5.4); internet features dimmed/disabled |
| Drive OAuth | Manual OAuth (PKCE) via Custom Tab, no Play Services |
| Recorder UX | **Tap-to-toggle** mic (tap to start, tap to stop); video auto-pauses on start, resumes after Save/Cancel |
| TTS (read-aloud) | **Out of scope** — "tts" was a slip; STT only |
| Accent color | **Material You dynamic** (falls back to brand purple `#8B7CF6` on non-Material-You devices) |
| Min Android | **Android 11 (API 30)** — confirmed |
| Settings placement | **Separate Settings window** — the player screen stays clean; no settings controls on the watch interface |
| Session summary | **Removed entirely** (not even v1.1) |
| Share to Samsung Notes | **Skipped** — the system share sheet already exports content manually |
| Caption/STT language | Transcript: picker in panel header, **default English**. Gemini: no language input. Groq/local STT: language parameter selectable in Settings (default English) |

---

## 3. Architecture

### 3.1 High-level view

```
┌─────────────────────────────────────────────────────────────┐
│                     Android app (Kotlin)                    │
│                                                             │
│  ┌──────────┐ ┌──────────────────────────────────────────┐  │
│  │ Compose UI│ │            PlayerFragment               │  │
│  │ (screens) │ │  ┌──────────────────────────────────┐   │  │
│  └────┬─────┘ │  │  WebView (IFrame API player)      │   │  │
│       │       │  │  JS bridge ↔ YT.Player            │   │  │
│  ┌────┴─────┐ │  └──────────────────────────────────┘   │  │
│  │ ViewModel│◀┼── player commands/events                 │  │
│  └────┬─────┘ │          ▲ frame bytes                   │  │
│       │       └──────────┼───────────────────────────────┘  │
│  ┌────┴───────────────────────────┐                       │
│  │        Domain layer            │                       │
│  │  notes · transcript · voice ·  │                       │
│  │  draw · ocr · sync             │                       │
│  └────┬───────────────────────────┘                       │
│       │                                                   │
│  ┌────┴──────────────┐   ┌───────────────┐   ┌──────────┐ │
│  │ Room DB (local)   │   │ Files (JPEG   │   │ Keystore │ │
│  │ shard JSON blobs  │   │ frames/audio) │   │ +DataStore│ │
│  └───────────────────┘   └───────────────┘   └──────────┘ │
│            │                     │                        │
│            ▼                     ▼                        │
│  ┌───────────────────────┐  ┌──────────────────────────┐  │
│  │ Google Drive (appdata)│  │ Groq · Gemini · Gemma ·  │  │
│  │ pages/, frames/, …    │  │ local STT engine         │  │
│  └───────────────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Tech stack

| Concern | Choice |
|---|---|
| Language / UI | Kotlin, Jetpack Compose (Material 3, adaptive) |
| Player | `WebView` + YouTube IFrame Player API (no ExoPlayer — YouTube streams aren't playable natively) |
| Local DB | Room (`video_pages`, `ocr_texts`, `sync_meta` tables; JSON columns hold repo-compatible blobs) |
| Preferences / secrets | DataStore Preferences + Android Keystore (encrypted API keys/tokens) |
| HTTP | OkHttp (+ Retrofit optional) |
| JSON | kotlinx.serialization (field names mirror the TS types exactly) |
| Async | Coroutines + Flow |
| Background | WorkManager (sync worker, retry queues) |
| OAuth | Custom Tab + PKCE (no Play Services) |
| Voice capture | `MediaRecorder` (AAC/OGG) |
| Drawing | Custom `View` (Canvas/Paint), no library |
| Local STT | FUTO Keyboard engine (whisper.cpp/GGML via JNI) — see §5.5.4 |

### 3.3 Package structure

```
com.scholiast.android/
├── MainActivity.kt            # single-activity Compose app
├── ui/
│   ├── theme/                 # colors, type, shapes (dark theme)
│   ├── navigation/            # NavHost, routes
│   ├── home/                  # recent videos screen
│   ├── player/                # player screen: player + panels
│   ├── notes/                 # note timeline, comment editor sheet
│   ├── transcript/            # transcript panel, selection, swatch
│   ├── frame/                 # capture flow, MarkupView, toolbar
│   ├── voice/                 # recorder UI, voice-edit sheet
│   ├── settings/              # API keys, prompts, sync, data
│   └── components/            # shared components (swatch, chips, toasts)
├── player/
│   ├── PlayerWebView.kt       # WebView host + JS bridge
│   ├── PlayerBridge.kt        # interface + bridge impl
│   └── assets/player.html     # IFrame API page (bundled asset)
├── data/
│   ├── db/                    # Room entities, DAOs, converters
│   ├── normalize/             # normalizeUrl port (Kotlin)
│   ├── notes/                 # VideoItem DTOs (repo-compatible), repo impl
│   ├── frames/                # frame JPEG file store, metadata
│   └── prefs/                 # DataStore + Keystore wrappers
├── domain/
│   ├── transcript/            # innertube client, cue parser, chunker
│   ├── voice/                 # Transcriber interface + impls
│   ├── edit/                  # Gemini edit pipeline
│   ├── draw/                  # markup model, path→JSON, undo
│   ├── ocr/                   # Gemma OCR (v1.1)
│   ├── study/                 # flashcard generation (v1.1)
│   └── sync/
│       ├── merge/             # 3-way merge port
│       └── drive/             # Drive REST client, OAuth, worker
└── util/                      # logging, time formatting (M:SS), haptics
```

### 3.4 WebView ↔ native bridge (player)

The player HTML is a bundled asset (`assets/player.html`). It loads the IFrame API, creates `YT.Player`, and communicates with Kotlin through a `JavascriptInterface` bridge. **All navigation, media playback, and capture originate in the WebView; all UI chrome lives in Compose.**

Bridge contract:

| Direction | Message | Notes |
|---|---|---|
| JS → Kotlin | `onPlayerReady()`, `onStateChange(state)`, `onError(code)` | IFrame API events |
| JS → Kotlin | `onTimeUpdate(timeSeconds)` | JS `setInterval(250ms)` posts `getCurrentTime()`; native maps it into the panel State |
| JS → Kotlin | `onDuration(d)`, `onTitle(title)`, `onCaptionsAvailable(bool)` | title from `player.getVideoData().title` |
| JS → Kotlin | `onCaptureResult(dataUrl, w, h, error)` | canvas `drawImage(video) → toDataURL('image/jpeg', 0.8)` |
| Kotlin → JS | `seekTo(s)`, `play()`, `pause()`, `setRate(r)`, `setVolume(v)`, `captureFrame()` | via `webView.evaluateJavascript` |
| Kotlin → JS | `loadVideo(videoId)` | called once per video |

Key details:
- `captureFrame()` runs in JS on the `video` element; a tainted/black canvas (DRM) yields `error` or a fully-black frame → native shows "This video can't be frame-captured" toast (§5.7.1).
- The player stays **fully interactive** (tap play/pause, drag seek). Compose panels dock beside/below it; they never cover the video.
- The WebView is created once and reused across videos; navigating just calls `loadVideo`.

### 3.5 Concurrency model
- All network + IO on `Dispatchers.IO`; Room via suspend DAOs; UI via StateFlow collected in Compose.
- A single `PlayerViewModel` holds: `videoState`, `notesState`, `transcriptState`, `voiceState`, `syncState`.
- Recording audio must not block the UI thread; `MediaRecorder` runs in a `CoroutineScope(Dispatchers.Default)`.

---

## 4. Data model (repo-compatible)

### 4.1 Principle
The app writes the **exact same JSON structures** the desktop extension writes, so the desktop dashboard, Obsidian companion plugin, and Drive layout all read the app's data unchanged. ***(Assumed: byte-level compatibility — pending confirmation, §12)***

### 4.2 Kotlin DTOs (mirror `video-storage.ts`)

```kotlin
@Serializable data class VideoItem(
  val id: String,
  val kind: String,               // "frame" | "note" | "transcript"
  val videoTime: Double,          // seconds (range START for transcript)
  val frame: FrameImage? = null,  // only kind == "frame"
  val markup: VideoMarkup? = null,
  val notes: List<String> = emptyList(),
  val updatedAt: Long? = null,
  val timeEnd: Double? = null,    // transcript range END
  val quote: String? = null,
  val color: String? = null,      // yellow|red|green|black
  val anchor: TranscriptAnchor? = null,
  val excalidrawScene: JsonElement? = null, // preserved for desktop compat, unused by app
  // App-only additions (kept out of Drive JSON? no — additive fields are fine):
  val ocrText: String? = null,    // Gemma OCR (v1.1), frames only
)

@Serializable data class TranscriptAnchor(val startCue: Int, val startOffset: Int, val endCue: Int, val endOffset: Int)
@Serializable data class FrameImage(val w: Int, val h: Int, val driveId: String? = null) // JPEG bytes NOT here
@Serializable data class VideoMarkup(
  val strokes: List<Stroke>, val lines: List<Line>,
  val texts: List<TextLabel>, val rects: List<Rect>?, val arrows: List<Arrow>?,
) // all coords normalized 0..1
```

- `notes[]` keep the `text<!--timestamp:N--><!--edited:M-->` format (stable IDs for sync merge) — port `video-notes.ts` parsing.
- Note: `excalidrawScene` is preserved/ignored — the app's native drawings are expressed through `markup`, so a frame drawn in the app renders in the desktop dashboard (which repaints `markup` via SVG), and a frame drawn with Excalidraw on desktop still shows in the app (as its baked JPEG + markup).

### 4.3 Local persistence

| Store | Location | Contents |
|---|---|---|
| Room `video_pages` | DB | `urlHash PK, url, videoId, title, itemsJson, updatedAt, snapJson, fileId, headRevisionId` |
| Room `ocr_texts` | DB | `itemId PK, text, source, createdAt` |
| Frame JPEGs | `filesDir/frames/<itemId>.jpg` | real bytes (never inline in JSON), like the repo's IndexedDB |
| Audio recordings | `cacheDir/voice/<session>.m4a` | temp until transcribed/edited |
| DataStore | prefs | API keys (see Keystore), prompts, toggles, last session |
| Keystore | Android Keystore | Groq key, Gemini/Gemma key, Drive refresh token ***(assumed: encrypted — pending confirmation)*** |

### 4.4 URL normalization
Port `normalizeUrl` from `src/utils/highlighter.ts`: strip fragment, `utm_*`, `fbclid`, `_ga`, and YouTube's `t`/`start` params. Store the hash = same SHA-256-prefix scheme the repo uses for Drive file names (`pages/page-<urlhash>.json`).

### 4.5 Drive layout (unchanged)
- `drive.appdata`:
  - `pages/page-<urlhash>.json` → `PageRecord` (`version:2, url, title?, videoId?, highlights[], drawings[], videoItems[], diagrams[], tombstones{}`)
  - `frames/frame-<itemId>.jpg` → frame JPEG blobs
  - `diagrams/diagram-<id>.png` + `.scene.json` (read-only compat; app doesn't create diagrams)
- Local bookkeeping mirrors `snap:<url>` (merge base) and `pagemeta:<url>` (`fileId`, `headRevisionId`) in the Room `video_pages` row.

---

## 5. Features — detailed behavior

### 5.1 App entry & navigation

**Routes** (Compose Navigation):
1. **Home** — recent videos, search box, "Open link" field, sync status.
2. **Player** — the main working screen (`/player?videoId=…`).
3. **Settings** — `/settings`.
4. **(v1.1)** Chat, Flashcards screens.

**Entry points:**
- Paste/type a YouTube URL in Home's "Open link" field.
- Android **Share intent**: any app shares a `text/plain` URL → app opens Player directly.
- Resume: Home lists last N videos (newest first) with per-video note counts; tapping resumes playback position (stored in Room) and scrolls the note timeline.

### 5.2 Loading a video

```
URL → extract videoId (any form: watch?v=, youtu.be/, shorts/...)
→ create/load video_pages row (normalized URL, urlHash)
→ PlayerViewModel.loadVideo(videoId)
→ PlayerWebView.loadVideo(videoId)
→ onPlayerReady → start time poll → panels enable
```
Edge cases: invalid URL → toast; network error → offline banner; embedding disabled → player shows "Video can't be played in this app" + still allow transcript (transcript fetch is independent of embeddability).

### 5.3 Player screen (core layout)

**Landscape:** `Row { Player (fills width, 62%) | Panel (fixed 38%, min 320dp) }` — player left, panel right. **Portrait:** `Column { Player (16:9) | Panel (rest) }` — player top, panel below. Rotation is free ***(assumed — pending confirmation)***.

**Player chrome (Compose, overlaid on the WebView):**
- Tap video → toggle chrome (play/pause, seek bar, time, **-15s/+15s**, speed menu, fullscreen toggle).
- A floating **"+"** button on the panel header = *new note at current timestamp*.

### 5.4 Note timeline & timestamped notes

**Panel content (shared by landscape/portrait):** a tabbed panel with two tabs — **Notes** and **Transcript** (Transcript disabled if captions unavailable).

**Notes tab:**
- Time-ordered list of all items for the video (frames, notes, transcript highlights), newest-last, each with an `M:SS` chip.
- **Tapping an `M:SS` chip seeks the video to that moment.**
- Each item card shows: kind icon, timestamp, quote/preview, comment thread (collapsed), color rail (for transcript highlights).
- **"＋ New note"** button: captures `currentTime`, opens the **comment editor sheet**.

**Comment editor sheet (bottom sheet, keyboard-less):**
- A `BasicTextField` (light markdown: bold/italic buttons, `#tag` autocomplete pill, link insertion). **The OS keyboard does NOT auto-open on focus** — a small **keyboard icon** next to the microphone button opens it on tap; the mic + keyboard icons sit side by side at the editor's bottom.
- A **microphone button** (see §5.5).
- The timestamp is baked in automatically (`videoTime`); a chip shows it and taps to seek.
- **Save / Cancel** buttons (large, ≥48dp). `Ctrl+Enter`-equivalent is "Save".

**Comment thread rendering:** port the repo's `video-notes.ts` `renderNoteHtml` subset — bold/italic/links/`#tags` — rendered as `AnnotatedString`; tags as colored pills. Tapping a tag filters the timeline by it (v1.1 nicety; optional).

### 5.5 Voice input system (the heart of keyboard-less)

#### 5.5.1 Recorder
- `MediaRecorder`, AAC in a `.m4a`, into `cacheDir/voice/`.
- UI: **tap-to-toggle** mic button — tap once to start recording, tap again to stop (a pulsing red ring + elapsed time show while recording; a swipe-down cancels). Video auto-pauses on start, resumes after Save/Cancel.
- Max length guard (e.g., 2 min) with a friendly cutoff.

#### 5.5.2 Add-comment flow (two branches)
- **Whisper only configured:** `audio → Groq POST /audio/transcriptions (model=whisper-large-v3-turbo) → transcribed text → inserted verbatim into the editor as draft text` → user reviews/edits → Save.
- **Gemini also configured:** `audio (inline) + prompt → Gemini generateContent → response text → inserted into the editor as draft` → user reviews/edits → Save.
- If neither is configured → mic button disabled with "Set up speech in Settings" toast.

#### 5.5.3 Edit-existing-comment flow (voice edit sheet)
1. User taps a comment's **✎ / 🎤 (edit by voice)** action.
2. Sheet opens: original text on top, a large mic button, an editable **prompt field** (pre-filled from settings, per-session override allowed).
3. User speaks: "Make this more concise," "Fix the grammar," "Turn this into a question."
4. `audio + prompt → Gemini (gemini-3.6-flash) → edited text` shown in a **preview** below the original.
5. Buttons: **Accept** (replaces the comment, stamps `<!--edited:N-->`), **Discard**, **Retry** (re-runs with a new recording).
6. If Gemini is not configured → this flow is disabled with a "Set up Gemini in Settings" toast. — **confirmed**.

#### 5.5.4 Local STT (offline)
- Source: **FUTO Keyboard** (cloned at `android-keyboard/` in this repo) — its `voiceinput-shared` module is a whisper.cpp/GGML inference stack exposed over JNI. We extract only: the Kotlin wrapper API (`AudioRecognizer`, `WhisperGGML`, `ModelManager`, `Models`), the native `org_futo_voiceinput_WhisperGGML` JNI layer, and the model-download/management logic. Details pinned in §5.5.4a after source review.
- License note: FUTO Keyboard is **FUTO Source First License 1.1** — fine for personal/sideloaded use; if this app is ever distributed, the engine must be re-licensed or swapped (e.g., sherpa-onnx).
- Implementation: a `LocalSTTTranscriber` implementing the same `Transcriber` interface as the Groq/Gemini implementations. Model files (e.g., whisper `tiny`/`base` GGML) are downloaded once with consent or bundled; stored in `filesDir/models/`.
- Offline behavior: voice still works (local STT); the prompt/AI features (Gemini/Gemma) are **dimmed/disabled** with a "Needs internet" hint.

#### 5.5.4a FUTO engine extraction notes (filled from source review)

The cloned `android-keyboard/` repo is **FUTO Keyboard** (LatinIME fork). Its voice-input stack is a self-contained **whisper.cpp/GGML** engine with a Kotlin wrapper layer and a thin JNI bridge — exactly what we need. What we extract:

**1. Native engine (vendored source, build only what we need)**
- `android-keyboard/native/jni/src/ggml/` — the full **whisper.cpp** + GGML source tree, compiled into the keyboard's `libjni_latinime.so` via CMake (app's `build.gradle`: `externalNativeBuild { cmake { path 'native/jni/CMakeLists.txt' } }`, NDK 28.2).
- `android-keyboard/native/jni/org_futo_voiceinput_WhisperGGML.cpp` — the JNI glue. Exposes:
  - `openFromBufferNative(Buffer)` → `whisper_init_from_buffer_with_params(…, { use_gpu = false })`. **Requires a direct ByteBuffer** (mmap'd — `FileChannel.map` or `assets.openFd`), since the Kotlin side only calls this variant (the file-path variant exists but is unused).
  - `inferNative(handle, float[], prompt, languages[], bailLanguages[], decodingMode, suppressNonSpeechTokens)` → runs `whisper_full` on CPU; `n_threads` = core count (clamped 2..16); **BeamSearch5** or greedy; `no_timestamps` for < 25 s audio; partial results streamed to Kotlin via callback; **cooperative cancel** via `abort_callback` + volatile `cancel_flag`; language-bail detection returns `<>CANCELLED<> lang=…`.
  - `cancelNative` / `closeNative` / `openNative` (unused by Kotlin wrapper).
  - Registered into the classpath `org/futo/voiceinput/shared/ggml/WhisperGGML`.
- Copy the ggml/whisper tree + this `.cpp` (+ `jni_common.*`, `jni_utils.*`, `defines.h`) into our module's `src/main/cpp/` and write a **minimal CMakeLists that compiles only whisper + this JNI** — NOT the LatinIME dictionary/downsample stack (those are separate JNI entries in the same CMake and must be dropped).

**2. Kotlin wrapper layer (copy + slim down from `voiceinput-shared/src/main/java/org/futo/voiceinput/shared/`)**
- `ggml/WhisperGGML.kt` — thin suspend wrapper; single-threaded `inferenceContext`; exceptions `InvalidModelException` / `InferenceCancelledException` / `BailLanguageException`. Port as-is.
- `AudioRecognizer.kt` — the recording + orchestration layer. **16 kHz mono PCM-16 `AudioRecord` (VOICE_RECOGNITION)** streams straight into a growing float buffer (no file round-trip); optional VAD auto-stop (`com.konovalov.vad` — WebRTC GMM, needs a bundled AAR); RMS magnitude + mic-blocked detection; audio focus; Bluetooth SCO handling. Reuse as-is, minus: the IME-specific `openPermissionSettings` (we do a normal permission request) and the `RecognizerView` Compose UI (we build our own bubble/meter). VAD can be **skipped** — our recorder is tap-to-toggle (explicit stop), so auto-stop is unnecessary.
- `whisper/ModelManager.kt`, `whisper/MultiModelRunner.kt`, `types/ModelData.kt`, `Models.kt` — model caching, primary+language-specific model switching, and the model definitions. Port.
- Model files: **not vendored in the repo** (the built-in `tiny_en` lives in an uninitialized submodule; the `*.bin` files are absent). English `tiny_en`/`base_en`/`small_en` and multilingual `tiny`/`base`/`small` are **ACFT-quantized Q8_0 ggml models** downloaded from `https://keyboard.futo.tech/voice-input-models`, with known SHA-256 checksums in `Models.kt` (e.g. `base_en_acft_q8_0.bin` = `e9b4b7b8…`). For the app: download on first use with consent (checksum-verified), store in `filesDir/models/`; ship `tiny_en` as the offline default if we later vendor it.
- `ModelLoader` impls: `ModelBuiltInAsset` (assets, mmap via `openFd`) and `ModelDownloadable` (filesDir, mmap + `.load()`) — both produce the direct `MappedByteBuffer` the JNI needs.

**3. Integration differences vs the keyboard**
- We keep the `org.futo.voiceinput.shared.ggml.WhisperGGML` classpath (or rename it in both the Kotlin and the C++ `kClassPathName` string — trivial either way); our `System.loadLibrary("scholiast_whisper")` replaces `jni_latinime`.
- The `Transcriber` interface from §5.5.5 gets a `LocalFutoTranscriber` impl that owns an `AudioRecognizer`, records on tap-start, and returns the finished text on tap-stop — matching our tap-to-toggle flow.
- **License:** FUTO Keyboard is under the **FUTO Source First License 1.1** — usable for this personal/sideloaded app, but the engine cannot be redistributed; if this is ever published, swap the inference core for sherpa-onnx/Vosk (same `Transcriber` interface, no app changes).

#### 5.5.5 Transcriber interface

```kotlin
interface Transcriber {
  suspend fun transcribe(audioFile: File, language: String?): String
}
class GroqTranscriber(key) : Transcriber        // whisper-large-v3-turbo
class GeminiTranscriber(key, model) : Transcriber // audio+prompt, returns response
class LocalSTTTranscriber(modelsDir) : Transcriber // offline engine
```

#### 5.5.6 API settings panel (in the Settings window, never on the player screen)
- Fields: **Groq API key**, **Gemini/Gemma API key**, and a **prompt editor** with two editable defaults:
  - *Add-comment prompt* (default): "You are helping write study notes. Turn the user's speech into a clear, concise note, keeping technical terms and key facts. Output only the note text."
  - *Edit-comment prompt* (default): "The user wants to modify their note below. Follow their spoken instructions, keep it concise, output only the revised note."
- **Speech language** selector (default English): the language passed to **Groq Whisper** and the **local STT** engine. Gemini needs no language input. Transcript caption language is a separate per-video picker (§5.6.1), also defaulting to English.
- Keys saved encrypted (Android Keystore) — **confirmed**. A **Test connection** button pings each provider.
- Model ID fields default to `whisper-large-v3-turbo`, `gemini-3.6-flash`, and the Gemma OCR model — **confirmed**.

### 5.6 Transcript panel

#### 5.6.1 Fetch & parse (port from repo, no DOM)
1. `POST youtubei/v1/player` (IOS then WEB client context) → `captionTracks` list.
2. `pickTrack`: session preference → English (non-ASR) → first.
3. Fetch track `baseUrl` (+`&fmt=json3`) → parse cues (`parseCuesXml` port) → group into paragraphs via `semanticChunk` port.
4. Language picker in the panel header when >1 track; choice remembered per video session.
5. No captions → Transcript tab disabled with "No captions for this video" hint.

#### 5.6.2 Live follow
- A 250 ms poll of `player.getCurrentTime()` (from the JS bridge) marks the current cue: `.is-now` highlight + smooth scroll so the active line sits ~30% from the panel top. Only touches the UI when the active cue changes.

#### 5.6.3 Selection → highlight → comment
- **Stylus-friendly interaction:** tap a paragraph selects the whole cue; drag-selection (Compose `SelectionContainer`) selects a range.
- On selection end, a **swatch popup** floats near the selection: **yellow / red / green** swatches + a **💬 Comment** button.
- Highlight derives the `M:SS–M:SS` range from the covered cues and stores a `kind:"transcript"` item with `anchor{startCue,startOffset,endCue,endOffset}` (cue-index anchoring, stable — same as repo).
- Highlighted ranges are repainted inline as the user scrolls; existing highlights render on reopen.
- Tapping an existing highlight opens its comment thread.

#### 5.6.4 Transcript search (optional, cheap)
- A search field filters paragraphs; matches jump to that cue and pause.

### 5.7 Frame capture & markup

#### 5.7.1 Capture
- **Capture button** (toolbar) or voice? (voice is fields-only) — a toolbar button on the panel header: **🎞 Capture frame**.
- JS captures: pause video, `drawImage(video)` → JPEG base64 → native decodes to `Bitmap` + stores JPEG file. Resume after save/discard if it was playing (repo behavior).
- DRM/tainted → black frame or error → toast "This video can't be captured" and return to playing state.

#### 5.7.2 Draw surface (`MarkupView` — custom View)
- Layers: bottom = frame `Bitmap`; top = transparent markup layer (strokes/erasures).
- **Pencil**: round cap, opaque, width = f(pressure) within a min/max.
- **Highlighter**: wide stroke, ~35% alpha, (optionally `PorterDuff.Mode.SRC_OVER` with alpha, or a lighter composite for glow).
- **Eraser**: erases the markup layer only (`PorterDuff.CLEAR` on the overlay), never the frame.
- **Colors**: yellow / red / green / black (swatch bar, active marked).
- **Undo/Redo**: stack of snapshot strokes (cap 50).
- **Palm rejection**: `onHoverEvent` tracks pen proximity (`ACTION_HOVER_ENTER/MOVE`); while the pen is near, finger `ACTION_DOWN/MOVE` are discarded. `TOOL_TYPE_STYLUS`/`ERASER`/`FINGER` dispatch. Pressure from `AXIS_PRESSURE`.
- Optional S-Pen haptics on stroke start/end ***(pending: nice-to-have)***.
- Toolbar: tool, color, undo, redo, clear, **Save**, **Discard**, and a **Comment** action (opens the editor sheet attached to the frame).

#### 5.7.3 Comment paths (the four kinds the user defined)
| Path | Stored as | Frame saved? | OCR? |
|---|---|---|---|
| Frame + comment (original) | `kind:"frame"`, `notes[]` | Yes (original JPEG) | Yes (immediately at save) |
| Frame edited + comment | `kind:"frame"`, edited JPEG replaces original | Yes (edited JPEG) | Yes (immediately at save) |
| Comment on timestamp, no frame | `kind:"note"` | No | No |
| Transcript highlight + comment | `kind:"transcript"` | No | No (text already available) |

- **OCR runs immediately after a frame-comment saves** (async, low priority, quota-aware): Gemma vision → text → `ocrText` on the item. Only frame paths OCR; `note`/`transcript` never do. The text is already stored by the time flashcards (v1.1) need it — lazy generation was rejected.

#### 5.7.4 Frame image storage
- JPEG → `filesDir/frames/<itemId>.jpg`; `frame{ w, h, driveId? }` in the item JSON. Never inline bytes. On item delete → delete file + mark Drive blob for tombstone.

### 5.8 Google Drive sync

#### 5.8.1 OAuth (manual, Custom Tab, PKCE)
1. Build auth URL: `client_id`, `response_type=code`, `redirect_uri`, `code_challenge` (S256), `access_type=offline`, `prompt=consent`, `scope` (appdata `https://www.googleapis.com/auth/drive.appdata`).
2. Open in a Custom Tab; redirect back to the app's registered redirect.
3. Exchange code → refresh token (saved in Keystore). Renew via `POST /token` with `grant_type=refresh_token` — no window needed.
- Redirect URI note: custom-scheme redirects for new Android apps require enabling "Custom URI scheme" in the OAuth client's Advanced settings (Google's 2023 restriction). Fallback documented in §12/§11.

#### 5.8.2 Sync engine (port `sync-engine.ts` + `google-drive.ts` + `shared/merge.ts`)
- **Per-page, never whole-dataset.** Each changed page enqueues; a reconcile handles one page at a time.
- **Push:** assemble `PageRecord` from Room → upload frames lacking `driveId` → PUT page JSON with CAS on `headRevisionId` → update `pagemeta`.
- **Pull:** list `pages/` files (the change manifest) → for pages whose remote `headRevisionId` ≠ local `pagemeta.headRevisionId` (or local differs from `snap`), download → `mergePageRecord` (newest-wins per item, tombstones, comment merge) → write back + re-upload if we made changes → pull missing frame blobs.
- **Scheduling:** WorkManager periodic (e.g., every 15 min, network-constrained) + on-app-foreground + manual **Sync now** in Settings. Offline → worker reschedules, nothing lost.
- **Status:** sync state surfaced on Home and Settings (last synced, pending count, in-flight page).

#### 5.8.3 Compatibility test target
- A golden test: the Kotlin `mergePageRecord` must produce identical output to the TS `mergePageRecord` for the same fixtures (port the repo's `shared/merge.test.ts` cases).

#### 5.9 v1.1 features (planned, not built in v1)
- **Chat with this lecture** — Gemini RAG over transcript + notes for the current video.
- **OCR (Gemma 4)** — runs **immediately at frame-comment save** (§5.7.3), storing `ocrText` on the item; surfaced in the frame card and consumed by flashcards.
- **Flashcards** — user selects a video/notes → Gemini generates Q/A (or cloze) cards from OCR text + transcript text near timestamps → export as a **markdown file** for the vault now; **`.apkg` export added later**.
- ~~Session summary~~ — **removed entirely**; user has no use for it.
- ~~TTS (read-aloud)~~ — **removed**: "tts" was a slip for speech-to-text; STT is covered by §5.5.
- ~~Share to Samsung Notes~~ — **skipped**; the system share sheet already exports content manually.

### 5.10 Offline behavior (summary)
| Feature | Online | Offline |
|---|---|---|
| Playback | ✓ | ✓ (if already loaded / stream cached) |
| Timestamped notes (typed) | ✓ | ✓ |
| Voice (Whisper/Gemini) | ✓ | ✗ (dimmed) |
| Voice (local STT) | ✓ | ✓ |
| Frame capture + draw | ✓ | ✓ |
| Drive sync | ✓ | ✗ (queued, auto-retried) |
| Transcript fetch | ✓ | ✗ (cached transcript reused if present) |

### 5.11 Settings screen
A **separate window** (never part of the player screen). Reached from Home's header.
- **Speech**: Groq key, Gemini/Gemma key, model IDs, prompts (add/edit defaults), **speech language** (default English, used by Groq Whisper + local STT), local STT model management (download/update, checksum-verified).
- **Sync**: connect/disconnect Drive, Sync now, last-synced, storage used.
- **Playback**: speed defaults, seek-step size, auto-pause-on-record (always on).
- **Appearance**: Material You dynamic theme — the app follows the device wallpaper palette (`dynamicDarkColorScheme()`); on non-Material-You devices it falls back to the fixed dark palette below. No light mode in v1.
- **Data**: delete local data, delete Drive data (typed confirmation, mirroring the extension's destructive-wipe guards).
- **About**: version, links, privacy note (which data goes to which provider).

---

## 6. UI/UX design (dark theme)

### 6.1 Design tokens

| Token | Value |
|---|---|
| Background (screen) | `#000000` |
| Surface (panels/cards) | `#0B0D14` |
| Surface elevated (sheets, dialogs) | `#151824` |
| Hairline / divider | `#232733` |
| Text primary | `#FFFFFF` |
| Text secondary | `#9AA0A6` |
| Text disabled | `#4A4F59` |
| Accent (brand) | **Material You dynamic** — `dynamicDarkColorScheme()` when the device supports it (Android 12+); fallback brand purple `#8B7CF6` otherwise. The three highlight hues and text/surface colors stay fixed (they're data colors, not chrome) |
| Highlight colors | yellow `#F9E64D` · red `#FF5A5A` · green `#5FE3A0` (same hues as the highlighter on the live page) |
| Danger | `#FF5A5A` |
| Success | `#5FE3A0` |
| Radius | 12dp cards, 16dp sheets, 8dp chips |
| Min touch target | 48dp (44dp absolute floor) |
| Type | System sans (Roboto); tabular figures (`fontFeatureSettings`) for timestamps/counts |
| Motion | 150–250 ms ease-out; reduced-motion respected (`Settings.System` animation scale) |

### 6.2 Component library (Compose)
- `ScholiastCard` (surface card, hairline border), `TimestampChip` (mono, tap→seek), `ColorSwatch` (44dp circular, active ring), `MicButton` (record states), `KeyboardButton` (small, next to the mic — opens the OS keyboard, §5.4), `VoiceEditSheet`, `EditorField` (light-markdown editor with tag pills), `NoteCard` (kind icon + preview + thread), `TranscriptLine`, `SwatchPopup`, `SyncStatusBar`, `Toast` (the app's own, dark, bottom-center), `ConfirmDialog` (typed-confirm for destructive wipes).

### 6.3 Screen designs

#### Home
- Top: **Open link** field (large, with a paste icon) + **Sync status** chip.
- Body: **Recent videos** grid (2 columns): thumbnail (from player), title, note count, last-opened; tap to resume.
- Empty state: dark placeholder with instructions ("Paste a YouTube link, or share a video to Scholiast").

#### Player (the main screen)
- Landscape: player left; right panel = tabs **Notes / Transcript** + a vertical rail of quick actions (＋ note, 🎞 capture). Panel header shows title, video time, sync chip.
- Portrait: player top (16:9), panel below.
- Player chrome overlay: centered play, bottom seek bar with time + **−15s / +15s**, right-side speed + fullscreen.

#### Voice-edit sheet
- Top: "Edit by voice", original comment (read-only, scrollable).
- Middle: large mic button + editable prompt field.
- Bottom: **Accept / Discard / Retry** (Accept emphasized purple).

#### Frame draw screen
- Full-bleed `MarkupView` with the frame; bottom toolbar: **pencil, highlighter, eraser, colors, undo, redo, clear**; top bar: **Cancel / Save / 💬 Comment**.
- Recording indicator if a voice note is attached.

#### Settings
- Grouped lists (Material 3 style), dark; API fields with "show/hide" and "Test" buttons; prompts in expandable cards.

### 6.4 Keyboard-less interaction spec
- **Voice reach**: only inside text fields.
- **Settings live in a separate Settings window** — nothing but playback + notes/transcript controls appear on the player screen.
- Every button ≥48dp, thumb-reachable (bottom/right placement in landscape).
- Voice is the primary text input; the keyboard is **opt-in via the keyboard icon** next to the mic (§5.4).
- **All dismissible surfaces** have a large ✕; the back gesture (Android system) closes sheets before leaving the screen.
- Focus order and TalkBack labels on every control (accessibility parity).

---

## 7. Build & project setup

### 7.1 Gradle
- Kotlin 2.x, AGP current stable, Compose BOM, Material 3, Room, DataStore, Navigation, Lifecycle, WorkManager, OkHttp, kotlinx.serialization, Coil (thumbnails).
- Target/compile SDK 35, min **API 30 (Android 11)** — confirmed.
- Two flavors: `dev` (debug, logcat verbose, fake API keys) and `prod` (release, R8).

### 7.2 Repo layout
- New top-level `android/` directory in this repo (parallel to `src/`, `shared/`), so the port keeps one monorepo with the shared fixtures available for golden tests.

### 7.3 Distribution
- Sideloaded APK/AAB in dev; signed release for personal install. No Play Store requirement in v1.

---

## 8. Testing strategy

| Layer | Approach |
|---|---|
| Unit | Port `shared/merge.test.ts` → Kotlin golden tests; transcript cue-parsing fixtures; `normalizeUrl` cases; markdown renderer; voice-edit prompt templates; note serialization round-trips (must equal TS byte-for-byte) |
| Integration | OkHttp MockWebServer for Drive + Groq + Gemini + innertube endpoints |
| UI (Compose) | Instrumented tests: navigation, note CRUD, voice-edit accept/discard, transcript selection → swatch → highlight |
| MarkupView | Robolectric + on-device: pressure mapping, palm-rejection (pen-hover then finger → no stroke), eraser, undo/redo |
| Device matrix | Samsung Galaxy Tab S-series (S8/S9-class) landscape+portrait, with S-Pen; Kiwi/desktop extension reading the app's Drive output (cross-client smoke test) |

---

## 9. Milestones & phasing

| Milestone | Contents | Exit criteria |
|---|---|---|
| **M0** | Project skeleton, theme, navigation, Home screen, URL open | App launches dark, opens a video in the WebView player |
| **M1** | Player chrome + Notes timeline + timestamped notes + editor (light markdown) | Add/save/seek notes end-to-end |
| **M2** | Voice: recorder, Groq Whisper add-comment, Gemini edit (preview/accept/discard), prompts in Settings, local STT engine extraction + offline dimming | Speak-to-add and speak-to-edit work; offline mode sane |
| **M3** | Transcript: innertube fetch, chunking, live follow, selection→swatch→highlight→comment, language picker | Full transcript annotation working |
| **M4** | Frame capture + MarkupView (pencil/highlighter/eraser/colors/undo/palm rejection) + the 4 comment paths + **OCR-at-save (Gemma)** | Capture→draw→comment→save round-trip; OCR text stored per frame-comment |
| **M5** | Drive: OAuth, per-page merge, WorkManager sync, status UI | Two-device sync verified against the desktop extension |
| **M6** | Settings polish, onboarding, toasts/dialogs, accessibility, performance pass | Release candidate on device |
| **v1.1** | Chat-with-lecture, flashcards (markdown export, `.apkg` later) | Feature-complete suite |

---

## 10. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| IFrame API embedding disabled on some videos | Video won't play | Detect + message; transcript still usable; open-in-YouTube button |
| DRM/tainted video → black frame | Capture fails | Detect black frame; toast; keep capture button but explain |
| Innertube endpoint changes | Transcript breaks | It already has IOS→WEB fallback + inline-script alternative; isolate in one client with cache; monitor |
| Groq/Gemini rate limits/quotas | Voice fails mid-lecture | Local STT fallback; clear errors; retry/queue |
| OAuth custom-scheme restrictions | Drive login blocked | Enable custom-scheme in Google client advanced settings; fallback to loopback/out-of-band documented in `DISTRIBUTION`-style notes |
| JSON compat drift vs TS | Desktop can't read app data | Golden tests pinning the exact serialization; share fixtures |
| WebView memory on large frames | Jank/oom | Downscale to ≤1280px (same as repo), recycle bitmaps |
| Selection on tablet is fiddly | Highlight flow annoying | Tap-to-select-cue default + drag-select as secondary; large swatches |

---

## 11. Open items — all resolved

Every question raised in the Q&A rounds is now answered and captured in §2/§5/§6/§7. No pending decisions remain — the plan is ready to build from.

---

## 12. Ported module map (repo → app)

| Repo file | App destination | Status |
|---|---|---|
| `video-transcript.ts` (innertube, pickTrack, parseCuesXml, semanticChunk) | `domain/transcript/` | Port (drop DOM/Defuddle paths) |
| `video-storage.ts` (VideoItem DTOs, genVideoId, upsert) | `data/notes/` | Port verbatim (field names) |
| `video-notes.ts` (note parse/render, formatVideoTime) | `domain/notes/` | Port |
| `video-markup.ts` (normalized markup → SVG) | `domain/draw/` + native renderer | Adapt (native Canvas replaces SVG) |
| `shared/merge.ts` (mergePageRecord, pageFileName) | `domain/sync/merge/` | Port + golden tests |
| `google-drive.ts` (REST, OAuth, appdata) | `domain/sync/drive/` | Adapt (Custom Tab OAuth replaces identity) |
| `sync-engine.ts` (per-page reconcile) | `domain/sync/` | Port |
| `frame-store.ts` (blob store) | `data/frames/` (files) | Adapt |
| `highlighter.ts` (`normalizeUrl`) | `data/normalize/` | Port |
| `android-keyboard/native/jni/src/ggml/` + `org_futo_voiceinput_WhisperGGML.cpp` (+ `jni_common.*`, `jni_utils.*`, `defines.h`) | `src/main/cpp/` (minimal CMake, whisper only) | Vendor + build only the whisper JNI |
| `android-keyboard/voiceinput-shared/…/ggml/WhisperGGML.kt`, `AudioRecognizer.kt`, `whisper/ModelManager.kt`, `whisper/MultiModelRunner.kt`, `types/ModelData.kt`, `Models.kt` | `domain/voice/local/` | Port (drop IME-specific bits + RecognizerView) |
| `video-player-stage.ts` (scaled player layout) | `ui/player/` layout | Replace (WebView + Compose layout replaces CSS transform) |
| `video-transcript-panel.ts`, `video-comments.ts` | `ui/transcript/`, `ui/notes/` | Rebuild in Compose (logic ports) |
| `video-annotator.ts` | `ui/frame/` + `MarkupView` | Rebuild native |
| `video-excalidraw.*` | — | Dropped (native drawing replaces it) |

---

