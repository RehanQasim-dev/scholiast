# Product Spec: Tauri Android Platform Adaptation

## Summary
Android phone and tablet ergonomics, status bar safe area padding, responsive multi-column layouts, and release APK packaging.

## Behavior

1. **The application adapts layout fluidly to three hardware profiles**: Mobile Phones (portrait single-column with bottom sheets), Tablets (landscape 60/40 resizable split with S-Pen direct highlighting), and Desktop (collapsible navigation rail with windowed/fullscreen dual panes).
2. **Top-level overview screens (`/home`, `/settings`) provide generous status bar padding** (`pt-7 sm:pt-9 px-6`) to prevent collision with Android status bars, camera notches, or tablet bezels.
3. **Application builds cleanly and exclusively for the 4 mandatory release targets**: `.deb` (x86_64 Linux), `arm64-v8a` (Android 64-bit), `armeabi-v7a` (Android 32-bit), and `x86_64` (Android / Waydroid).
4. **Universal APK and 32-bit x86 Android builds are strictly excluded** to eliminate packaging and binary distribution bloat.
5. **Native Android system back gestures** integrate with the app router via `onBackPressedDispatcher`, popping active sessions without quitting the app unexpectedly.
