#!/usr/bin/env bash
# Scholiast Android debug build + adb install recipe (task-33).
# Extra args are forwarded to `tauri android build`, e.g.
#   bash scripts/build-android.sh --features local-stt   (task 34: on-device STT)
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
# whisper-rs (local-stt): cmake-rs finds the NDK via ANDROID_NDK; bindgen wants
# the NDK sysroot instead of host headers (task 34). Every ABI needs its own
# --target or bindgen emits wrong layouts (armv7 died on __va_list_tag sizing).
export ANDROID_NDK=$NDK_HOME
export CXX_aarch64_linux_android=$N/aarch64-linux-android24-clang++
export CXX_armv7_linux_androideabi=$N/armv7a-linux-androideabi24-clang++
export CXX_i686_linux_android=$N/i686-linux-android24-clang++
export CXX_x86_64_linux_android=$N/x86_64-linux-android24-clang++
SYSROOT=$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/sysroot
export BINDGEN_EXTRA_CLANG_ARGS_aarch64_linux_android="--sysroot=$SYSROOT --target=aarch64-linux-android24"
export BINDGEN_EXTRA_CLANG_ARGS_armv7_linux_androideabi="--sysroot=$SYSROOT --target=armv7a-linux-androideabi24"
export BINDGEN_EXTRA_CLANG_ARGS_i686_linux_android="--sysroot=$SYSROOT --target=i686-linux-android24"
export BINDGEN_EXTRA_CLANG_ARGS_x86_64_linux_android="--sysroot=$SYSROOT --target=x86_64-linux-android24"
pnpm tauri android build --debug "$@"
APK=src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
echo "APK: $APK"
if command -v adb >/dev/null && adb devices | grep -qw device; then
  adb install -r "$APK"
fi
