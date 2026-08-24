#!/usr/bin/env bash
# Scholiast Android debug build + adb install recipe (task-33).
set -euo pipefail
cd "$(dirname "$0")/.."
export ANDROID_HOME=/home/rehan-10xe/Android/Sdk
export NDK_HOME=$ANDROID_HOME/ndk/28.2.13676358
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64   # Gradle 8.14 rejects Java 25
N=$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin
# NDK 28 ships only API-suffixed clang; cc-rs (libsqlite3-sys) needs these:
export CC_aarch64_linux_android=$N/aarch64-linux-android24-clang
export AR_aarch64_linux_android=$N/llvm-ar
export CC_armv7_linux_androideabi=$N/armv7a-linux-androideabi24-clang
export AR_armv7_linux_androideabi=$N/llvm-ar
export CC_i686_linux_android=$N/i686-linux-android24-clang
export AR_i686_linux_android=$N/llvm-ar
export CC_x86_64_linux_android=$N/x86_64-linux-android24-clang
export AR_x86_64_linux_android=$N/llvm-ar
pnpm tauri android build --debug
APK=src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
echo "APK: $APK"
if command -v adb >/dev/null && adb devices | grep -qw device; then
  adb install -r "$APK"
fi
