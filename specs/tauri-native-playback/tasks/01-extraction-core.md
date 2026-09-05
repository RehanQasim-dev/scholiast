# Task 01 — Rust extraction core (batch 1)

Tracer bullet: resolve a video id to a deciphered stream manifest with zero UI.
No TypeScript changes. No player changes.

## Owned files

- `scholiast_tauri/src-tauri/src/yt/mod.rs` (new)
- `scholiast_tauri/src-tauri/src/yt/client.rs` (new)
- `scholiast_tauri/src-tauri/src/yt/decipher.rs` (new)
- `scholiast_tauri/src-tauri/src/yt/formats.rs` (new)
- `scholiast_tauri/src-tauri/src/yt/error.rs` (new)
- `scholiast_tauri/src-tauri/src/yt/commands.rs` (new)
- `scholiast_tauri/src-tauri/src/lib.rs` (handler registration only)
- `scholiast_tauri/src-tauri/Cargo.toml` (`rquickjs`, already-vendored
  `reqwest`/`serde`/`tokio`)

## Steps

1. `yt/error.rs`: typed extraction errors from `playabilityStatus`
   (private, paid, geo, login, bot-guard, drm, unavailable, ok) + the
   ghost-response guard (response videoId must match request).
2. `yt/client.rs`: VISIONOS `POST youtubei/v1/player` with client context
   (name/version/device/os/hl/gl, visitorData, cpn/t nonces, content checks),
   endpoint-overridable for wiremock (mirror `transcript/client.rs:163`).
3. `yt/decipher.rs`: base.js discovery (`/iframe_api` hash → `/embed/`
   fallback), sig + n function extraction, rquickjs eval, per-`n` cache,
   base.js cache keyed by player id. **First verify rquickjs builds for all
   4 release targets** (host + `aarch64`/`armv7`/`x86_64-linux-android);
   if the Android C toolchain blocks, stop and re-spec (pure-Rust transform
   interpreter) instead of hacking around it.
4. `yt/formats.rs`: itag allowlist → progressive / audio / video-only / HLS /
   OTF classification incl. init/index ranges, mime, bitrate, fps, channels;
   unknown itags skipped, never fatal.
5. `yt/commands.rs`: `yt_resolve(video_id)` → manifest JSON (formats +
   captions + duration + title); `yt_captions(video_id, lang)` → VTT text via
   direct timedtext fetch. Standard `{ ok, data | error }` envelope.
6. Wiremock tests T1–T4 (TECH.md): ciphered fixture → deciphered URLs;
   error-table fixtures; itag fixtures; decipher vectors incl. failure shape.
7. Gates: `cargo check` (host — mandatory), 3 Android-target checks,
   `cargo clippy -- -D warnings`, `cargo test yt::`, `pnpm typecheck`
   (untouched TS must stay green).

## LOG

- Implemented: yt/{mod,error,client,decipher,formats,resolve,commands} +
  `yt_resolve` / `yt_captions` commands registered in lib.rs.
- rquickjs 0.12 dropped: prebuilt bindings miss aarch64-linux-android
  (bindgen fallback needs host libclang). Replaced with boa_engine 0.22
  (pure Rust); required toolchain 1.88 → stable 1.98 (CI already tracks
  stable, no pin) — recorded in TECH.md D2.
- Live proof (`live_resolve_real_video`, ignored): VISIONOS adaptive-only
  for the probe video; real responses omit hasAudio/hasVideo (derived from
  mime+codecs in formats.rs) and currently ship direct URLs (decipher path
  exercised via fixtures + synth vectors).
- 16/16 yt unit+wiremock tests green; live test green.
- BLOCKED (external): tree-wide Rust gates (clippy, 3 Android checks, full
  cargo test) cannot run — concurrent in-progress `github/` module breaks
  the build (`GithubError::InvalidInput` never constructed, dead_code deny).
  Untouched by this batch; gates to re-run once that work compiles.
- UPDATE: the other session landed their fix — no repair needed on our side.
  Full gates now green: host `cargo check`, `cargo clippy` (new pedantic
  warnings in our files fixed; pre-existing ones elsewhere left alone),
  all 3 Android targets, `cargo test -p scholiast --lib` 124 passed.
- Android gates caught one real bug: `save_canvas_frame` (batch 2) called
  the Linux-only `blackframe::is_black_frame` unconditionally — now
  `#[cfg(target_os = "linux")]`-gated like the harvest path.
