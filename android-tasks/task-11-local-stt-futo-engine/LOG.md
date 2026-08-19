# 11-local-stt-futo-engine — Agent log

Log entries appended while working on this task (see README.md, "Agent logging protocol").

## [2026-08-19 16:10] resume-session (first real session)
- **What I learned:**
  - FUTO `WhisperGGML.kt` is a thin suspend wrapper: single-thread `inferenceContext`, `openFromBufferNative(Buffer)` → direct `MappedByteBuffer` (mmap via `FileChannel.map` or assets `openFd`), `inferNative(handle, float[], prompt, langs[], bailLangs[], mode, suppress)` → `whisper_full` CPU, BeamSearch5 or greedy, partial results via `invokePartialResult`, cancel via native `abort_callback` + volatile flag, "`<>CANCELLED<>` lang=…/flag" sentinels.
  - The vendored `whisper.cpp` is **self-contained**: grepped for `llama_`/`common_`/`train_`/`finetune_` references — none. Only needs `ggml.c`, `ggml-alloc.c`, `ggml-backend.c`, `ggml-quants.c` + `defines.h` (for AKLOGI macros). The keyboard's CMake also builds `llama.cpp`, `finetune.cpp`, `train.cpp`, `common.cpp`, `LanguageModel.cpp`, `ModelMeta.cpp`, sentencepiece + protobuf — **all droppable** for our minimal build. `context.cpp` is FUTO's own transformer-context helper, not used by whisper.
  - `defines.h` lives at `native/jni/src/defines.h` (whisper.cpp does `#include "defines.h"`, resolved via the `src` include dir). Also needed: `jni_common.{h,cpp}` (JNI_OnLoad + RegisterNatives helper, but includes other LatinIME JNI headers — I'll write a slim standalone JNI_OnLoad instead), `jni_utils.{h,cpp}` (jstring conversion).
  - Native classpath is registered dynamically (`RegisterNatives` with `kClassPathName = "org/futo/voiceinput/shared/ggml/WhisperGGML"`) — renaming is a one-string change in the cpp + Kotlin package move. **Decision: rename** to `com/scholiast/android/domain/voice/local/WhisperGGML`, `System.loadLibrary("scholiast_whisper")`.
  - Model files: `Models.kt` has 6 ACFT Q8_0 models with SHA-256 checksums (tiny/base/small × en/multilingual); `ModelData.kt` has `ModelLoader` interface + `ModelBuiltInAsset` (assets openFd mmap) + `ModelDownloadable` (filesDir mmap `.load()`) + `ModelFileFile` (arbitrary file).
  - **Verified live:** `https://keyboard.futo.tech/voice-input-models` (the URL from `ImportResourceActivity.kt`) is a directory page that now links the *newer* models at `keyboard.futo.org/voice-input-english-{39,74,244}.bin` (302 → `dl.keyboard.futo.org`). The old `*_acft_q8_0.bin` paths 404 (curl-verified). So the `Models.kt` filenames+checksums in the repo are **stale vs the live site**; downloader must try the pinned URL pattern, and on checksum/404 failure surface a clear "manual import" path (FUTO's actual UX is a manual file import, `ImportResourceActivity`).
  - Task 09 has landed: `VoiceRecorder.stop(): FloatArray` (16 kHz mono floats, `WavWriter` for files). So `AudioSource.FloatSamples` maps directly; `AudioSource.WavFile` needs a wav→f32 decoder.
  - Task 10 has NOT landed: no `domain/voice/Transcriber.kt` exists. Per its task.md I define `Transcriber` + `AudioSource` + `TranscriptionResult` in `domain/voice/Transcriber.kt` (Task 10's file — flagged here so Task 10 knows it may already exist with this exact signature).
  - Environment: SDK at `~/.bubblewrap/android_sdk`, **no NDK, no cmake installed**, licenses accepted → AGP can auto-download NDK 28.2 + cmake 3.22.1 during assembleDebug (needs network).
- **Decisions made:**
  - Native: copy only whisper + ggml (12 files) + defines.h + jni_utils into `app/src/main/cpp/`; write a minimal CMakeLists building `scholiast_whisper`; slim `JNI_OnLoad` registering only WhisperGGML; abiFilters arm64-v8a + x86_64; ndkVersion 28.2.14247001 (same as FUTO).
  - Kotlin wrappers live in `domain/voice/local/` per task.md; the orchestrator-specified `domain/transcribe/FutoTranscriber.kt` + `FutoTranscriberTest.kt` implement/interface per task-10 signature.
  - Transcriber ported but adapted: `ModelLoader.name` becomes a plain `String` (we don't ship FUTO's string resources); `ModelBuiltInAsset` kept for a future bundled asset but nothing is vendored (uninitialized submodule — confirmed absent).
  - `Language.kt` ported in full (pure Kotlin, cheap); `MultiModelRunner` slimmed (no language-specific model switching in v1 — single model, bailLanguages empty).
  - Downloader: OkHttp (already a dep), stream to `filesDir/models/<name>.bin.part`, SHA-256 verify, atomic rename; cancel = cancel the job (closes stream); progress via bytes-downloaded callback.
- **Open questions:**
  - Where the current live models' SHA-256s live (repo's `Models.kt` checksums are for the dead filenames). User should refresh checksums if the direct-download path is used; manual import (file picker) bypasses this.
  - Whether to keep `WhisperGGML` exceptions' names (`InvalidModelException`, `InferenceCancelledException`, `BailLanguageException`) — keeping them, they're the FUTO API.
- **Progress:** Source read complete; environment verified; task.md → IN PROGRESS. Native copy + Kotlin port next.

## [2026-08-19 22:35] resume-session (deepseek-v4-flash-free)
- **What I learned:**
  - **KSP 2.2.21 crashes with a bare `IllegalStateException` (KspAAWorkerAction → `UtilKt$declarations`, util.kt:258) on a member `typealias` inside a class** — the old `typealias LocalSTTTranscriber = FutoTranscriber` inside `FutoTranscriber` was the cause. Removed it; KSP passed immediately. (Do NOT put self-referential member typealiases in this codebase.)
  - KSP also flakes non-deterministically when a **second Gradle daemon builds the same tree concurrently** (parallel agents share `app/build/`): same task succeeds on retry. Use `--no-daemon` and retry loops.
  - **AGP will not auto-install a pinned non-default NDK** (my `28.2.14247001` left a stub dir with only `source.properties`; configure then failed with `CMAKE_C_COMPILER not set`). Switching `ndkVersion` to AGP's default **27.0.12077973** made AGP install it automatically (licenses were already accepted). The legacy `tools/bin/sdkmanager` here is broken (`Could not create settings`) — don't use it.
  - Task 10 landed its interface mid-session (`domain/transcribe/Transcriber.kt` — read it before touching); Task 07 is mid-refactor and its in-flight files (`CommentEditorSheet.kt`, `EditorField.kt`, `EditorViewModel.kt` + `NotesTab.kt` cross-import) currently break the whole module compile. **Not mine to fix** (AGENTS.md ownership rule); logged instead.
- **Decisions made:**
  - `ndkVersion = "27.0.12077973"` (AGP-preferred, auto-installs) instead of FUTO's 28.2 — whisper.cpp builds clean on r27; keep the switch unless a device requires r28.
  - `FutoTranscriberTest.kt` lives at `app/src/test/java/com/scholiast/android/domain/transcribe/` (orchestrator's location), not the `domain/voice/local/LocalSTTTranscriberTest.kt` path in task.md.
  - Quarantined Task 07's 4 files to `/tmp/opencode/editor-quarantine` once (moved, NOT edited) to attempt my test run; module still failed on `NotesTab.kt` (Task 06, cross-import) → restored all 4 files **byte-identical** (sha256-verified OK). No content of another task was modified at any point.
  - Kotlin fixes this session: removed the member typealias (KSP crash); `ensureActive()` needs a receiver → `coroutineContext.ensureActive()` (`kotlin.coroutines.coroutineContext` import, not `kotlinx.coroutines.coroutineContext`); `when` over the non-sealed `ModelLoader` interface needs `else` branches (Models.kt `downloadUrlFor`, ModelDownloader.kt `fileName`); added the missing `kotlinx.coroutines.withContext` import in `WhisperGGML.kt`.
- **Open questions:** unchanged — live model checksums vs dead `*_acft_q8_0.bin` filenames (manual import is the safe path); test run + full `assembleDebug` still pending Task 07 landing.
- **Progress (verified):**
  - `./gradlew :app:externalNativeBuildDevDebug --no-daemon` → **BUILD SUCCESSFUL**; `libscholiast_whisper.so` produced for **arm64-v8a (7.6 MB) and x86_64 (7.3 MB)** (`app/build/intermediates/cxx/Debug/*/obj/<abi>/`). CMake 3.22.1 + NDK 27.0.12077973 installed under `~/.bubblewrap/android_sdk/`.
  - `:app:compileDevDebugKotlin` → my sources (domain/voice/local/*, domain/transcribe/FutoTranscriber.kt) compile **clean**; the only remaining `e:` errors are Task 06/07 files (`CommentEditorSheet`, `EditorField`, `EditorViewModel`, `NotesTab`).
  - `FutoTranscriberTest.kt` rewritten against the landed interface (Success/Failure/AudioSource/onPartial-param; `runBlocking`, no coroutines-test dep; 1e-4f WAV tolerances; fakes Echo/Streaming/Blocking/Failing/Bail engines; cancellation test via BlockingEngine latch). Not yet executable — module compile blocked by Task 07 (see above).
  - `TranscriberRegistry(local: Transcriber? = null)` param exists for wiring; `TranscriberSource.LOCAL` is defined; Settings wiring is Task 19's.

## [2026-08-20 00:16] resume-session (deepseek-v4-flash-free)
- **What I learned:**
  - `FutoTranscriberTest.kt` (moved to `app/src/test/java/com/scholiast/android/domain/transcribe/`) compiles **clean** against the landed subjects — zero errors in it. No subject-code fixes were needed; the test's fakes (Echo/Streaming/Blocking/Failing/Bail engines via `WhisperEngineFactory`) + pure `WavDecoder`/`ModelStore`/`Models.kt` catalogue all satisfy the JVM-only contract.
  - The module compile failure was **entirely other tasks' tests**: `DriveOAuthTest.kt` (task 16) references `domain/sync/drive/*` classes whose main sources do NOT exist in this checkout (task 16 never landed its main tree), and `GemmaClientTest.kt` (task 15) calls a `GemmaClient.setKey(...)` that the landed `GemmaClient.kt` doesn't have (no `setKey` anywhere in main).
- **Decisions made:**
  - Per session instructions, quarantined those two foreign test files to `/tmp/opencode/test-quarantine/` (sha256 recorded before, verified byte-identical after), ran the suite, then restored them **byte-identical** (sha256 -c OK). No content of tasks 15/16 modified — logged for their owners: task 16's `DriveOAuthTest.kt` cannot compile until `domain/sync/drive/` main sources land; task 15's `GemmaClientTest.kt` needs `setKey` on `GemmaClient` or an updated test.
- **Open questions:** none new.
- **Progress (verified):**
  - `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ./gradlew :app:testDevDebugUnitTest --no-daemon` → **BUILD SUCCESSFUL**.
  - Full suite: **305 tests, 0 failures, 0 errors** (all 16 test classes, incl. `FutoTranscriberTest` with all 17 tests passing: wav round-trip/stereo/rejects, checksum+paths, NOT_CONFIGURED/UNKNOWN/INVALID_REQUEST mapping, partial filtering, cooperative cancellation via BlockingEngine latch).

## 2026-08-20 — Active-model wiring (orchestrator)
- `SpeechDependencies.activeLocalModel(settings, modelsDir)` resolves the transcriber's model:
  the DataStore `active_stt_model` file → first installed catalogue model → `DEFAULT_MODEL`.
- `FutoTranscriber(modelsDir, resolvedModel)` is now constructed by the shared cached registry in
  `SpeechDependencies.registry(context)`; Settings imports/activations invalidate the cache so the
  chosen .bin takes effect on the next recording.
- Voice recordings now flow: `VoiceRecorderViewModel.onSamplesReady` → registry → FutoTranscriber
  (active model) → `EditorViewModel.insertText` in Notes/Transcript sheets.
- 403 tests green; commit `9391146`; APK re-uploaded to release `v0.1.0-android`.
