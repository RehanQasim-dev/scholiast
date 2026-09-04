# Technical Spec: Scholiast Tauri Companion App Architecture

## 1. System Architecture

The companion app is built on **Tauri v2 + React 18 + Rust** with a strict separation between persistent backend state and ephemeral frontend state.

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        TAURI APPLICATION PROCESS                           │
│                                                                            │
│  ┌───────────────────────────────┐      ┌────────────────────────────────┐ │
│  │   REACT 18 FRONTEND (Vite)    │      │    RUST BACKEND (Tauri v2)     │ │
│  ├───────────────────────────────┤      ├────────────────────────────────┤ │
│  │ EPHEMERAL UI STATE            │      │ PERSISTENT DATA STATE          │ │
│  │ • Player playback position    │      │ • SQLite database (sqlx, WAL)  │ │
│  │ • Active transcript cue       │◄────►│ • Local Whisper STT worker     │ │
│  │ • Excalidraw active scene     │ IPC  │ • Google Drive REST + PKCE     │ │
│  │ • Reader CSS Custom Highlight │      │ • Native webview frame snapshot│ │
│  │ • Web Audio 16kHz PCM stream  │      │ • Background sync scheduler    │ │
│  ├───────────────────────────────┤      ├────────────────────────────────┤ │
│  │ TANSTACK QUERY CACHE          │      │ LOCAL FILE STORAGE             │ │
│  │ • Invalidation lens over DB   │      │ • frames/<itemId>.jpg          │ │
│  │ • Subscribed to db:// events  │      │ • diagrams/<id>.png            │ │
│  │ • Zero local state duplication│      │ • models/<name>.bin (GGML)     │ │
│  └───────────────────────────────┘      └────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Strict Domain Ownership (The No-Overlap Rule)

- **React Owns Ephemeral UI State Only**: Playback time, transcript live-follow indices, open sheets/menus, active pointer gestures, and unsaved Excalidraw drafts. React **never** holds arrays of saved notes, videos, or highlights in global component state.
- **Rust Owns All Persistent State**: SQLite tables, file I/O (frames, diagrams, audio files, Whisper GGML models), OS credentials via the `keyring` crate, and the background sync scheduler.
- **Data Invalidation Contract**: React reads persistent state exclusively through TanStack Query queries. When mutations occur, Rust emits targeted push events (`db://changed:<table>`), triggering TanStack Query cache invalidations.

---

## 3. Technology Stack & Workspace Structure

### 3.1 Technology Matrix
- **Runtime**: Tauri v2 (`wry` webview: WebKitGTK 4.1 on Linux, WebView2 on Windows, WKWebView on macOS, Android System WebView).
- **Backend**: Rust 2021 Edition, Tokio async runtime.
- **Frontend**: React 18, TypeScript (strict), Vite 5, Tailwind CSS v4 with custom token variables.
- **Database**: SQLite 3 via `sqlx` (async, compile-time verified queries, WAL mode).
- **Local STT**: `whisper-rs` (C++ `whisper.cpp` bindings compiled with `-O3 -DNDEBUG`).
- **Cloud AI / HTTP**: `reqwest` (Groq, Gemini, YouTube innertube API).
- **Key-Value Config**: `tauri-plugin-store` for `prefs.json`; secrets live strictly in OS keyring.

### 3.2 Workspace Directory Layout
- `crates/core/`: Pure Rust domain models, URL normalization, cue parsing, text chunking, and 3-way merge logic. Zero Tauri or UI dependencies.
- `crates/server/`: Headless local Axum server for companion sync and browser bridging.
- `src-tauri/`: Tauri v2 application container:
  - `src-tauri/src/commands/`: Domain command handlers (`player.rs`, `notes.rs`, `transcript.rs`, `stt.rs`, `drive.rs`, `reader.rs`, `capture.rs`).
  - `src-tauri/src/state.rs`: Managed application state (`AppState`: DB pool, Whisper worker handle, sync channels).
  - `src-tauri/src/events.rs`: Strongly-typed IPC push event helpers.
- `src/`: React frontend application:
  - `src/routes/`: Top-level views (`Home`, `Player`, `Reader`, `Settings`, `FrameDraw`).
  - `src/player/`: Embedded video host, dark chrome controls, transcript panel.
  - `src/reader/`: Distraction-free article view, CSS Custom Highlight API paint, selection swatch.
  - `src/voice/`: Web Audio recorder hooks, Dynamic Aura visualizer, voice edit sheet.
  - `src/lib/ipc.ts`: Strongly typed command wrappers and event listeners.
  - `src/styles/tokens.css`: Design system CSS variables.

---

## 4. SQLite Database Schema (`scholiast.db`)

The database uses Write-Ahead Logging (WAL) and foreign-key cascade deletes.

```sql
CREATE TABLE videos (
  url_hash TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  video_id TEXT,
  title TEXT,
  resume_at REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE video_items (
  id TEXT PRIMARY KEY,
  url_hash TEXT NOT NULL REFERENCES videos(url_hash) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('frame', 'note', 'transcript')),
  video_time REAL NOT NULL,
  time_end REAL,
  frame_w INTEGER,
  frame_h INTEGER,
  frame_drive_id TEXT,
  markup_json TEXT,
  anchor_json TEXT,
  quote TEXT,
  color TEXT,
  ocr_text TEXT,
  notes_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE pages (
  url_hash TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT,
  source_markdown TEXT,
  captured_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE highlights (
  id TEXT PRIMARY KEY,
  url_hash TEXT NOT NULL REFERENCES pages(url_hash) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('text', 'element')),
  xpath TEXT,
  start_offset INTEGER,
  end_offset INTEGER,
  content TEXT NOT NULL,
  color TEXT NOT NULL,
  group_id TEXT,
  anchor_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  highlight_id TEXT NOT NULL REFERENCES highlights(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  edited_at INTEGER
);

CREATE TABLE drawings (
  stroke_id TEXT PRIMARY KEY,
  url_hash TEXT NOT NULL,
  color TEXT NOT NULL,
  width REAL NOT NULL,
  points_json TEXT NOT NULL,
  updated_at INTEGER
);

CREATE TABLE diagrams (
  id TEXT PRIMARY KEY,
  page_url_hash TEXT,
  image_for_highlight TEXT,
  pasted INTEGER DEFAULT 0,
  scene_json TEXT,
  png_path TEXT,
  png_drive_id TEXT,
  scene_drive_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sync_meta (
  url_hash TEXT PRIMARY KEY,
  file_id TEXT,
  head_revision_id TEXT,
  last_synced INTEGER
);

CREATE TABLE sync_snapshots (
  url_hash TEXT PRIMARY KEY,
  record_json TEXT NOT NULL
);

CREATE TABLE sync_queue (
  url_hash TEXT PRIMARY KEY,
  enqueued_at INTEGER
);

CREATE TABLE tags ( tag TEXT PRIMARY KEY );
CREATE TABLE ocr_texts ( item_id TEXT PRIMARY KEY, text TEXT, created_at INTEGER );
```

---

## 5. Native Frame Capture Pipeline

Because cross-origin iframes prevent canvas access under modern web security models, Scholiast uses native engine snapshot pipelines:

```
Video Playing ──► React pauses video ──► invoke('capture_frame', { rect })
                                                 │
                                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   PLATFORM CAPTURE BACKEND TRAIT                       │
│                                                                        │
│ • Linux (WebKitGTK): WEBKIT_DISABLE_COMPOSITING_MODE=1 + cairo surface │
│ • Windows (WebView2): CoreWebView2::CapturePreview PNG snapshot        │
│ • macOS (WKWebView): takeSnapshotWithConfiguration                     │
│ • Android (System WebView): View::draw into Bitmap canvas              │
└────────────────────────────────────────────────────────────────────────┘
                                                 │
                                                 ▼
               Black-frame verification (grid sample detection)
                                                 │
                                                 ▼
               Encode JPEG (quality 80, width <= 1280px)
                                                 │
                                                 ▼
         Save to disk: frames/<itemId>.jpg ──► Return { path, w, h }
```

---

## 6. Whisper STT & Hardware Acceleration

### 6.1 Compiler Optimizations (`-O3`)
- `whisper-rs-sys` compiles `whisper.cpp` via CMake in `Release` mode with `-O3 -DNDEBUG` flags.
- In `Cargo.toml`, `[profile.dev.package.whisper-rs-sys]` and `[profile.dev.package.whisper-rs]` are forced to `opt-level = 3` so development runs have zero STT performance degradation.

### 6.2 Hardware Vector Acceleration
- **ARMv8 / Android (`arm64-v8a`)**:
  - **ARM NEON**: Enabled by default (`GGML_CPU_AARCH64=ON`).
  - **FP16 vector arithmetic**: Enabled on ARMv8.2-A architectures for fast half-precision matrix calculation.
- **x86_64 (Linux Desktop & Laptops)**:
  - **AVX / AVX2 / FMA / F16C**: High-throughput SIMD vector operations across modern Intel and AMD CPUs.

### 6.3 Local Speech Pipeline
1. Web Audio `getUserMedia` captures 16 kHz mono Int16 PCM.
2. Chunks are transferred over IPC to a dedicated Whisper worker thread with cooperative cancellation.
3. Quantized GGML models (FUTO ACFT Q8_0: `tiny_en`, `base_en`, `small_en`) are verified against committed SHA-256 checksums before loading.
4. Intermediate hypotheses stream to the UI via `stt://partial` push events.

---

## 7. Mandatory Release Target Architectures

All release builds must compile **EXCLUSIVELY** for these 4 target architectures:

| Target Name | Architecture | Platform | Target Triple |
|---|---|---|---|
| **`arm64-v8a`** | ARMv8 64-bit | Android APK | `aarch64-linux-android` |
| **`armeabi-v7a`** | ARMv7 32-bit | Legacy Android APK | `armv7-linux-androideabi` |
| **`x86_64`** (Android) | x86_64 | Waydroid / Android Emulator | `x86_64-linux-android` |
| **`.deb`** | x86_64 | Linux Desktop / Laptops | `x86_64-unknown-linux-gnu` |

*No other target ABIs (such as 32-bit x86 Android) are permitted, avoiding packaging bloat.*

---

## 8. Google Drive Sync & Three-Way Merge Engine

- **OAuth 2.0 PKCE Flow**: Runs a one-shot ephemeral loopback listener on `127.0.0.1:<port>`. Refresh tokens are securely saved to the OS keyring.
- **Sandboxed Directory**: Sync writes to `drive.appdata/pages/page-<urlhash>.json` with media assets in `frames/` and `diagrams/`.
- **Three-Way Merge Protocol (`core::merge`)**:
  - Compares: `BaseSnapshot` (snapshot table), `LocalRecord` (SQLite), `RemoteRecord` (Drive).
  - Page attributes and highlights resolve via newest-wins timestamps.
  - Comment threads merge union-style to prevent lost replies.
  - Explicit tombstones (`deleted_at`) ensure deletions propagate without resurrection.
- **Background Auto-Sync**: Scheduled automatically on 5-minute intervals, upon exiting study routes (`/player`, `/reader`), and when the app is minimized (`document.visibilityState === 'hidden'`).
