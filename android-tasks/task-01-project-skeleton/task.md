# Task 01 — Project skeleton, theme, navigation

Status: DONE

## Objective
Create the Gradle project skeleton and app shell so every other task has a place to land. This is the foundation — everything compiles against this structure.

## Scope — files you OWN (in `../android/`)
- `settings.gradle.kts`, `build.gradle.kts` (root), `gradle.properties`, `gradle/libs.versions.toml` (version catalog), `gradlew` wrapper files
- `app/build.gradle.kts` (Android app module), `app/proguard-rules.pro`
- `app/src/main/AndroidManifest.xml` (permissions, activities, share-intent filter, dark theme)
- `app/src/main/java/com/scholiast/android/MainActivity.kt` (single-activity Compose app)
- `app/src/main/java/com/scholiast/android/ui/theme/` — colors, type, shapes, `ScholiastTheme` with Material You dynamic + dark fallback
- `app/src/main/java/com/scholiast/android/ui/navigation/` — NavHost + routes (home, player, settings, voice-edit, frame)
- `app/src/main/res/` — app icon placeholder, values (strings), `values-night` (dark), wallpaper-based dynamic theme config

## References (read first)
- `../scholiast_mobile_app_plan.md`: §1.2 (device/API 30), §2 (locked decisions), §3.2 (tech stack), §3.3 (package structure), §6.1 (design tokens — Material You dynamic accent, black surfaces, fixed highlight colors), §6.3 (screen designs), §7.1 (Gradle, min SDK 30, target 35), §9 M0.

## Requirements
- Kotlin 2.x, AGP stable, Compose BOM, Material 3, Navigation Compose, Room, DataStore, OkHttp, kotlinx.serialization, Coil, WorkManager, Lifecycle, `minSdk 30`, `targetSdk 35`.
- Theme: `dynamicDarkColorScheme()` when supported (API 31+); fixed dark palette fallback on API 30 (black `#000000` bg, surfaces `#0B0D14`/`#151824`, hairline `#232733`, text `#FFFFFF`/`#9AA0A6`, disabled `#4A4F59`, accent purple `#8B7CF6`, highlights yellow `#F9E64D`/red `#FF5A5A`/green `#5FE3A0`). Dark-only in v1.
- Routes: `home`, `player/{videoId}`, `settings`, `voiceEdit`, `frame`.
- Manifest: `RECORD_AUDIO`, `INTERNET`, `ACCESS_NETWORK_STATE`; a `text/plain` share-intent filter on the launcher activity; hardware-accelerated WebView.
- Include stub screens for home/player/settings so the app compiles and navigates.

## Acceptance criteria
- `./gradlew :app:assembleDebug` succeeds from `../android/`.
- App launches, renders the dark theme, and can navigate between stub screens.
- Package structure matches §3.3 of the plan.

## Agent notes
- If you need to pick library versions, prefer the newest stable compatible set; record them in the version catalog and log which you chose.
- Do NOT scaffold the whole app module manually if `gradle init` or an IDE template is easier — but keep the final layout matching §3.3.
- Write your log to `LOG.md` as you work (README.md: "Agent logging protocol").