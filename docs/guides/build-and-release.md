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
./node_modules/.bin/tauri android build   # release splits: arm64-v8a, armeabi-v7a, x86_64
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
