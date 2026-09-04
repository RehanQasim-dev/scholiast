# Product Spec: Scholiast Tauri Companion App

## 1. Product Overview
Scholiast Companion is a cross-platform desktop and mobile application (Linux Desktop, Android, Windows, macOS) built on **Tauri v2 + React 18 + Rust**. It serves as an offline-first companion to the Scholiast browser extension, bringing timestamped voice-first YouTube lecture note-taking, live spoken transcript annotation, distraction-free webpage reading and highlighting, high-DPI frame capture with Excalidraw sketch markup, local hardware-accelerated Whisper STT, cloud AI note revision (Groq/Gemini), and byte-compatible Google Drive sync into a unified native application.

---

## 2. Numbered Behavior Invariants

### 2.1 Navigation & Workspace Ergonomics
- **B1**: The application adapts layout fluidly to three hardware profiles: Mobile Phones (portrait single-column with bottom sheets), Tablets (landscape 60/40 resizable split with S-Pen direct highlighting), and Desktop (collapsible navigation rail with windowed/fullscreen dual panes).
- **B2**: Study sessions (`/player`, `/reader`, `/frame`) operate in immersive zero-wasted-space mode: headers and tab bars automatically collapse or dock to maximize video and reading viewport.
- **B3**: Top-level overview screens (`/home`, `/settings`) provide generous status bar padding (`pt-7 sm:pt-9 px-6`) to prevent collision with Android status bars, camera notches, or tablet bezels.
- **B4**: Navigation strictly separates content sessions from navigation tabs; tapping an active video or article opens the session, while back navigation preserves playback position and unsaved drafts.

### 2.2 YouTube Lecture Player & Chrome
- **B5**: YouTube videos load inside an embedded player completely isolated behind custom dark chrome (`#000000` / `#0b0d14`), eliminating native YouTube UI, overlays, and recommendation end-screens.
- **B6**: The player interface provides custom controls: play/pause, scrub bar, time display, $\pm 15$s seek buttons, speed selector (0.25x–2.0x), volume, fullscreen toggle, frame capture button, and "+ Note" composer.
- **B7**: Playback position (`resume_at`) is continuously tracked and automatically restored when returning to a video.
- **B8**: Time updates poll at 250ms into an ephemeral subscription store without triggering full-tree React rerenders.

### 2.3 Note Timeline & Comment Authoring
- **B9**: The Notes timeline presents chronological, timestamped cards (`M:SS` or `HH:MM:SS`) spanning frames, text notes, and transcript highlights; clicking any timestamp instantly seeks the video to that second.
- **B10**: Authoring a note captures the exact current timestamp and opens a lightweight composer with markdown support (bold, italic, code, bullets) and `#tag` autocomplete.
- **B11**: Typing comments never triggers full-screen modal takeovers; composers remain non-intrusive floating cards or bottom sheets.
- **B12**: Both voice (`[🎙️]`) and keyboard (`[⌨️]`) input buttons sit side-by-side; on desktop/tablets, keyboard focus does not obscure the video viewport.

### 2.4 Spoken Transcript Annotation
- **B13**: Transcripts load directly via YouTube's internal caption tracks without requiring third-party cloud scrapers, gracefully falling back across available languages.
- **B14**: Active transcript lines follow playback via karaoke-style auto-scrolling, keeping the active spoken cue ~30% from the top of the viewport.
- **B15**: Selecting dialogue text in the transcript opens the 3-color swatch popup (`yellow`, `red`, `green`) to create cue-anchored highlights with attached comment threads.
- **B16**: If a video has no available captions, the transcript tab displays an empty state notification: *"No transcript available for this video"*.

### 2.5 Voice Notes & Dynamic Aura Visualizer
- **B17**: Tapping the voice icon triggers the **Dynamic Aura Pill**: 4 vertical glowing purple frequency bars bounce in real time to live microphone amplitude via the Web Audio API.
- **B18**: Voice Activity Detection (VAD) monitors speech; detecting 2.0 seconds of silence (or a manual tap) terminates recording automatically without dialog prompts.
- **B19**: Transcriptions execute locally via `-O3` compiled Whisper STT or via configured cloud providers (Groq/Gemini), committing directly to SQLite upon completion.
- **B20**: Upon saving a voice note, a 2-second non-blocking toast displays: `Saved: "[transcribed text]..." [ Undo ]`.
- **B21**: When Gemini is configured, users can use speech-directed voice edits to revise existing notes based on user-editable instructions in Settings.

### 2.6 Frame Capture & Excalidraw Markup
- **B22**: Tapping "Capture Frame" pauses video playback and extracts the player surface into a 1280px JPEG via native platform snapshot backends (avoiding cross-origin canvas security limitations).
- **B23**: Captured frames open in an embedded Excalidraw canvas, allowing users to draw vector annotations, arrows, callout text, and mathematical formulas.
- **B24**: Saving a marked-up frame exports a high-DPI composite PNG and scene JSON, saving it into the note timeline and syncing as an independent image blob.
- **B25**: Reopening a saved frame diagram reloads the original Excalidraw vector scene for non-destructive, cumulative editing.

### 2.7 Distraction-Free Reader Mode
- **B26**: Article URLs are fetched and parsed into clean HTML using Mozilla Readability algorithms, stripping ads, popups, and nested tables.
- **B27**: Reading mode offers 4 reader display themes: OLED Pitch Black (`#000000`), Warm Sepia Paper (`#1c1815`), Soft Slate Navy (`#0f172a`), and Clean Light Paper (`#fbfbfa`).
- **B28**: On tablets (Galaxy Tab S7+), touching the screen with an S-Pen stylus tip (`pointerType === 'pen'`) immediately creates text highlights, while finger contact (`pointerType === 'touch'`) scrolls smoothly.
- **B29**: Text highlights are rendered using the CSS Custom Highlight API and anchored via portable text-quote anchors, ensuring 100% byte-compatibility with the browser extension.

### 2.8 Cloud Backup & Synchronization
- **B30**: Google Drive sync writes exclusively to the hidden `appDataFolder`, storing annotations in `pages/page-<urlhash>.json` alongside frame and diagram media blobs.
- **B31**: When Google Drive is unconfigured, tapping the cloud icon opens a centered glassmorphic setup modal with 1-tap OAuth and automated backup switches.
- **B32**: Background sync automatically verifies and uploads dirty local state on a 5-minute periodic interval, upon exiting any study session, and whenever the application is minimized.
- **B33**: Conflicts are resolved using the 3-way merge engine (`core::merge`), ensuring that annotations from both the browser extension and mobile companion merge without data loss.

### 2.9 Offline Guarantees
- **B34**: All reading, video note creation, frame markup, local STT voice capture, and SQLite CRUD operations remain fully functional without internet access.
- **B35**: Cloud-dependent features (Groq transcription, Gemini voice edits, Drive sync) display subtle offline badges; pending sync operations queue locally and flush automatically when connectivity is restored.
