# Task 02 — Native playback engine (batch 2)

Depends on 01. No cutover: iframe remains the default; native plays behind a
dev pref (`player.native` = off) on a test route entry.

## Owned files

- `scholiast_tauri/src/player/NativePlayer.tsx` (new)
- `scholiast_tauri/src/player/adaptiveEngine.ts` (new)
- `scholiast_tauri/src/player/useNativePlayback.ts` (new, optional —
  only if Player wiring needs shared state; else keep logic in NativePlayer)
- `scholiast_tauri/src/player/NativePlayer.test.tsx` (new, harness only)
- `scholiast_tauri/src/lib/readerIpc.ts` (yt_* wrappers only)
- `scholiast_tauri/src-tauri/src/yt/*` (fixes only, no new surface)

## Steps

1. `readerIpc.ts`: `resolveStream(videoId)`, `fetchCaptions(videoId, lang)`
   wrappers (camelCase over `yt_resolve` / `yt_captions`).
2. `NativePlayer.tsx`: `<video>` + `<track>` (VTT from `yt_captions`),
   progressive src first, `preload="metadata"`, `crossorigin="anonymous"`
   for the canvas-capture attempt.
3. `adaptiveEngine.ts`: MSE two-SourceBuffer engine (init from `init_range`,
   media via Range fetches in segment order, buffer-eviction ceiling);
   emits `fallback` on any unrecoverable engine error. Verify native HLS
   support on Linux WebKit + Android WebView for the live path before
   adding any hls.js dependency (prefer none).
4. Re-point time consumers: transcript active-cue highlight, resume
   persistence, and seek-bar read from the `<video>` element clock during
   native sessions (keep playerBridge shape: implement a native backend
   behind `commands.seekTo/play/pause` + `onTimeUpdate` per D5).
5. Frame capture: canvas `drawImage` first; on CORS taint fall back to the
   existing WebKit harvest (D6) — record the verdict per platform.
6. Tests T5–T6: MSE harness (init/append order, fallback event), caption
   cue mapping; targeted vitest only + `pnpm typecheck`.
7. Gates: `pnpm vitest run src/player`, `pnpm typecheck`, `pnpm lint` on
   touched files. Manual `tauri dev` smoke (desktop): progressive start,
   HD engage, captions, seek, capture.

## LOG

- Implemented behind `player.native` pref (default off, no cutover):
  NativePlayer + adaptiveEngine (progressive-first, MSE ≤1080p+audio),
  playerBridge native backend (same command/event shape), canvas-first
  capture with harvest fallback, new `save_canvas_frame` Rust command
  (compile-UNVERIFIED — same tree blocker as batch 1).
- HLS/canvas verdicts deferred to `tauri dev` smoke (batch 3).
- Gates green: targeted vitest (player suites 61/61), typecheck, eslint.
