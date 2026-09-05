# AGENTS.md — scholiast_tauri

Conventions and hard rules for every agent working in `scholiast_tauri/`. The modular feature specifications
(`../specs/tauri-*/` and shared specs `../specs/google-drive-sync/`, `../specs/portable-anchoring/`) are the authorities;
the feature task boards (`../specs/<feature-slug>/tasks/`) track execution.

## Domain ownership — the No-Overlap Rule (plan §3.2, binding)

React owns **ephemeral UI state only**: playback position/state, transcript active-cue index,
open menus/sheets, selection rectangles, Excalidraw in-progress scenes, form drafts.

Rust owns **all persistent state**: SQLite rows, image/model/temp files, tokens, the sync
scheduler. React never holds arrays of saved notes/videos in component state — it renders
whatever TanStack Query fetched, invalidated by Rust events.

Violations to watch for (call them out in reviews):

- Keeping `items[]` in a React reducer after mutation instead of invalidating the query.
- Writing prefs from Rust without emitting the store-change event (or vice versa).
- Passing whole page records around in React context "for convenience".

## File ownership

Each task's `task.md` lists its owned files. **Do not edit files owned by another task** —
if integration into a shared file (e.g. this scaffold's `lib.rs`, `tokens.css`, root Cargo
manifests) is needed, note it in your LOG.md and let the orchestrator/integration task do it.
Feature screens live under `src/routes/`, `src/player/`, `src/reader/`, `src/frame/`,
`src/voice/`, `src/components/`; domain logic under `crates/core/src/` (pure), commands under
`src-tauri/src/commands/`.

## Commands (run from `scholiast_tauri/`)

| Command | Purpose |
|---|---|
| `pnpm dev` | Vite dev server (port 1420, strict) |
| `pnpm tauri dev` | Full desktop app in dev mode |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` (strict) |
| `pnpm vitest run` | Frontend tests |
| `cargo check` | Rust type-check + `unused`/`dead_code` deny (low-cost, no codegen — **always run after Rust changes and fix before commit**). Host check alone compiles the Linux `cfg` only: also run the 3 Android-target checks in `../docs/guides/build-and-release.md` (§ Pre-CI Local Gates) |
| `cargo clippy -- -D warnings` | Rust lint gate (workspace root, pedantic = warn) |
| `cargo test` | Rust tests (workspace root) |
| `pnpm tauri build --debug` | Bundle (deb target on Linux) |

Per-task gates: frontend tasks run lint + typecheck + vitest; Rust/domain tasks run `cargo check` + clippy +
test; integration tasks also smoke-boot `pnpm tauri dev`. **After every Rust change, `cargo check` is mandatory — it is the workspace-wide `unused`/`dead_code` deny gate and is cached ~0.9s vs full `cargo build`.**

Workspace lint: `Cargo.toml:36` `[workspace.lints.rust] unused = "deny", dead_code = "deny"` (plus `clippy::pedantic = warn`) is inherited by every crate via `[lints] workspace = true` (`src-tauri/Cargo.toml:66`, `crates/core/Cargo.toml:13`, `crates/server/Cargo.toml:10`). Do not add `#[allow(unused)]`/`dead_code` without task justification.

## Environment notes

- Linux needs `libwebkit2gtk-4.1-dev`, `libgtk-3-dev` to compile.
- `WEBKIT_DISABLE_COMPOSITING_MODE=1` is set programmatically in `src-tauri/src/lib.rs`
  before any webview/window creation — keep it there.
- pnpm 11: build-script allowlist lives in `pnpm-workspace.yaml` under `allowBuilds`
  (esbuild is already allowed). `.npmrc` is auth/registry only.

## Style

- TypeScript strict, no unused vars; Tailwind v4 utilities over the token variables in
  `src/styles/tokens.css` (never hardcode hex values that a token already covers).
- No code comments unless essential; match surrounding style.
- Minimal tests only — the most necessary ones, no test-suite growth for its own sake.
- **Never run tests without a reason**: Do not run test suites (`cargo test`, `pnpm vitest`, etc.) casually or without an explicit reason or necessity. Running tests consumes heavy time and resources; only run minimal, targeted tests when specifically verifying changes.
- Never commit secrets (`*.local.json` is gitignored); OAuth client values stay out of git.
- IPC contract style (plan §3.3): `snake_case` Rust commands, camelCase TS wrappers, every
  command returns `Result<T, ScholiastError>` serialized as `{ ok, data | error }`.

## Release Target Architectures (MANDATORY — ONLY THESE 4)
In any release or distribution build for the application, **always compile ONLY these 4 targets**:
1. **`arm64-v8a`** (ARMv8 64-bit Android APK, target `aarch64-linux-android`): For modern Android devices including Google Pixel 6 Pro, Samsung Galaxy Tab S7+, etc.
2. **`armeabi-v7a`** (ARMv7 32-bit Android APK, target `armv7-linux-androideabi`): For legacy 32-bit ARM devices.
3. **`x86_64`** (x86 64-bit Android APK, target `x86_64-linux-android`): For Waydroid containers and desktop Android emulators.
4. **`.deb`** (x86_64 Linux desktop package, target `x86_64-unknown-linux-gnu`): For Linux laptops and desktop machines.

Do NOT build any other ABIs (such as 32-bit x86 Android or unused targets) to prevent build bloat and unnecessary packaging time.

## Whisper STT Optimization & Hardware Acceleration
- **Compiler Optimizations (`-O3`)**:
  - `whisper-rs-sys` compiles `whisper.cpp` using CMake in `Release` mode (`-O3 -DNDEBUG`), ensuring all C/C++ matrix and attention loops run with full compiler vectorization.
  - In `Cargo.toml`, `[profile.dev.package.whisper-rs-sys]` and `[profile.dev.package.whisper-rs]` are set to `opt-level = 3` so even in dev builds, Whisper runs at full optimized speed.
- **Target Hardware Acceleration Units**:
  - **ARMv8 / Android (Pixel 6 Pro, Galaxy Tab S7+)**:
    - **ARM NEON**: Mandatory and active by default on `arm64-v8a` (`GGML_CPU_AARCH64=ON`).
    - **FP16 vector arithmetic**: Enabled on ARMv8.2-A architectures (Cortex-X1, Kryo 585) for fast half-precision matrix math.
  - **x86_64 (Linux Desktop & Laptops)**:
    - **AVX / AVX2 / FMA / F16C**: Enabled for high-throughput SIMD vector processing across Intel Core and AMD Ryzen laptop CPUs.

## 11.5 Shipped Touch, Voice, Cloud & Drawing Features
- **Reader Margin-Anchored Comment Cards (replaces side panel, wide screens)**:  - Extracted Reader mode at >900px shows extension-style collapsed cards (3-line quote clamp) anchored beside their source line in the article's own scroll container — no nested panel scroll. Click expands thread + inline reply; page/another-card click collapses.
  - Near-invisible full-height splitter resizes the card column page-wide (`reader.margin_width` pref, default 340 / min 220 / max 45% viewport); double-click resets. Existing annotations toggle hides the column. Phones keep the bottom sheet; web mode keeps ThreadPanel (batch 2).- **Cloud Backup Centered Modal & Background Scheduler**:
  - Tapping the `[ ☁️ ]` cloud icon when Google Drive is unconfigured triggers a centered glassmorphic setup modal (`CloudSyncModal.tsx`) with 1-tap OAuth and automated backup preference switches.
  - Background scheduler (`useAutoSyncScheduler.ts`) checks for dirty highlights and drawings on a 5-minute periodic interval, upon exiting any study session (`/player` or `/reader`), and when the app is minimized (`document.visibilityState === 'hidden'`).
- **Dynamic Aura Voice Pill & Highlight Selection Swatch**:
  - Swatch popup features exactly 3 extension highlight colors (`yellow` `#d29600`, `red` `#dc3c5a`, `green` `#2da05f`) and 3 custom SVG actions: Text Comment (`CommentTextIcon`), Voice Note (`CommentMicIcon`), and Excalidraw Diagram (`ShapesDiagramIcon`).
  - Tapping Voice Note launches the `DynamicAuraPill.tsx`: 4 vertical glowing green frequency bars bounce to live voice amplitude via Web Audio API (`AnalyserNode`), 2.0s silence VAD auto-commits without confirmation dialog, transcribes at `-O3`, and saves directly to SQLite with a 2-second Undo toast.
- **Reader Display Themes**:
  - Reader top bar formatting popover (`ReaderTopBar.tsx`) provides 4 instant themes: OLED Pitch Black (`#000000`), Warm Sepia Paper (`#1c1815`), Soft Slate Navy (`#0f172a`), and Clean Light Paper (`#fbfbfa`), saved in `reader.theme` preferences.
- **Dedicated Excalidraw & Stylus Settings**:
  - Embedded inside `Settings.tsx` (`ExcalidrawSettingsSection.tsx`) exposing stroke roughness (Architect/Artist/Cartoonist), S-Pen & stylus pressure sensitivity curves (Linear/Soft/Firm), background grid styles (Blank/Dots/Crosshatch), and high-DPI export resolution (1x/2x Retina/3x).
- **Desktop Video Playback (Loopback Server)**:
  - Rust loopback HTTP server (`player_server.rs`) bound to `127.0.0.1:<random-port>` serves `/player` with `Referrer-Policy: strict-origin-when-cross-origin`. Overcomes WebKit2GTK / custom protocol missing referrer restrictions (YouTube Error 153) and relays postMessage events to `PlayerHost.tsx`.
- **Neutral Dark Canvas & Refined Accents**:
  - `tokens.css` utilizes neutral obsidian/zinc foundation (`#090b0d`, `#111417`, `#f4f4f5`) with emerald green reserved strictly for active accents, state indicators, and focus rings, eliminating low-contrast green text/backgrounds across desktop and tablet surfaces.
- **Simplified Local STT Model Management**:
  - Model Manager provides two options: "Explore Models" (opens external Hugging Face / ggml repository in default browser) and "Import Model" (native file picker importing existing `.bin`/`.gguf` files into local whisper model store).
- **Surface-Adaptive Video Annotation Ergonomics**:
  - **Desktop**: Eliminates legacy bottom chat bar and helper strips. Full-width in-situ card inserted chronologically (`N` pauses and captures `wasPlaying`, `Space` toggles play/pause, `S` captures frame, `T` toggles transcript). Textarea auto-expands up to 5 lines; `Enter` creates a newline; `Shift+Enter`/`Ctrl+Enter` saves note and resumes playback; `Esc` cancels and resumes. Dynamic Save button sits inline for single-line notes and shifts below for multi-line notes. Discrete `+` header button serves mouse users.
  - **Mobile Phone (`isNarrow && !isTablet`)**: Stacked portrait layout (top 40% video, bottom 60% notes). Clean 3-button bottom bar (`[Voice Note]`, `[Frame Capture]`, `[Type Note]`). Tapping Voice Note morphs bar into live wave visualizer with timer and Stop; tapping Stop shows transcribed text preview with Save/Cancel, unfocused to prevent virtual keyboard pop-up.
  - **Tablet (`isTablet`)**: Vertical right edge dock (~48px) with Notes/Transcript toggles, `+` type note, frame snapshot, and voice note with in-dock wave animation. Tapping stop opens right-anchored floating popover with editable text (unfocused) and Save.
- **Share-Target Intake (Android ACTION_SEND)**:
  - The deep-link plugin only sees `ACTION_VIEW`, so YouTube/Chrome shares arrive via `tauri-plugin-mobile-sharetarget` (Rust queue + `capabilities/mobile.json` permission), drained in `lib/deepLink.ts` on launch and every `tauri://focus`. The older `MainActivity.forwardShareIntent` VIEW-rewrite is kept as a second path; `navigateOnce` dedupes the double delivery in JS.
  - `MainActivity.kt` is hand-maintained (tracked in `gen/android`, not pristine codegen): edge-to-edge insets, clipboard bridge, share forward, selection menu suppression. Re-verify it after any `tauri android init` regen.
- **OS Selection Toolbar Suppression (Android)**:
  - Suppression is two-layered because WebView populates the selection menu asynchronously *after* the mode starts — a one-time clear loses to late repopulation. Primary: `WebView.setCustomSelectionActionModeCallback` in `onWebViewCreate` strips the menu in `onPrepareActionMode` (runs after population, on every show/invalidate). Backup: `MainActivity.onActionModeStarted` clears once. Selection + handles are preserved (Android 6+ skips empty floating menus). Selections inside inputs/textareas/contenteditables keep the system menu: `lib/selectionBridge.ts` classifies every `selectionchange` (shared `EDITABLE_SELECTOR` const) and reports via the `AndroidSelection` JS bridge; the live-page iframe reports synchronously from its own injected script (`getScholiastIframeScript`, covered by `iframeSelection.test.ts`) instead of relying on the parent postMessage round-trip.
  - Do NOT return null from `onWindowStartingActionMode` (tried before — it only declines a custom mode; the default toolbar still builds), do NOT `mode.finish()` (kills the selection), and do NOT return false from the custom callback's `onCreateActionMode` (same kill).
- **Reader Sheet Swipe Zone**: bottom edge swipe-up opens the annotations sheet only from a slim ~45px strip (`innerHeight - 90` to `innerHeight - 45`, above the OS nav zone) to stop accidental opens mid-article.
- **Player Chrome Top Bar (YouTube-style)**: back arrow + video title overlay the video top in a gradient bar, shown/hidden together with the bottom chrome on stage tap. No safe-area top padding anywhere in Player — MainActivity already offsets content below the status bar.
- **Voice STT Engine-vs-Model Split**: `list_stt_models` (ungated) only proves model *files* exist; the whisper engine lives behind `--features local-stt`, and default dev builds omit it. `stt_local_engine_available` (ungated, `cfg!`) is the source of truth — `useVoiceComment` treats local as ready only when both hold, disables with "rebuild app with local-stt" instead of failing at transcribe time, and never silently cloud-falls-back an explicit `local:` choice. Transcription-failure toasts must keep the backend reason (`voiceFailureMessage`).
- **Swatch Voice Flow (reader selection menu)**: tap mic morphs the strip into a live wave bar (tap again to stop) → transcribe shimmer → review popup (edit + Save/Cancel/Re-record). Start/transcribe failures render inline with their reason and a Back way out — never a vanishing toast. Replaces DynamicAuraPill (deleted) in the swatch; player phone/tablet keep their own voice UIs.
- **Release builds always ship the local-STT engine**: CI `tauri android build` and `tauri build` (deb) both run with `--features local-stt` (same in `docs/guides/build-and-release.md`) — an engine-less release lets installed models report ready and fail every transcription.
