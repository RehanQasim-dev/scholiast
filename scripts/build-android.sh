#!/usr/bin/env zsh
# Debug APK build for the Tauri Android shell (task 33).
# Usage: scripts/build-android.sh [arch target triple, default aarch64-linux-android]
set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export NDK_HOME="$ANDROID_HOME/ndk/28.2.13676358"
# Gradle 8.14/AGP 8.11 choke on Java 25 ("class file major version 69") — use 21.
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"

# cc-rs (aws-lc-sys et al.) needs the NDK's API-level-suffixed wrappers; minSdk=24.
TOOLCHAIN="$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin"
export CC_aarch64_linux_android="$TOOLCHAIN/aarch64-linux-android24-clang"
export CXX_aarch64_linux_android="$TOOLCHAIN/aarch64-linux-android24-clang++"
export AR_aarch64_linux_android="$TOOLCHAIN/llvm-ar"
export RANLIB_aarch64_linux_android="$TOOLCHAIN/llvm-ranlib"

export CC_x86_64_linux_android="$TOOLCHAIN/x86_64-linux-android24-clang"
export CXX_x86_64_linux_android="$TOOLCHAIN/x86_64-linux-android24-clang++"
export AR_x86_64_linux_android="$TOOLCHAIN/llvm-ar"
export RANLIB_x86_64_linux_android="$TOOLCHAIN/llvm-ranlib"

TARGET="${1:-x86_64}"

cd "$(dirname "$0")/../scholiast_tauri"
pnpm tauri android build --debug --target "$TARGET"

echo "APK: src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk"
