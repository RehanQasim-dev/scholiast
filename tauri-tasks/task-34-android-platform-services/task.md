# Task 34: Android Platform Services

Status: IN PROGRESS
Wave: A (Android)
Depends on: task-33

## Scope & Owned Files
Make the app's native services work on Android:
- **whisper-rs cross-compile**: enable `local-stt` feature for aarch64-linux-android (whisper.cpp supports Android; may need cmake/ndk-build flags via RUSTFLAGS + WHISPER_CMAKE_TOOLCHAIN). Verify a tiny model transcribes on-device in Waydroid (log latency). If bindgen/cmake fights NDK, document exact recipe in LOG.md — this is the riskiest item.
- **Mic capture**: verify getUserMedia in Android System WebView inside the app — Tauri v2 Android permission plumbing (`AndroidManifest.xml` RECORD_AUDIO permission + runtime permission request bridging; tauri v2 handles webview permission prompts via `onPermissionRequest` — wire if needed in gen/android MainActivity or via plugin). Record → WAV → transcribe round-trip on device.
- **Deep links / share-intent**: `scholiast://open?url=` via tauri-plugin-deep-link (Android asset-statement + intent-filter in gen/android); plus ACTION_SEND text/plain share-target so "Share to Scholiast" from any app opens the player. Frontend handler for both (task-04 left this unwired — implement now in Home/App).
- **Notifications/foreground**: skip (no background sync on Android v1 — sync runs on app open + manual; document).
- Frame capture on Android: **spike only** — investigate Android WebView snapshot access from Tauri (`with_webview` Android surface → `webView.getDrawingCache`/`PixelCopy` via JNI through tauri's android bindings). Timebox; if infeasible quickly, write findings + mark frame-capture desktop-only for now.

## Acceptance Criteria
- Voice add-comment works end-to-end in Waydroid (cloud Groq with a test key, or local model)
- Sharing a YouTube URL from another Waydroid app (or `am start` with ACTION_SEND) opens the player
- `scholiast://open?url=` deep link opens the player
- Desktop gates unregressed

## Notes
All Android-specific Rust behind `#[cfg(target_os = "android")]`. Log every manifest/permission change.

## Verified on-device bugs (from task-33 Waydroid pass — fix here)
- **Transcript panel renders empty on Android** even when captions are available (tab enabled). Investigate `fetch_transcript` invoke path on the device (check for the lost-Tauri-callback reload interaction) and ensure the error state renders a visible message instead of nothing.
- **Enter in the Home URL field appears to reload the page** (logcat: `Couldn't find callback id … app is reloaded while Rust is running an asynchronous operation`). Likely a form-submit default in OpenLinkField — `event.preventDefault()` audit; verify navigation happens without webview reload.
- Cosmetic (log-only): YouTube IFrame API `postMessage` origin mismatch warning (`https://www.youtube.com` → `http://tauri.localhost`) — harmless on Android; note only.
