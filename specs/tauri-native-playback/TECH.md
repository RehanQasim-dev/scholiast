# Technical Spec: Tauri Native YouTube Playback

## Context

The player embeds YouTube's iframe (`controls: 0`, `modestbranding`), whose
pause title/channel overlay and hover watermark have no API switch (showinfo
retired) and are unreachable cross-origin — hence the pause shields in
`Chrome.tsx`. The spike proved the alternative end-to-end with `youtubei.js`
v18 (npm, MIT, weekly ~173k): VISIONOS client returns URL-bearing adaptive
formats where ANDROID/WEB return cipherless ones; `node:vm` evaluates the
extracted sig+n snippet; direct timedtext fetch returns real VTT.

Key files @ 5bdd65c:
- `scholiast_tauri/src/player/PlayerHost.tsx` — iframe construct + playerVars
- `scholiast_tauri/src/player/playerBridge.ts` — YT API command/event surface
- `scholiast_tauri/src/player/Chrome.tsx` — overlay chrome + pause shields
- `scholiast_tauri/src/routes/Player.tsx` — shortcuts, composers, study tabs
- `scholiast_tauri/src-tauri/src/transcript/client.rs` — InnerTube POST pattern
  (IOS client, wiremock-tested) to mirror for the player endpoint
- `scholiast_tauri/src-tauri/src/capture/linux_webkit.rs` — WebKit harvest
  (frame-capture fallback if canvas CORS taints)

## Decisions (binding)

- **D1 — youtubei.js v18 for extraction (PIVOT).** The TS engine runs in
  the frontend (`src/player/youtubeEngine.ts`): VISIONOS resolve, webview
  function-evaluation shim, caption tracks — externally maintained, bump on
  rotation. The Rust `yt/` core from batch 1 stays in-tree, tested but
  uncalled: fallback candidate for batch 3 (notably if webview CORS ever
  blocks MSE range fetches, Rust becomes the byte-fetcher).
- **D2 — boa_engine 0.22 for sig+n evaluation** (pure Rust: builds for all 4
  release targets. rquickjs 0.12 was tried first and dropped — its prebuilt
  bindings miss `aarch64-linux-android`, and the `bindgen` fallback needs
  host libclang; see task 01 LOG).
- **D3 — VISIONOS for streams, existing IOS transcript path untouched.**
  Metadata (title/author) may ride the same response; WEB only if needed.
- **D4 — Playback: progressive-first, MSE adaptive for HD.** `<video>` src =
  muxed progressive where offered; else MediaSource with two   SourceBuffers
  (video+audio init segments from `init_range`, media via Range fetches).
  No new player dependency; live uses HLS manifest URL (add hls.js only if
  the target WebViews lack native HLS — verify on Linux + Android first).
- **D5 — playerBridge keeps its command/event shape** (`seekTo`, `play`,
  `pause`, `onTimeUpdate`, …) with a native backend behind it; `Player.tsx`
  and study flows change minimally. New: `resolveStream` + `fallback` events.
- **D6 — Frame capture tries canvas first**, falls back to the WebKit harvest
  on CORS taint (googlevideo range responses and ACAO headers unverified).
- **D7 — iframe remains as automatic fallback** (batch 3) behind per-failure
  classification; shields stay for fallback mode.

## Module Seams (batch 1: `src-tauri/src/yt/`)

- `yt/client.rs` — VISIONOS `POST youtubei/v1/player` (+ `visitor_id` when
  required), `reqwest` backend, test-overridable endpoint like
  `transcript/client.rs:163`.
- `yt/decipher.rs` — `base.js` discovery (iframe_api hash → embed fallback),
  sig-function + n-function extraction, rquickjs eval, per-response `n` cache,
  base.js code cache keyed by player id.
- `yt/formats.rs` — itag allowlist → progressive / audio / video-only / HLS /
  OTF classification with init/index ranges, mime, bitrate, fps, channels.
- `yt/error.rs` — `playabilityStatus` → typed errors (private, paid, geo,
  login, age-bypassed-ok, bot-guard, drm, unavailable) per the NewPipe table.
- `yt/commands.rs` — `yt_resolve(video_id) -> StreamManifest` (JSON: formats,
  captions, duration, title), `yt_captions(videoId, lang) -> VTT text`.
  Every command returns `Result<T, ScholiastError>` envelope (AGENTS.md §IPC).

## Test Plan (maps to PRODUCT invariants)

- **T1 (wiremock InnerTube fixtures)**: VISIONOS player response with
  ciphered formats → manifest carries deciphered https URLs; censored
  adaptive on ANDROID-shaped fixture documents the client rule. → Inv. 1, 9.
- **T2 (decipher vectors)**: recorded base.js snippet + sig/n vectors resolve
  to expected outputs; unknown-function fixture errors cleanly. → Inv. 8, 9.
- **T3 (error table)**: playability fixtures (private/paid/geo/login/drm/
  bot-guard/ok) map to the typed errors. → Inv. 6.
- **T4 (itra allowlist)**: unknown itag skipped, known itags classified
  (progressive/audio/video-only/HLS/OTF). → Inv. 2.
- **T5 (frontend MSE harness, jsdom)**: adaptive engine picks init+media
  ranges and appends in order; failures surface fallback event. → Inv. 2, 8.
- **T6 (captions)**: timedtext fixture → `<track>` cues; active-cue highlight
  follows video time. → Inv. 3.
- **T7 (regression)**: full frontend suite + Pre-CI gates (host + 3 Android
  `cargo check`, typecheck) per `docs/guides/build-and-release.md`. → All.

## Execution Slicing (Batches)

- Batch 1: tasks/01-extraction-core.md (Rust core, no UI).
- Batch 2: tasks/02-native-playback.md (player rewire, no cutover).
- Batch 3: tasks/03-cutover-fallback.md (default-on + fallback + audit).
