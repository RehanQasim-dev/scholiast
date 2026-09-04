# Task 33: Android Scaffold & Toolchain

Status: DONE
Wave: A (Android)
Depends on: tasks 01–32 (desktop v1 codebase)

## Scope & Owned Files
Bring `scholiast_tauri` up as a Tauri v2 Android app that builds, installs, and boots:
- Run `pnpm tauri android init` → generates `src-tauri/gen/android` (Gradle project). Commit it (minus build artifacts; extend .gitignore).
- `tauri.conf.json`: add Android app identifier/bundle config consistent with `app.scholiast.desktop` (package `app.scholiast.app`), portrait-agnostic (sensor), dark status bar.
- Rust: ensure workspace compiles for `aarch64-linux-android` — cfg-fix anything Linux-only leaking into shared code paths (capture is already `#[cfg(target_os = "linux")]`; verify no other leaks: `WEBKIT_DISABLE_COMPOSITING_MODE` setenv is linux-cfg'd in lib.rs ✓ — audit the rest).
- **Secrets shim**: `keyring` crate has no Android backend — introduce `src-tauri/src/secrets.rs` platform split: keep keyring for desktop, Android uses an encrypted-prefs fallback (android-keystore-backed via `shared_preferences` + EncryptedSharedPreferences is NOT available; pragmatic v1: store in app-private file with a warning + TODO, OR use the `security-framework`-style crate `android-keyring` if viable — research and pick, document in LOG). Keep the `KeyProvider` seam (task-10) intact.
- Frontend: no changes required to compile; verify `pnpm build` still green.
- Build script: `pnpm tauri android build --debug` producing `app-universal-debug.apk`; document exact env (NDK_HOME, ANDROID_HOME, JAVA_HOME) in LOG.md and a root `scripts/build-android.sh`.
- **Waydroid install gate**: `waydroid app install src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`, launch it, capture screenshot evidence (`waydroid screenshot` or shell screencap) proving it boots to the dark shell.

## Acceptance Criteria
- `pnpm tauri android build --debug` succeeds end-to-end
- APK installed in Waydroid; app launches showing Home (screenshot in LOG)
- `cargo clippy --workspace --all-targets -- -D warnings` still clean on desktop target; `cargo check --target aarch64-linux-android -p scholiast` clean
- Desktop gates unregressed (pnpm + cargo suites)

## Notes
- Do NOT attempt Play Store signing — debug keystore only.
- Record every env var + Gradle hiccup in LOG.md; task-34/35/36 depend on this working first.
