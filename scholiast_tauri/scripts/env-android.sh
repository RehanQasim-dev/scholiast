#!/usr/bin/env bash
# Source this before any Android Rust/Gradle work so `tauri android dev`,
# `tauri android build`, and the Android-target `cargo check` gates just work:
#   source scripts/env-android.sh
# Values mirror docs/guides/build-and-release.md (§ Pre-CI Local Gates) and
# scripts/build-android.sh (API-24 NDK clang wrappers, Java 21 for Gradle).
set -u
export ANDROID_HOME=/home/rehan-10xe/Android/Sdk
export ANDROID_SDK_ROOT=$ANDROID_HOME
export NDK_HOME=$ANDROID_HOME/ndk/28.2.13676358
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64   # Gradle 8.14 rejects Java 25
export PATH="$ANDROID_HOME/platform-tools:$PATH"
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
# the NDK sysroot instead of host headers. Every ABI needs its own --target.
# CMAKE_BUILD_TYPE=Release: whisper-rs-sys downgrades dev builds to
# RelWithDebInfo (-O2); the explicit env survives its WHISPER_/CMAKE_
# passthrough and keeps -O3 -DNDEBUG (same as .cargo/config.toml for host).
export ANDROID_NDK=$NDK_HOME
export CMAKE_BUILD_TYPE=Release
export CXX_aarch64_linux_android=$N/aarch64-linux-android24-clang++
export CXX_armv7_linux_androideabi=$N/armv7a-linux-androideabi24-clang++
export CXX_i686_linux_android=$N/i686-linux-android24-clang++
export CXX_x86_64_linux_android=$N/x86_64-linux-android24-clang++
SYSROOT=$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/sysroot
export BINDGEN_EXTRA_CLANG_ARGS_aarch64_linux_android="--sysroot=$SYSROOT --target=aarch64-linux-android24"
export BINDGEN_EXTRA_CLANG_ARGS_armv7_linux_androideabi="--sysroot=$SYSROOT --target=armv7a-linux-androideabi24"
export BINDGEN_EXTRA_CLANG_ARGS_i686_linux_android="--sysroot=$SYSROOT --target=i686-linux-android24"
export BINDGEN_EXTRA_CLANG_ARGS_x86_64_linux_android="--sysroot=$SYSROOT --target=x86_64-linux-android24"
# tauri-plugin-mobile-sharetarget loads its JNI lib via BuildConfig.TAURI_LIBRARY_NAME,
# filled from gradle project property `tauri_app_lib_name` (default "tauri_app_lib",
# which does not exist -> UnsatisfiedLinkError -> instant crash on open). The env form
# covers fresh `tauri android init` regens; must match [lib] name in src-tauri/Cargo.toml.
export ORG_GRADLE_PROJECT_tauri_app_lib_name=scholiast_lib
