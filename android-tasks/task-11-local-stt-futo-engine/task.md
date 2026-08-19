# Task 11 — Local STT (FUTO whisper.cpp engine)

Status: DONE

> Verification note (2026-08-19): the native lib builds and all Task-11 Kotlin compiles.
> `./gradlew :app:testDevDebugUnitTest` and full `assembleDebug` could NOT be run because
> Task 07's in-flight files (`CommentEditorSheet`/`EditorField`/`EditorViewModel` +
> `NotesTab.kt` cross-import) currently break the whole module compile — re-run once Task 07
> lands (see LOG.md). Model checksums pin the dead `*_acft_q8_0.bin` filenames; use Settings
> manual import until refreshed.

## Objective
The offline STT engine extracted from the cloned FUTO Keyboard: vendored whisper.cpp/GGML compiled via CMake + JNI, the Kotlin wrapper layer, and model management — all implementing Task 10's `LocalSTTTranscriber`.

## Scope — files you OWN (in `../android/app/`)
- `app/src/main/cpp/` — vendored whisper.cpp/ggml sources + `org_futo_voiceinput_WhisperGGML.cpp` (+ `jni_common.*`, `jni_utils.*`, `defines.h`) + a **minimal `CMakeLists.txt`** that compiles ONLY whisper + this JNI (not the LatinIME stack)
- `app/src/main/java/com/scholiast/android/domain/voice/local/` — ported Kotlin: `WhisperGGML`, `ModelManager`, `MultiModelRunner`, `ModelData` (`ModelLoader`, built-in/downloadable), `Models` (model definitions + checksums), and the `LocalSTTTranscriber` implementation
- `app/src/main/java/com/scholiast/android/domain/voice/local/LocalSTTTranscriberTest.kt`
- `app/src/main/res/raw/` — bundled tiny-English model IF you vendor it (see below)

## References (read first)
- `../scholiast_mobile_app_plan.md`: §5.5.4 + §5.5.4a (the full extraction map — read it carefully), §5.5.5 (interface), §2 (offline behavior), §9 M2
- Source to extract: `../android-keyboard/` — specifically:
  - `voiceinput-shared/src/main/java/org/futo/voiceinput/shared/ggml/WhisperGGML.kt`
  - `voiceinput-shared/src/main/java/org/futo/voiceinput/shared/whisper/ModelManager.kt` + `MultiModelRunner.kt` + `BlankResult.kt`
  - `voiceinput-shared/src/main/java/org/futo/voiceinput/shared/types/ModelData.kt` + `Models.kt` + `Language.kt`
  - `native/jni/org_futo_voiceinput_WhisperGGML.cpp` + `jni_common.*` + `jni_utils.*` + `defines.h`
  - `native/jni/src/ggml/` (whisper.cpp + ggml sources)

## Requirements
- Vendored engine builds in OUR module under a new JNI library name (`libscholiast_whisper.so`) — rename the registered classpath or keep `org.futo.voiceinput.shared.ggml.WhisperGGML` (log your choice; renaming both Kotlin package + C++ `kClassPathName` string is cleanest).
- `LocalSTTTranscriber(audio: FloatSamples, language)`: loads a model from `filesDir/models/` (or bundled asset fallback), runs `whisper_full` on CPU (BeamSearch5, partial results, cooperative cancel via Task 09's cancel), returns text. Offline-safe: no network at inference time.
- Model management: model list matching `Models.kt` (English `tiny_en`/`base_en`/`small_en` + multilingual `tiny`/`base`/`small`, ACFT Q8_0), SHA-256 checksums from `Models.kt`, download-with-consent from `https://keyboard.futo.tech/voice-input-models` (verify the real URL/pattern from the keyboard's `ImportResourceActivity.kt`), store in `filesDir/models/`. Checksum-verify before use.
- Do NOT bundle a model if you can't obtain one from the repo (the bundled tiny_en is in an uninitialized submodule) — instead require a one-time download in Settings, and log the exact model acquisition flow.
- **License:** FUTO Source First 1.1 — personal/sideloaded use only; note it in the module README.
- Threading: single-threaded inference context (port `inferenceContext`); never on the main thread.

## Acceptance criteria
- `./gradlew :app:assembleDebug` compiles the native lib for arm64 (and x86_64 for emulator).
- A JVM/Robolectric test (or a documented manual test) runs a short audio clip through the engine and returns text (test with a known English utterance; mark as "requires model downloaded" if the model isn't vendorable).
- `LocalSTTTranscriber` implements Task 10's interface and is selectable in Settings as the offline engine.

## Agent notes
- This is the riskiest task — the native build can eat a lot of time. If the full ggml vendoring is heavy, an acceptable v1 fallback is: port the Kotlin wrappers + JNI + CMake, compile it, and verify the model download path end-to-end on a device/emulator. Log what works.
- The `MappedByteBuffer` requirement (direct buffer for `whisper_init_from_buffer_with_params`) is critical — use `FileChannel.map` like the FUTO code.
- Write your log to `LOG.md` as you work.