# Scholiast — Build & Release Guide

Concise commands to build the Tauri app for the 4 mandatory targets and publish a release.

## Prerequisites (Linux)

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
  libsecret-1-dev patchelf
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android x86_64-unknown-linux-gnu
java -version  # use Java 21
# Android SDK + NDK 28.2.13676358 at $HOME/Android/Sdk
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export ANDROID_HOME=$HOME/Android/Sdk
export ANDROID_SDK_ROOT=$HOME/Android/Sdk
export NDK_HOME=$HOME/Android/Sdk/ndk/28.2.13676358
```

Fix pnpm postinstall allowlist if blocked:
```bash
cat > scholiast_tauri/pnpm-workspace.yaml <<'EOF'
allowBuilds:
  esbuild: true
  '@parcel/watcher': true
  '@tailwindcss/oxide': true
EOF
pnpm approve-builds --all
```

## Build — 4 Mandatory Targets Only (AGENTS.md 11.3)

**Do not** include `x86` (32-bit emulator) or `universal` APK.

`scholiast_tauri/src-tauri/gen/android/app/build.gradle.kts` must contain:
```gradle
include("arm64-v8a", "armeabi-v7a", "x86_64")
isUniversalApk = false
```

### 1) Desktop .deb (release)
```bash
cd scholiast_tauri
pnpm build              # tsc + vite → dist/
./node_modules/.bin/tauri build        # → src-tauri/target/release/bundle/deb/*.deb
```

### 2) Android APKs (release per ABI)
```bash
cd scholiast_tauri
pnpm build
# --features local-stt is mandatory for release: without the compiled whisper
# engine, installed model files report "ready" but every local transcription
# fails (the frontend guards this via stt_local_engine_available, but the
# release APK must actually ship the engine).
# The NDK bindgen exports (BINDGEN_EXTRA_CLANG_ARGS_* + sysroot in
# scripts/env-android.sh, sourced by build-android.sh) are equally mandatory:
# without them whisper-rs-sys parses host glibc headers and the 32-bit armv7
# bindings fail their struct-size asserts.
./node_modules/.bin/tauri android build --apk --split-per-abi --target aarch64 armv7 x86_64 --features local-stt   # release splits: arm64-v8a, armeabi-v7a, x86_64
# outputs:
# src-tauri/gen/android/app/build/outputs/apk/release/app-arm64-v8a-release.apk
# src-tauri/gen/android/app/build/outputs/apk/release/app-armeabi-v7a-release.apk
# src-tauri/gen/android/app/build/outputs/apk/release/app-x86_64-release.apk
```

Debug only (if needed): add `--debug` / `android build --debug`.

Free disk if needed: `cargo sweep --maxsize 4GB scholiast_tauri`

## Version Bump

Update in 4 places, then commit:
```bash
# edit version = "0.3.0"
# scholiast_tauri/src-tauri/tauri.conf.json  -> "version": "0.3.0"
# scholiast_tauri/src-tauri/Cargo.toml       -> version = "0.3.0"
# scholiast_tauri/package.json               -> "version": "0.3.0"
# (optional) crates if published
git add scholiast_tauri/src-tauri/tauri.conf.json scholiast_tauri/src-tauri/Cargo.toml scholiast_tauri/package.json \
        scholiast_tauri/src-tauri/gen/android/app/build.gradle.kts
git commit -m "chore: bump version to 0.3.0"
git push
```

## Create GitHub Release

```bash
git tag v0.3.0-dark-obsidian-mint
git push origin tag v0.3.0-dark-obsidian-mint

gh release create v0.3.0-dark-obsidian-mint \
  --title "Scholiast v0.3.0 — Dark Obsidian & Crisp Mint" \
  --notes "Theme overhaul + 4-target release. See BUILD.md" \
  --target main \
  scholiast_tauri/src-tauri/target/release/bundle/deb/*.deb \
  scholiast_tauri/src-tauri/gen/android/app/build/outputs/apk/release/*.apk
```

Or create empty release first, then upload:
```bash
gh release create v0.3.0-dark-obsidian-mint --title "..." --notes "..." --target main
gh release upload v0.3.0-dark-obsidian-mint path/to/*.deb path/to/*.apk --clobber
```

Verify:
```bash
gh release view v0.3.0-dark-obsidian-mint --json assets --jq '.assets[].name'
npx tsc --noEmit  # typecheck
sudo apt install ./scholiast_tauri/src-tauri/target/release/bundle/deb/*.deb  # test install
adb install scholiast_tauri/src-tauri/gen/android/app/build/outputs/apk/release/app-arm64-v8a-release.apk
```

## Pre-CI Local Gates (mandatory before push / release)

Why: the release workflow takes 20–25 min, and a host-only `cargo check`
compiles the **Linux `cfg` only** — Android-only breakage (e.g. a
`#[cfg(target_os = "linux")]` gate on code that Android now compiles, or a
param that is used on Linux but unused on Android tripping the workspace
`unused = "deny"` lint) passes locally and fails 9+ min into CI. These gates
take seconds-to-~2 min cached and catch that class of failure. CI enforces the
same via the `quick-gates` job, which fails fast before the build jobs start.

One-time setup (Linux):
```bash
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android x86_64-unknown-linux-gnu
# Android SDK + NDK 28.2.13676358 at $HOME/Android/Sdk (see Prerequisites above)
```

Run from `scholiast_tauri/` before every push that touches Rust or TypeScript:
```bash
cargo check   # host (Linux cfg): types + unused/dead_code deny, ~3s cached
pnpm typecheck # tsc --noEmit, mirrors CI's "Verify frontend build" step

# Android-cfg coverage (the gate that catches cross-platform cfg breakage).
# NDK clang wrappers are required even for `check` (ring/sqlite build scripts).
export ANDROID_HOME=$HOME/Android/Sdk
export NDK_HOME=$HOME/Android/Sdk/ndk/28.2.13676358
export NDK_BIN=$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin
export CC_aarch64_linux_android=$NDK_BIN/aarch64-linux-android21-clang
export CC_armv7_linux_androideabi=$NDK_BIN/armv7a-linux-androideabi21-clang
export CC_x86_64_linux_android=$NDK_BIN/x86_64-linux-android21-clang
# cc-rs looks for <target>-ar on PATH; the NDK only ships llvm-ar.
export AR_aarch64_linux_android=$NDK_BIN/llvm-ar
export AR_armv7_linux_androideabi=$NDK_BIN/llvm-ar
export AR_x86_64_linux_android=$NDK_BIN/llvm-ar
cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-linux-android
cargo check --manifest-path src-tauri/Cargo.toml --target armv7-linux-androideabi
cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-linux-android
```

Notes:
- First run per target compiles fresh deps (~1 min each); after that each
  check is a few seconds.
- Prefer `cfg`-gated code over `#[allow(unused)]`/`dead_code` when silencing a
  platform-only warning (e.g. `#[cfg(not(target_os = "linux"))] let _ =
  (rect.x, rect.y, rect.w, rect.h);`), per `scholiast_tauri/AGENTS.md`.
- Full test suites (`cargo test`, `pnpm vitest run`) stay opt-in per the
  no-casual-tests rule — run only targeted tests for the change at hand.
