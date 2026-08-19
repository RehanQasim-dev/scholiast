# 01-project-skeleton — Agent log

Log entries appended while working on this task (see README.md, "Agent logging protocol").


## [2026-08-19 18:25] task-01 agent
- **What I learned:**
  - No system Android SDK: a full SDK exists at `/home/rehan-10xe/.bubblewrap/android_sdk` (build-tools 35.0.0/36.1.0, platforms android-36, platform-tools, licenses accepted). I installed `platforms;android-35` via its bundled `tools/bin/sdkmanager` (needs JAVA_HOME=jdk-17; the default JDK 25 breaks the old sdkmanager).
  - Gradle 8.11.1 distribution is pre-cached in `~/.gradle/wrapper/dists/gradle-8.11.1-bin` — will generate the wrapper from it (no system `gradle` binary).
  - JDKs available: 17, 21, 25. Gradle 8.11.1 + JDK 21 works; JDK 25 does NOT run Gradle 8.11.1 → builds must set `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64` (or 17).
  - Google Maven reachable; verified current stable versions live. AGP 9.x exists now but needs Gradle 9; pinned to AGP 8.10.1 (needs Gradle 8.11.1 exactly).
- **Decisions made (version catalog — all verified to exist on Google Maven/Maven Central):**
  - Gradle wrapper 8.11.1, AGP 8.10.1, Kotlin 2.2.21 (+ `org.jetbrains.kotlin.plugin.compose` same version), KSP 2.2.21-2.0.5.
  - Compose BOM **2025.06.01** (ui 1.8.3, material3 1.3.2) — newest BOM that stays on the compileSdk-35 line (later BOMs need compileSdk 36; plan pins compileSdk/targetSdk 35).
  - androidx: core-ktx 1.16.0, activity-compose 1.10.1, navigation-compose 2.9.8, lifecycle 2.9.4 (runtime-ktx, viewmodel-compose, runtime-compose), room 2.8.4 (runtime+ktx+compiler via KSP), datastore-preferences 1.1.7, work-runtime-ktx 2.10.1.
  - Other: okhttp 4.12.0, kotlinx-serialization-json 1.9.0, coil-compose 3.5.0 (io.coil-kt.coil3).
  - Flavor: `dev` (applicationIdSuffix `.dev`) + `prod` per plan §7.1; real dev-vs-prod differences (fake keys, logcat) deferred to later tasks.
- **Open questions:** none blocking.
- **Progress:** task claimed (task.md → IN PROGRESS); environment recon done; platform-35 installed. Scaffolding next.

## [2026-08-19 18:55] task-01 agent
- **What I learned:**
  - Build commands that worked (JAVA_HOME=jdk-21): `./gradlew :app:assembleDebug` → BUILD SUCCESSFUL in ~43 s (72 tasks). APKs: `app/build/outputs/apk/{dev,prod}/debug/app-{dev,prod}-debug.apk`.
  - Wrapper generated from the pre-cached dist: `$GRADLE_DIST/bin/gradle wrapper --gradle-version 8.11.1` (no system gradle needed).
  - Coil 3.5.0 + several late-2025 androidx minors require compileSdk 36 → AGP fails the build with a clear "requires compileSdk 36" message; pinned compileSdk 35 versions instead.
  - Material3 `TopAppBar` needs `@OptIn(ExperimentalMaterial3Api::class)` (m3 1.3.2); `androidx.navigation.compose.composable` must be imported (fully-qualified call doesn't resolve in the NavGraphBuilder DSL).
  - `toPx` is a Density member-extension, not an importable function.
- **Decisions made:**
  - Compose BOM pinned at **2025.06.01** (ui 1.8.3, material3 1.3.2) — newest BOM compatible with compileSdk 35 (plan §7.1 pins compile/target 35). Coil **3.2.0** for the same reason. All other picks from the first log entry stood.
  - Theme: `dynamicDarkColorScheme()` on API 31+, fixed `ScholiastDarkColorScheme` (black bg, #0B0D14/#151824 surfaces, #232733 hairline, #8B7CF6 accent, fixed highlight hues as separate tokens) on API 30 — exactly per plan §6.1 / task spec.
  - Flavors dev/prod added per plan §7.1 (`dev` = `.dev` applicationIdSuffix); real dev-vs-prod differences deferred to later tasks.
  - `voiceEdit`/`frame` routes land on an internal `PlaceholderScreen` in `ui/navigation/ScholiastApp.kt` — Tasks 07/14 replace the route bodies; they own `ui/voice/`, `ui/frame/`.
  - **Cross-task fix (logged per protocol):** Task 09's in-flight `ui/voice/MicButton.kt` (unmodified for ~6 min, 8 compile errors) blocked the whole repo's build. I applied 3 minimal fixes: added `import androidx.compose.animation.core.animateFloat`, removed the invalid `import androidx.compose.ui.unit.toPx`, and changed `toPx(3.dp)` → `3.dp.toPx()`. No logic touched. Task 09: please review.
- **Open questions:** Task 09 should confirm the MicButton fixes match their intent; if they rewrite the file, the imports are the only thing to keep.
- **Progress:** Full skeleton built + verified: settings.gradle.kts, root build.gradle.kts, gradle.properties, gradle/libs.versions.toml, wrapper (8.11.1), app/build.gradle.kts (dev/prod flavors, minSdk 30, target/compile 35, R8 release), proguard-rules.pro, manifest (3 permissions, share text/plain intent filter, hardwareAccelerated, dark themes incl. values-night + values-v31 splash), MainActivity, ui/theme (Color/Type/Shape/Theme with dynamic + fixed dark), ui/navigation (Routes + NavHost: home, player/{videoId}, settings, voiceEdit, frame), stub screens home/player/settings, res (strings, colors, icon placeholder adaptive + monochrome). `assembleDebug` green for both flavors.
