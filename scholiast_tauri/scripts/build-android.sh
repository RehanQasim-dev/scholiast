#!/usr/bin/env bash
# Scholiast Android debug build + adb install recipe (task-33).
# Extra args are forwarded to `tauri android build`, e.g.
#   bash scripts/build-android.sh --features local-stt   (task 34: on-device STT)
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=env-android.sh
source "$(dirname "$0")/env-android.sh"
pnpm tauri android build --debug "$@"
APK=src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
echo "APK: $APK"
if command -v adb >/dev/null && adb devices | grep -qw device; then
  adb install -r "$APK"
fi
