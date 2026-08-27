# Scholiast — Tauri App Implementation Plan

> A cross-platform lecture-notes companion built on **Tauri v2 + React + TypeScript + Rust**: timestamped, voice-first YouTube lecture note-taking, live transcript annotation, webpage reading/highlighting, frame capture & drawing, local offline Whisper STT, cloud AI (Groq/Gemini), and per-page Google Drive sync — byte-compatible with the existing Scholiast desktop extension and Obsidian companion plugin.

## 0. Document purpose

This is the single authority for the Tauri-based Scholiast app (targeting Linux Desktop and Android). It consolidates the full product spec: YouTube lecture note-taking, live transcript annotation, webpage reading/highlighting (Reader), frame capture & drawing, local offline Whisper STT, cloud AI (Groq/Gemini), and per-page Google Drive sync.

Work is orchestrated from `tauri-tasks/`.

---

## 1. Product overview

### 1.1 Goal

While watching a YouTube lecture, the user can:

1. Watch in an embedded IFrame-API player with Scholiast's own dark chrome (never YouTube's UI).
2. Follow a live-scrolling transcript docked beside the video; highlight spoken ranges; attach threaded comments.
3. Create timestamped notes; capture a video frame and draw/mark it up (pencil, highlighter, eraser, undo).
4. Add and edit comments **by voice** — Groq Whisper verbatim, Gemini prompt-directed edits, local whisper.cpp fully offline.
5. Read saved articles distraction-free (Reader), highlight and comment on them with the same anchor technology as the browser extension.
6. Keep everything synced to Google Drive in the exact per-page layout the desktop extension and Obsidian plugin already use (`pages/page-<urlhash>.json` + blob files), with 3-way merge so devices never lose data.
7. (v1.1) Chat with the lecture, OCR frame text, generate flashcards.

### 1.2 Platforms & persona

| Target | Engine | Status |
|---|---|---|
| **Linux desktop** (primary dev machine) | WebKitGTK 4.1 | v1 |
| Windows | WebView2 | v1 |
| macOS | WKWebView | v1 |
| Android | System WebView (Tauri v2 mobile) | post-v1 milestone (M7) |
| **Web companion** (≤10 users) | any browser, static host + local Rust server | post-v1 (M8) |

Persona: student watching lectures on a laptop/desktop; heavy keyboard+mouse use on desktop; voice remains the primary *text-input* method for comments (keyboard always available too — the tablet's "keyboard-less first" constraint becomes "voice-first typing" here).

### 1.3 Design principles

1. **Dark by default** — same token set as every Scholiast surface (`#000` bg, `#0B0D14` panels, purple accent).
2. **Voice-first text input** — mic button inside every comment field; keyboard is first-class on desktop (both icons side-by-side).
3. **Offline-aware** — local STT keeps voice working offline; cloud features dim with hints; sync queues and retries.
4. **Byte-compatible data** — same JSON schema, same Drive layout, same merge rules as the extension. Golden tests pin this.
5. **Strict domain ownership** (§3.2) — no piece of state lives in both React and Rust.

---

## 2. Locked decisions (carried from the Android Q&A + new-stack additions)

All decisions in `scholiast_mobile_app_plan.md` §2 remain binding **except** the rows replaced below:

| Area | Decision |
|---|---|
| App shell | **Tauri v2** (Rust core + system webview). Not Electron (memory), not Flutter (abandoned — see `flutter_conv_plan.md` history). |
| Frontend | **React 18 + TypeScript**, Vite, TanStack Query, Tailwind CSS v4 with the Scholiast token set as CSS variables |
| Backend | **Rust** workspace: `core` (pure domain), `server` (web-companion axum), `src-tauri` (command/event glue) |
| DB | **SQLite via `sqlx`** (compile-time-checked queries, async), single `scholiast.db` |
| Secrets | **`keyring` crate** (OS credential store: gnome-keyring / Windows Credential Manager / macOS Keychain) — Groq/Gemini keys, Drive refresh token |
| Config/prefs | **`tauri-plugin-store`** — the single KV JSON both languages read/write directly (§3.6) |
| Local STT | **`whisper-rs`** crate (whisper.cpp bindings), ACFT-quantized GGML models downloaded from keyboard.futo.tech with SHA-256 pinning (FUTO license: personal use; swap engine before public distribution) |
| Frame capture | **Native webview snapshot pipeline** (§6.7): pause video → engine snapshot cropped to the player rect → JPEG in Rust. No cross-origin canvas tricks — they are impossible in Tauri's security model. |
| Frame/comment drawing | **`@excalidraw/excalidraw`** React component for frame markup AND comment diagrams. Scene JSON persists byte-compatibly with the extension's `diagrams` map; baked PNG export replaces the old CustomPainter flow. |
| Reader extraction | HTTP fetch in Rust → **Readability in Rust** (`readability` crate) → sanitized HTML → rendered in React; highlighting uses the **CSS Custom Highlight API** exactly like the extension; anchors are the extension's text-quote algorithm **ported as TS** into the frontend (`shared/anchor.ts` + `fuzzy-match.ts` remain the golden sources) |
| Transcript transport | innertube client in **Rust** (`reqwest`, IOS→WEB fallback), parsed to cues in Rust, delivered to React as JSON over IPC; language picker + session memory in React |
| Voice capture | **Web Audio `getUserMedia`** in React (16 kHz mono PCM) streamed over IPC to Rust → WAV in temp dir → transcriber. Tap-to-toggle; video auto-pauses. No VAD. |
| Drive OAuth | **Authorization-code + PKCE with loopback redirect**: Rust spins a one-shot `127.0.0.1:<ephemeral>` listener; Google "Desktop" OAuth client allows arbitrary loopback ports — one flow covers all desktop targets (reuses the same client as the Firefox extension flow). Refresh token → keyring. |
| Prompts | User-editable in Settings → Speech; defaults ship with the app (Add-comment prompt, Edit-comment prompt — exact defaults in §6.5.6) |
| Accent color | Brand purple `#8B7CF6` fixed (desktop has no Material You); highlight hues stay data-fixed |
| Settings | Separate route/screen; the player screen stays clean |
| Session summary, TTS, Share-to-Samsung-Notes | Removed / out of scope (as before) |
| Handwriting | Out of scope |

---

## 3. Architecture

### 3.1 High-level view

```
┌────────────────────────────────────────────────────────────────────┐
│                        TAURI APP PROCESS                           │
│                                                                    │
│  ┌──────────────────────────────┐   ┌────────────────────────────┐ │
│  │      REACT FRONTEND          │   │        RUST BACKEND        │ │
│  │  (Vite build, TS strict)     │   │  tokio + tauri v2 runtime  │ │
│  ├──────────────────────────────┤   ├────────────────────────────┤ │
│  │ EPHEMERAL UI DOMAIN          │   │ PERSISTENT DATA DOMAIN     │ │
│  │ • Player state (time/state)  │◄─►│ • SQLite (sqlx)            │ │
│  │ • Transcript live-follow     │IPC│ • whisper-rs inference     │ │
│  │ • Excalidraw canvases        │   │ • Drive REST + OAuth PKCE  │ │
│  │ • Selection & highlight paint│   │ • innertube transcript     │ │
│  │ • Editor sheets, routing     │   │ • Groq/Gemini/Gemma HTTP   │ │
│  │ • Voice capture (getUserMedia│   │ • WAV encode, JPEG encode  │ │
│  │   → PCM stream over IPC)     │   │ • webview snapshot capture │ │
│  ├──────────────────────────────┤   │ • sync scheduler           │ │
│  │ TANSTACK QUERY CACHE         │   ├────────────────────────────┤ │
│  │ (lens over Rust data —       │   │ FILES                      │ │
│  │  never a second copy of      │   │  frames/<itemId>.jpg       │ │
│  │  truth)                      │   │  diagrams/<id>.png         │ │
│  ├──────────────────────────────┤   │  models/*.bin              │ │
│  │ tauri-plugin-store (KV)      │◄─►│  voice/*.wav (temp)        │ │
│  │ prefs: theme, prompts, model │   └────────────┬───────────────┘ │
│  └──────────────────────────────┘                ▼                 │
│                                    Google Drive appdata · Groq ·   │
│                                    Gemini · keyring · SQLite       │
└────────────────────────────────────────────────────────────────────┘
```

### 3.2 Domain ownership — the No-Overlap Rule (binding)

React owns **ephemeral UI state only**: playback position/state, transcript active-cue index, open menus/sheets, selection rectangles, Excalidraw in-progress scenes, form drafts.

Rust owns **all persistent state**: SQLite rows, image/model/temp files, tokens, the sync scheduler. React never holds arrays of saved notes/videos in component state — it renders whatever TanStack Query fetched, invalidated by Rust events.

Violations to watch for (call them out in reviews):
- Keeping `items[]` in a React reducer after mutation instead of invalidating the query.
- Writing prefs from Rust without emitting the store-change event (or vice versa).
- Passing whole page records around in React context "for convenience".

### 3.3 IPC contract style

- **Commands** (React → Rust, request/response): thin, typed wrappers in `src/lib/ipc.ts` generated/mirrored by hand from Rust command signatures. Naming: `snake_case` commands, camelCase TS helpers. Every command returns `Result<T, ScholiastError>` serialized as `{ ok, data | error }`.
- **Events** (Rust → React, push): `sync://progress`, `stt://partial`, `stt://final`, `store://changed`, `db://changed:<table>`. Payloads are plain JSON.
- **Streams** (high-frequency): Whisper partial hypotheses arrive as `stt://partial` events consumed straight into a ref-rendered div (dumb UI). Never routed through React state managers.

### 3.4 TanStack Query paradigm

Query keys mirror the DB: `['video', urlHash]`, `['videoItems', urlHash]`, `['pages']`, `['settings', key]`. Mutations call commands; on success the matching `db://changed:*` event (fired by Rust) triggers precise invalidation. Optimistic updates allowed only for comment edit/delete (with rollback), mirroring the extension's dashboard behavior.

### 3.5 Rust workspace layout

```
scholiast_tauri/
├── src-tauri/               # tauri app: command handlers, event emitters, state
│   ├── Cargo.toml           # bin crate "scholiast"
│   └── src/
│       ├── main.rs / lib.rs
│       ├── commands/        # mod.rs + one module per domain (player.rs, notes.rs,
│       │                    #  transcript.rs, stt.rs, drive.rs, reader.rs, settings.rs,
│       │                    #  capture.rs, diagrams.rs, home.rs)
│       ├── state.rs         # AppState { db pool, whisper handle, sync tx, … }
│       └── events.rs        # typed event emit helpers
├── crates/
│   ├── core/                # PURE domain, zero tauri/io deps where possible
│   │   └── src/{models.rs, normalize.rs, merge.rs, cue.rs, chunk.rs,
│   │           notes_markdown.rs, timefmt.rs, error.rs}
│   └── server/              # axum web-companion (M8): mirrors commands over WS/REST
├── src/                     # React app
│   ├── routes/              # Home, Player, Reader, Settings (+v1.1 Chat/Flashcards)
│   ├── components/          # SwatchPopup, TimestampChip, MicButton, CommentThread…
│   ├── player/              # PlayerHost (iframe api), Chrome, TranscriptPanel
│   ├── reader/              # ArticleView, highlight-paint (Highlight API), swatch
│   ├── frame/               # CaptureFlow, ExcalidrawMarkup, toolbar
│   ├── voice/               # recorder hook (getUserMedia→IPC), VoiceBubble, EditSheet
│   ├── lib/ipc.ts           # typed command wrappers + event listeners
│   ├── lib/store.ts         # tauri-plugin-store typed facade
│   └── styles/tokens.css    # design tokens (§7.1)
└── flatpak/                 # manifest (org.scholiast.Scholiast), metainfo
```

### 3.6 Shared Key-Value store (config)

`tauri-plugin-store` file `prefs.json` in app-data. Typed facade `lib/store.ts` on the JS side, `crate::settings` on the Rust side; both subscribe/listen to `store://changed`. Contents: theme flags, default speed, seek-step, speech language, model size choice, prompts (add/edit), last-session, transcript-language memory. **Keys live in the keyring, never in the store.**

### 3.7 Concurrency

- All commands `async`, heavy work on `tokio::spawn_blocking` / dedicated threads (whisper inference owns a worker thread with a cancel flag, mirroring `WhisperGGML.kt` semantics).
- SQLite: single sqlx pool, WAL mode. Frames/diagrams written atomically (temp + rename).
- Sync scheduler: tokio interval task + debounced change queue (per-page URLs), same shape as `sync-engine.ts`.

---

## 4. Technology matrix (Android-native → Tauri)

| Concern | Android native (reference) | Tauri app |
|---|---|---|
| Language/UI | Kotlin + Compose | TypeScript + React 18 (Tailwind v4 + tokens) |
| Shell/runtime | ART activity | Tauri v2 (wry: WebKitGTK / WebView2 / WKWebView) |
| State | ViewModel + StateFlow | TanStack Query cache + tiny ephemeral stores |
| Persistence | Room (`video_pages`,`ocr_texts`,`sync_meta`) | SQLite (sqlx): same logical tables + `pages`/`highlights`/`comments`/`drawings`/`diagrams` for Reader |
| Secrets | Keystore | `keyring` crate |
| Prefs | DataStore | `tauri-plugin-store` |
| Local STT | FUTO JNI whisper.cpp | `whisper-rs` (same GGML models/checksums) |
| Cloud AI | OkHttp clients | `reqwest` clients (Groq/OpenAI-compatible, Gemini) |
| Player | WebView + IFrame API + `@JavascriptInterface` | React `<iframe>` + IFrame API + `postMessage`-free direct API object (same event/command names) |
| Frame capture | JS `drawImage(video)` via universal-access WebView | Native snapshot backend per engine (§6.7) |
| Drawing | Custom `MarkupView` Canvas | `@excalidraw/excalidraw` (+ normalized-markup exporter for compat) |
| Transcript | Kotlin innertube/cue parser | Rust innertube/cue parser (`core::cue`), UI in React |
| Background work | WorkManager | tokio tasks + `tauri-plugin-*` autostart optional |
| Packaging | APK/AAB | NSIS installer / .dmg / **Flatpak (Linux)** / APK (later) |

---

## 5. Data model (repo-compatible)

### 5.1 Principle

The app writes the **exact JSON structures** the extension writes. `PageRecord` assembly happens in Rust (`core::models`) with serde field names pinned to the TS types. Golden tests compare Rust output byte-for-byte with committed fixtures (`shared/merge.test.ts` cases; fixture JSON reused from `flutter-tasks/../scholiast_flutter/test/fixtures/`).

### 5.2 SQLite schema (`scholiast.db`, WAL)

```sql
-- Videos & their items (mirror of Room video_pages, expanded for querying)
CREATE TABLE videos (
  url_hash TEXT PRIMARY KEY,          -- sha256-prefix, same scheme as repo
  url TEXT NOT NULL, video_id TEXT, title TEXT,
  resume_at REAL NOT NULL DEFAULT 0,  -- seconds
  updated_at INTEGER NOT NULL
);
CREATE TABLE video_items (
  id TEXT PRIMARY KEY,                -- genVideoId (base36 ts + rand), same generator
  url_hash TEXT NOT NULL REFERENCES videos(url_hash) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('frame','note','transcript')),
  video_time REAL NOT NULL, time_end REAL,
  frame_w INTEGER, frame_h INTEGER, frame_drive_id TEXT,  -- bytes live on disk
  markup_json TEXT,                   -- VideoMarkup | null (normalized 0..1 coords)
  anchor_json TEXT,                   -- TranscriptAnchor for transcript kind
  quote TEXT, color TEXT,             -- yellow|red|green|black
  ocr_text TEXT,
  notes_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

-- Reader pages & annotations (new; mirrors extension sharded stores)
CREATE TABLE pages (
  url_hash TEXT PRIMARY KEY, url TEXT NOT NULL, title TEXT,
  source_markdown TEXT,               -- captured readable body (immutable once synced)
  captured_at INTEGER, updated_at INTEGER NOT NULL
);
CREATE TABLE highlights (
  id TEXT PRIMARY KEY, url_hash TEXT NOT NULL REFERENCES pages(url_hash) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('text','element')),
  xpath TEXT, start_offset INTEGER, end_offset INTEGER,
  content TEXT NOT NULL, color TEXT NOT NULL,
  group_id TEXT, anchor_json TEXT,    -- portable text-quote anchor (shared/anchor.ts schema)
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE comments (
  id TEXT PRIMARY KEY,                -- inline timestamp-comment id (preserve!)
  highlight_id TEXT NOT NULL REFERENCES highlights(id) ON DELETE CASCADE,
  body TEXT NOT NULL, created_at INTEGER NOT NULL, edited_at INTEGER
);
CREATE TABLE drawings (
  stroke_id TEXT PRIMARY KEY, url_hash TEXT NOT NULL,
  color TEXT NOT NULL, width REAL NOT NULL, points_json TEXT NOT NULL,
  updated_at INTEGER
);
CREATE TABLE diagrams (
  id TEXT PRIMARY KEY,                -- diagram uuid (extension-compatible)
  page_url_hash TEXT, image_for_highlight TEXT, pasted INTEGER DEFAULT 0,
  scene_json TEXT, png_path TEXT, png_drive_id TEXT, scene_drive_id TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE tags ( tag TEXT PRIMARY KEY );   -- tag index (#autocomplete)

CREATE TABLE sync_meta (             -- pagemeta:<url>
  url_hash TEXT PRIMARY KEY, file_id TEXT, head_revision_id TEXT, last_synced INTEGER
);
CREATE TABLE sync_snapshots (        -- snap:<url>: last reconciled PageRecord JSON
  url_hash TEXT PRIMARY KEY, record_json TEXT NOT NULL
);
CREATE TABLE sync_queue ( url_hash TEXT PRIMARY KEY, enqueued_at INTEGER );
CREATE TABLE ocr_texts ( item_id TEXT PRIMARY KEY, text TEXT, created_at INTEGER );
```

Files (never inline bytes): `frames/<itemId>.jpg`, `diagrams/<id>.png`, `models/<name>.bin`, `voice/<session>.wav` (temp).

### 5.3 URL normalization & ids

Port `normalizeUrl`/`urlHash`/`extractVideoId`/`genVideoId` to `core::normalize` with the extension's exact behavior (strip fragment, `utm_*`, `fbclid`, `_ga`, YT `t`/`start`; SHA-256 prefix hash; base36-ts random id). Unit tests copied from the Dart/Kotlin ports.

### 5.4 Drive layout (unchanged)

`drive.appdata`: `pages/page-<urlhash>.json` (PageRecord v2), `frames/frame-<itemId>.jpg`, `diagrams/diagram-<id>.png` + `.scene.json`. Bookkeeping in `sync_meta` + `sync_snapshots`. `shared/pageFileName` logic lives in `core::normalize`.

---

## 6. Features — detailed behavior

(Section numbering intentionally tracks the Android plan so cross-referencing is easy.)

### 6.1 Entry & navigation

Routes (react-router): `/home`, `/player?url=…`, `/reader?url=…`, `/settings`, `/frame?url=&item=` (modal-style overlay route), `/chat`, `/flashcards` (v1.1). Desktop shell: persistent left sidebar (Home, Open link field, recent list, Settings gear at bottom) + content area; the sidebar doubles as the Reader's library rail later.

Entry points: paste/type URL (Home), OS share/deep-link (`scholiast://open?url=`) via tauri deep-link plugin, command-line arg (`scholiast <url>`) for launcher integration. Resume: videos table `resume_at` restores playback position on open.

### 6.2 Loading a video

URL → `extractVideoId` (watch?v=, youtu.be/, shorts/, live/) → upsert `videos` row → Player route mounts `PlayerHost` → `loadVideo(videoId)` → `onPlayerReady` enables panels. Invalid URL → toast; embedding-disabled → overlay message + transcript still loads (independent path).

### 6.3 Player screen

Landscape/desktop-wide: player left (fills), right panel fixed 38% (min 360px). Narrow: stacked. Free resize via CSS grid; fullscreen toggles the player region to fill the window.

Chrome (React overlay, never YouTube's): tap-anywhere toggles chrome; centered play/pause, seek bar, time display, −15s/+15s, speed menu (0.25–2×), volume, captions toggle, fullscreen, **Capture frame**, floating **＋ note**. All commands go through the same command names as Android (`seekTo/play/pause/setRate/setVolume/setCaptions/loadVideo/captureFrame`); events likewise (`onPlayerReady/onStateChange/onError/onTimeUpdate/onDuration/onTitle/onCaptionsAvailable/onCaptureResult`) so the bridge contract has one canonical description. `onTimeUpdate` polls `getCurrentTime()` at 250 ms into a ref + subscription store (not global state).

The player iframe is created **once** per app session and remounts by `loadVideo` only.

### 6.4 Note timeline & timestamped notes

Panel tabs: **Notes** / **Transcript** (transcript disabled when no captions). Notes tab: time-ordered item cards (frames, notes, transcript highlights) newest-last; `M:SS` chip seeks on click; color rail for transcript highlights; thread preview collapsed; delete with undo toast.

**＋ New note** captures `currentTime` → opens the comment editor sheet: textarea with light-markdown formatting buttons (bold/italic/link/bullet), `#tag` autocomplete (from `tags` table via command), **mic button** + **keyboard button** side-by-side (on desktop the keyboard icon focuses the field normally; on tablet builds later it summons the IME), timestamp chip (tap to seek), Save/Cancel. `Ctrl+Enter` saves. Draft survives Esc-with-confirm.

Comment rendering: port `video-notes.ts` markdown subset (bold/italic/links/bare urls/#tags/`<!--timestamp-->`/`<!--edited-->` IDs) to TS (`src/lib/noteMarkdown.ts`) — the SAME module the extension uses semantically; parse/render unit-tested against extension fixtures.

### 6.5 Voice input system

#### 6.5.1 Recorder
React hook `useVoiceRecorder`: `getUserMedia({audio})` → AudioWorklet downsamples to **16 kHz mono Int16** → chunks shipped over `invoke('stt_append_chunk', …)` to Rust which appends a growing WAV in `voice/`. UI: tap-to-toggle mic with pulsing ring + elapsed timer; swipe/Esc cancels; hard cap 120 s. Video auto-pauses on start, resumes after Save/Cancel. Permissions handled by the webview (prompt); Tauri macOS mic entitlement documented in build config.

#### 6.5.2 Add-comment (two branches — identical semantics to Android)
- Groq-only configured: WAV → `POST /openai/v1/audio/transcriptions` (`whisper-large-v3-turbo`, language pref) → verbatim draft insert.
- Gemini also configured: WAV bytes inline + **Add-comment prompt** → `generateContent` → response as draft.
- Neither: mic disabled + "Set up speech in Settings".

#### 6.5.3 Edit-existing-comment (Gemini voice-edit)
Sheet: original text, big mic, editable prompt (prefilled from Edit-comment prompt). Record → Gemini → **preview** below original → Accept / Discard / Retry. Accept stamps `<!--edited:N-->`. Without Gemini: disabled + toast.

#### 6.5.4 Local STT (offline)
`whisper-rs` with the same ACFT Q8_0 GGML models (`tiny_en` default, `base_en`/`small_en` offered) from keyboard.futo.tech, SHA-256 verified at download, stored in app-data `models/`. Worker thread pattern mirrors FUTO's `WhisperGGML`: single inference context, cooperative cancel flag, partial-segment callback → `stt://partial` events, language-bail detection. Offline: voice works locally; Gemini-dependent flows dim ("Needs internet").

#### 6.5.5 Transcriber trait

```rust
#[async_trait] pub trait Transcriber {
  async fn transcribe(&self, wav: &Path, language: Option<&str>, prompt: Option<&str>) -> Result<String>;
  fn capabilities(&self) -> Caps; // VERBATIM | PROMPTED
}
// GroqTranscriber (VERBATIM) · GeminiTranscriber (PROMPTED) · LocalWhisperTranscriber (VERBATIM, streaming partials)
```

#### 6.5.6 API settings (Settings → Speech — never on player)
Groq key, Gemini key, model-id fields (`whisper-large-v3-turbo`, `gemini-flash-latest`), Test connection buttons, speech language selector (default English; used by Groq + local STT), local-model manager (download/verify/delete, show active), and two prompt editors with defaults:

- *Add-comment*: “You are helping write study notes. Turn the user's speech into a clear, concise note, keeping technical terms and key facts. Output only the note text.”
- *Edit-comment*: “The user wants to modify their note below. Follow their spoken instructions, keep it concise, output only the revised note.”

### 6.6 Transcript panel

Fetch (Rust): `POST youtubei/v1/player` (IOS ctx → WEB fallback) → `captionTracks` → `pickTrack` (session choice → English non-ASR → first) → `baseUrl&fmt=json3` → parse cues → `semanticChunk` paragraphs. Delivered as JSON command result; cached per (videoId, lang) in-memory + disk.

UI (React): paragraph cards, `[M:SS]` seek pills, karaoke bold-white active cue, smooth follow (active line ~30% from top), language picker in header (>1 track), "No captions" empty state. Selection (mouse drag or click-selects-cue) floats the **SwatchPopup**: yellow/red/green + 💬. Highlight stores `kind:'transcript'` item with `anchor{startCue,startOffset,endCue,endOffset}` and `M:SS–M:SS` range; repainted inline on scroll/reopen; tap opens thread. Search box filters/jumps.

### 6.7 Frame capture & markup

#### 6.7.1 Capture pipeline (engine snapshots, not canvas)

Cross-origin iframe DOM is unreachable in Tauri's threat model — the Android universal-access trick does not exist here. Instead:

1. React pauses video (if playing) and sends `capture_frame { urlHash, rect }` — `rect` = player element's device-pixel bounding box.
2. Rust dispatches to the platform `CaptureBackend` trait:
   - **Linux/WebKitGTK:** `webview.with_webview(...)` → raw `WebKitWebView*` → force SW compositing is already set via `WEBKIT_DISABLE_COMPOSITING_MODE=1` (required — accelerated renderer yields black pixels, proven by our gate test) → `gtk_widget_draw` into a cairo ARGB32 surface → crop to rect.
   - **Windows/WebView2:** `CoreWebView2::CapturePreview` (PNG) → decode → crop.
   - **macOS/WKWebView:** `takeSnapshotWithConfiguration` → crop.
3. Black-frame detection (sample grid, same thresholds as extension). DRM/black → `{error:"black"}` → toast, resume playback.
4. Encode JPEG q80, downscale to ≤1280 px wide, save `frames/<itemId>.jpg`, return `{path,w,h}`.

Each backend is independently feature-gated and unit-spiraled in M4 (Linux first — it's the dev machine).

#### 6.7.2 Draw surface (Excalidraw)

Full-bleed `@excalidraw/excalidraw` seeded with the frame as an image element; dark UI theme; top bar Cancel / Save / 💬; bottom = Excalidraw's own toolbar (pencil/highlighter-equivalent styles, shapes, text, eraser, undo). Save exports the **baked composite PNG** (`exportToBlob`) → `diagrams/<id>.png`, scene JSON → `diagrams` row; the frame item gets `markup` regenerated as normalized `VideoMarkup` from simple freehand elements when possible (dashboard repaint compatibility), else the baked PNG stands in exactly like the extension's image-edits flow. Re-open edits the same scene (cumulative). Discard drops nothing (frame item only created on save — same no-orphan rule as the extension).

#### 6.7.3 Comment paths (unchanged four kinds)

| Path | Stored as | Frame saved | OCR |
|---|---|---|---|
| Frame + comment | `kind:'frame'` + notes | yes | yes (at save, v1.1 Gemma) |
| Frame edited + comment | `kind:'frame'`, baked PNG replaces | yes | yes |
| Timestamp note | `kind:'note'` | no | no |
| Transcript highlight | `kind:'transcript'` | no | no |

OCR (v1.1): frame JPEG → Gemini vision (Gemma-class model) → `ocr_texts` row + `ocrText` on item; async low-priority immediately after save.

### 6.8 Google Drive sync

OAuth: PKCE (S256), `redirect_uri=http://127.0.0.1:<ephemeral>` served by a one-shot Rust listener; consent page opens in the OS browser; code exchange → refresh token → keyring. Scopes: `drive.appdata`. Same Google Desktop OAuth client as the Firefox extension flow (ids injected at build from gitignored `oauth.local.json` / env, never committed).

Engine (port of `sync-engine.ts` + `google-drive.ts` + `shared/merge.ts` → `core::merge`, `drive` module):
- Per-page reconcile only; dirty queue in `sync_queue`; CAS on `headRevisionId`.
- Push: assemble `PageRecord` (videos+items+drawings+diagrams pointers) → upload missing blobs (frames/diagram png/scene) → PUT page JSON → update meta + snapshot.
- Pull/full: list `pages/*` (manifest) → skip unchanged via revision+fingerprint check → download → `merge_page_record` (newest-wins, tombstones, comment merge) → write-back + re-upload if changed → pull missing blobs.
- Triggers: app-start reconcile, 15-min interval, manual **Sync now**; offline-safe retries.
- Progress: `sync://progress {phase,done,total,title,url}` events → Settings card + Home chip (same UX as the extension settings).
- Golden tests: `merge_page_record` must reproduce TS outputs for the shared fixtures (reuse `test/fixtures/merge_page_record_*` from the Flutter port — same vectors).

Reader data rides the same `PageRecord` (`highlights[]`, `drawings[]`, `diagrams[]`, tombstones) — the extension's schema is already page-shaped; video fields simply stay empty on article pages.

### 6.9 Reader (webpage annotation)

1. **Capture**: Home "Add article" → URL → Rust fetches (reqwest, UA spoof, charset handling) → `readability` crate extracts title/byline/body HTML → sanitize (allowlist tags) → store `pages.source_markdown`(HTML body) immutable.
2. **Render**: Reader route displays sanitized article in a measured single column (serif body, Libre Caslon for quotes optional later), dark theme.
3. **Annotate**: mouse selection → SwatchPopup (same colors + 💬) → creates `text` highlight with **portable anchor** (`quote`, prefix/suffix, occurrence) computed by the TS port of `shared/anchor.ts` operating on the rendered DOM; paints via **CSS Custom Highlight API** (extension parity), XPath-first resolution then quote-fuzzy fallback (3-tier: exact → whitespace-insensitive → edit-distance, thresholds preserved).
4. **Comments**: side-panel thread (desktop) with the same editor components as video comments (mic included); recolor/delete-undo.
5. Reader highlights sync bidirectionally as `type:'text'` highlights — the Obsidian plugin and dashboard consume them unchanged.

### 6.10 Settings screen (separate route)

Groups: **Speech** (keys, models, prompts, language, local-model manager) · **Sync** (Drive connect/disconnect/status/progress/Sync-now/storage) · **Playback** (default speed, seek step) · **Appearance** (accent override, density; dark only) · **Data** (wipe local / wipe Drive — typed confirmation naming counts) · **About** (version, privacy note: what goes to Groq/Gemini/Drive). Destructive actions mirror the extension's guards.

### 6.11 Offline behavior

Same table as Android plan §5.10: typed notes/frames/local-STT/transcript-cache work offline; cloud STT/AI dimmed; sync queues.

### 6.12 v1.1

Chat-with-lecture (Gemini RAG over transcript+notes), flashcards (markdown export first, `.apkg` later), OCR-at-save activation (Gemma). Out: session summaries, TTS, handwriting, share-targets beyond deep-link.

---

## 7. UI design system

### 7.1 Tokens (CSS variables, `styles/tokens.css`)

Same values as every Scholiast surface: bg `#000000`, surface `#0B0D14`, elevated `#151824`, hairline `#232733`, text `#FFFFFF`/`#9AA0A6`/`#4A4F59`, accent `#8B7CF6`, highlights yellow `#F9E64D` / red `#FF5A5A` / green `#5FE3A0`, danger/success reuse red/green. Radius 12/16/8; min target 40px (desktop) / 48px (touch builds); tabular figures for timestamps; motion 150–250 ms ease-out with `prefers-reduced-motion` respected.

### 7.2 Styling approach

Tailwind v4 for utilities + a thin layer of named component classes (`.sc-card`, `.sc-chip`, `.sc-menu`…) defined from the tokens — the extension dashboard's "design system, not utility soup" rule, adapted. Icons: Material Symbols (self-hosted, same as dashboard). Fonts: Geist (chrome) self-hosted.

### 7.3 Components

`TimestampChip`, `ColorSwatch`/`SwatchPopup`, `MicButton` (+record states), `KeyboardButton`, `CommentEditorSheet`, `CommentThread`, `NoteCard`, `TranscriptLine`, `SyncStatusBar`, `ConfirmDialog` (typed wipe), `Toast` (own, bottom-center), `VoiceBubble`, `VoiceEditSheet`, `EmptyState`.

### 7.4 Screens

Home (open-link hero, recent grid with thumbnails+counts+resume, sync chip) · Player (§6.3) · Reader (§6.9) · FrameDraw (§6.7.2) · Settings (§6.10) · VoiceEdit sheet · (v1.1) Chat, Flashcards.

---

## 8. Build, packaging, testing

### 8.1 Toolchain

Rust stable (2021 edition), Tauri CLI v2, Node ≥20 + pnpm, Vite 5. Lints: `cargo clippy -D warnings`, `eslint`+`tsc --noEmit`+`prettier`. Formatting: `cargo fmt`, prettier.

### 8.2 Commands

Dev: `pnpm tauri dev`. Tests: `cargo test` (workspace), `pnpm vitest run`, `pnpm tauri build` for bundles. Linux package: `flatpak-builder` with manifest `flatpak/org.scholiast.Scholiast.yml` on `org.gnome.Platform//47` (runtime ships the GStreamer codec set WebKitGTK needs for YouTube — deterministic across distros, satisfying the mandatory-Flatpak strategy). Windows: NSIS via tauri build. macOS: .dmg + signing note.

Env requirements recorded for agents: `WEBKIT_DISABLE_COMPOSITING_MODE=1` is set programmatically at startup (before webview creation) on Linux; `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libsecret-1-dev` needed to compile.

### 8.3 Testing strategy

| Layer | Approach |
|---|---|
| Rust unit/golden | `core`: normalize cases, cue parser/chunker fixtures, **merge golden tests vs TS fixtures**, PageRecord serde round-trips, note-markdown (Rust-side parsing for sync) |
| TS unit (vitest) | noteMarkdown render/parse, anchor/fuzzy ports vs `shared/anchor.test.ts` vectors, ipc wrapper error mapping, store facade |
| Component (vitest+RTL) | editor sheet save/cancel, swatch popup, transcript selection→highlight, timeline ordering |
| Integration (Rust) | mockHTTP (wiremock) for Drive/Groq/Gemini/innertube; capture-backend black-frame detection with synthetic surfaces |
| E2E (manual first) | scripted checklist per milestone; `tauri-driver`/WebDriver exploration deferred until UI stabilizes |

Minimal-tests mandate from `AGENTS.md` §8.3 applies to all agents.

### 8.4 CI-ish local gates per task

Every task ends with: `cargo clippy -D warnings && cargo test -p scholiast-core` (domain tasks), `pnpm lint && pnpm vitest run` (frontend tasks), full `pnpm tauri dev` boot smoke for integration tasks.

---

## 9. Milestones

| M | Contents | Exit criteria |
|---|---|---|
| **M0** | Workspace scaffold, tokens/theme, routing/shell, Home skeleton, URL open → blank player route | `pnpm tauri dev` boots dark shell; sidebar nav works |
| **M1** | Player bridge + chrome + notes timeline + editor + SQLite CRUD | Add/save/seek/resume notes end-to-end |
| **M2** | Voice: recorder→WAV, Groq add-comment, Gemini edit flow, local whisper-rs streaming, prompts/settings | Speak-to-add & speak-to-edit; offline sane |
| **M3** | Transcript: innertube Rust client, parser/chunker, live-follow, selection→swatch→highlight→thread, language picker | Full transcript annotation |
| **M4** | Frame capture (Linux backend first) + Excalidraw markup + 4 comment paths + diagram persistence | Capture→draw→comment round-trip; scene reopen |
| **M5** | Drive: OAuth loopback PKCE, merge golden-green, per-page engine, progress UI | Two-client sync verified against extension data |
| **M6** | Reader: capture/readability, anchor port + Highlight API painting, threads, sync of highlights | Annotate an article; visible in extension dashboard |
| **M7** | Settings polish, data wipes, toasts/dialogs/a11y, Flatpak manifest + builds (Win/mac best-effort) | Release candidate bundles |
| **M8** (post-v1) | Android (Tauri mobile) + web companion (`server` crate) | Parity subsets |
| **v1.1** | OCR-at-save, chat, flashcards | Suite complete |

---

## 10. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Snapshot backends differ per engine | Capture quality varies | One `CaptureBackend` trait; Linux proven first (gate-test knowledge); black-frame detect common; per-backend spikes isolated in M4 |
| Wayland + offscreen GTK quirks | Blank captures on some compositors | SW-compositing env is engine-level, compositor-independent (validated); fallback `webkit_web_view_get_snapshot` path retained |
| WebKitGTK needs system GStreamer codecs | YouTube silent/black outside Flatpak | Ship Flatpak (GNOME runtime bundles codecs); document distro packages for bare-metal runs |
| Innertube drift | Transcripts break | IOS→WEB fallback + cached transcripts; isolated client; monitor |
| JSON/schema drift vs extension | Sync corruption | Serde rename-pinned structs; golden tests on shared fixtures; CI gate |
| whisper-rs build weight/time | Slow first build | Vendored cmake build cached; optional `local-stt` feature flag for quick iterations |
| FUTO license | Redistribution blocker | Personal-use now; swap-in sherpa-onnx behind the same `Transcriber` trait before publishing |
| OAuth review status for installed-app flow | Drive login blocked for new users | Loopback redirect = installed-app classification (no sensitive-scan requirement for drive.appdata testing); verification docs reused from `GOOGLE_VERIFICATION.md` |
| TanStack Query misuse duplicating state | Divergent UI truth | §3.2 rules enforced in review; `db://changed` events as the only invalidation trigger |
| Scope creep toward extension parity | Never ships | v1 = Android-feature-set + Reader; dashboard/Obsidian-sync stay extension-side |

---

## 11. Ported module map (sources → Tauri destinations)

| Source (repo) | Destination | Notes |
|---|---|---|
| `shared/merge.ts` | `crates/core/src/merge.rs` | Port + golden tests (fixtures reused) |
| `shared/anchor.ts`, `shared/fuzzy-match.ts` | `src/lib/anchor/` (TS port) | Operates on Reader DOM; keep vectors from `anchor.test.ts` |
| `src/utils/video-transcript.ts` | `crates/core/src/cue.rs` + `src-tauri/commands/transcript.rs` | innertube in Rust; drop DOM paths |
| `src/utils/video-storage.ts`, `video-notes.ts` | `core::models`, `src/lib/noteMarkdown.ts` | Field-name parity |
| `src/utils/video-markup.ts` | `core::models` (types) + Excalidraw exporter | Normalized coords preserved |
| `src/utils/frame-store.ts` | files + `video_items.frame_*` columns | Blobs never in JSON |
| `src/utils/google-drive.ts`, `sync-engine.ts` | `src-tauri/src/drive/`, `sync/` | Loopback PKCE replaces extension identity flows |
| `src/utils/highlighter.ts` normalizeUrl | `core::normalize` | Test vectors from Kotlin/Dart ports |
| `android/…/CueParser.kt`, `Chunker.kt`, `AnchorKt`, `MergePageRecord.kt` | same destinations | Reference implementations for edge cases |
| `assets/player.html` (flutter/android) | `src/player/PlayerHost.tsx` | Contract identical; page becomes a React component |
| FUTO model URLs/checksums (`Models.kt`) | `src-tauri/src/stt/models.rs` | Same endpoints + SHA-256 pins |
| Extension dashboard tokens (`_dashboard.scss`) | `styles/tokens.css` | Values copied verbatim |

---

## 12. Orchestration

Task board: `tauri-tasks/` (mirrors `android-tasks/` numbering 01–20 plus Reader 23–32). Waves, logging protocol, file-ownership rules and the resume playbook follow `AGENTS.md` §8 verbatim. Build/test/install commands per task are printed in each `task.md`.
