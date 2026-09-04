# 01: Android Toolchain & Project Scaffold

**What to build:** Android Toolchain & Project Scaffold

**Blocked by:** None

**Status:** completed

- [x] Tauri Android project scaffold compiles cleanly with Cargo NDK (Invariant 3)

## Scope & Implementation Notes
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


## Execution History & Log
# Task 33 — Android Scaffold & Toolchain

## [2026-08-24T00:00Z] task-33
- **status**: IN PROGRESS
- **learned**: Env verified — rustup targets aarch64-linux-android + armv7-linux-androideabi + i686-linux-android installed; ANDROID_HOME=/home/rehan-10xe/Android/Sdk (platforms 34/35/36, build-tools 36.0.0, ndk/28.2.13676358); JAVA_HOME=/usr/lib/jvm/java-25-openjdk-amd64; waydroid at /usr/bin/waydroid.
- **decisions**: Follow work plan order: init → cargo check android target → secrets split → conf align → debug build → Waydroid gate → desktop regression gates.
- **open questions**: keyring Android fallback choice (file-based v1 vs crate) — decide at step 2.
- **progress**: Task marked IN PROGRESS; environment recipe confirmed.

## [2026-08-24T06:30Z] task-33 (resumed)
- **status**: IN PROGRESS
- **learned**:
  - NDK r28 ships only API-suffixed wrappers (`aarch64-linux-android24-clang`); cc-rs needs
    explicit `CC_aarch64_linux_android` / `CXX_...` / `AR_...=llvm-ar` (minSdk=24). zsh gotcha:
    `export A=x B=$A/y` expands `$A` empty — sequential exports required.
  - keyring v3 *compiles* for android target but has no backend → runtime failure; dep now gated
    `cfg(not(target_os = "android"))`.
  - Linux-only `image` crate leaked via un-gated `crop_rect` + capture tests; lib.rs registered
    linux-only `capture::persist::*` commands unconditionally.
- **decisions**: Secrets = trait-free module split in `secrets.rs` (same public API): desktop keeps
  keyring impl behind `#[cfg(not(target_os = "android"))]`; Android gets app-private file store at
  `<app_data>/secrets/<entry_id>`, dir 0700, files 0600, TODO for Keystore/EncryptedSharedPreferences
  follow-up. Dir seeded via `secrets::init_store(&data_dir)` from `lib.rs` setup (`OnceLock`, no API
  churn through drive/). `KeyringProvider` (stt/cloud.rs) now delegates through `crate::secrets` so
  the `KeyProvider` seam is unchanged and works on both targets. No viable lightweight android
  keystore Rust crate found worth adding for v1 (pragmatic choice documented here).
- **progress**: cargo check --target aarch64-linux-android -p scholiast GREEN (dead-code warnings
  only, linux-only capture code); desktop cargo check green; secrets unit tests green.

## [2026-08-24 09:20] orchestrator-closeout (verified via waydroid-inspect skill / ADB)
- **What I learned (build fixes, in order):** ① Gradle 8.14 cannot run under Java 25 (cryptic `> 25.0.3` buildSrc failure) — JAVA_HOME must be /usr/lib/jvm/java-21-openjdk-amd64 (same pin the old android/ project uses). ② NDK 28 has no unsuffixed `aarch64-linux-android-clang`; cc-rs crates (libsqlite3-sys via sqlx) need CC_aarch64_linux_android / AR_* (and siblings) pointed at the `-android24-clang` / `llvm-ar` binaries. ③ Direct cargo link used the HOST linker until CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER was set (tauri CLI sets it; raw cargo doesn't). ④ **lib.rs was missing `#[cfg_attr(mobile, tauri::mobile_entry_point)]`** — the CLI validates runtime symbols and refused the .so. All four fixes are now in the tree/scripts.
- **Decisions made:** Build recipe captured in scripts/build-android.sh (env + command). Debug APK = 264MB universal (4 ABIs); release/ABI-split builds will shrink it.
- **Open questions:** none blocking.
- **Progress:** APK built + `adb install` Success + launched in Waydroid. VERIFIED ON DEVICE (screenshots in /tmp/opencode/scratch/): boot to dark Home shell ✓, sidebar navigation to Player ✓, typed youtu.be URL → videoId extraction → IFrame player → **video plays with audio focus** ✓, captions detected (Transcript tab enabled) ✓, Notes empty state ✓. logcat: zero crashes/exceptions. Known bugs filed to tasks 34/35: transcript panel empty on Android (34), Enter-in-input may reload page (lost Tauri callback, 34/35), narrow-viewport layout broken (35), IFrame postMessage origin warning (cosmetic).

