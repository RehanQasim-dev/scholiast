# 03: Local Hardware-Accelerated Whisper STT

**What to build:** Local Hardware-Accelerated Whisper STT

**Blocked by:** 01

**Status:** completed

- [x] whisper-rs background worker thread with -O3 optimization and streaming partials (Invariant 3)

## Scope & Implementation Notes
# Task 11: Local STT (whisper-rs)

Status: DONE
Wave: 1
Depends on: task-01

## Scope & Owned Files
- `src-tauri/src/stt/local.rs` — `whisper-rs` integration behind cargo feature `local-stt`:
  - dedicated worker thread owning one inference context (queue of jobs)
  - cooperative cancel flag (mirrors FUTO `WhisperGGML` semantics); partial-segment callback → emit `stt://partial {sessionId,text}`; final → `stt://final`
  - language param; no_timestamps for <25 s clips; thread count clamp 2..16
- `src-tauri/src/stt/models.rs` — model manager: catalog (tiny_en default; base_en/small_en) from keyboard.futo.tech endpoints + SHA-256 pins copied from FUTO `Models.kt`; download to app-data `models/`, verify checksum, set active pref
- Commands: `stt_local_transcribe(wavPath,{language}) -> finalText`, `stt_local_cancel(sessionId)`, `list_models()/download_model(id)/set_active_model(id)`
- Implements the same `Transcriber` trait as task-10 (VERBATIM cap)

## Acceptance Criteria
- Unit test: WAV→PCM feed → deterministic tiny-model output on a bundled 2 s sample (feature-gated CI skip if model absent)
- Cancel path returns promptly mid-inference

## Notes
FUTO Source First License 1.1 — personal use only; engine swap (sherpa-onnx) documented as pre-distribution TODO in LOG.md.


## Execution History & Log
# 11-local-stt-whisper — Agent log

Log entries appended while working on this task (see `../README.md`, "Agent logging protocol").

## [2026-08-23 00:20] session-1 (ox-alpha)
- **What I learned:**
  - FUTO `voiceinput-shared/Models.kt` has **checksums but no URLs**. `tiny_en` is a *bundled asset*
    (`tiny_en_acft_q8_0.bin.not.tflite`, no checksum), only `base_en`/`small_en` (+ multilingual trio)
    carry SHA-256 pins. The `ggmlFile` names are bare filenames, not endpoints.
  - **The pinned FUTO paths are dead**: android task-11 (`android-tasks/task-11-local-stt-futo-engine/LOG.md`)
    curl-verified `*_acft_q8_0.bin` 404s; the live `keyboard.futo.tech/voice-input-models` page links
    newer `keyboard.futo.org/voice-input-english-{39,74,244}.bin` with **no published hashes**.
  - The Flutter port (`scholiast_flutter/lib/core/stt/stt_models.dart`) already chose
    HuggingFace `ggerganov/whisper.cpp` GGMLs for desktop. whisper-rs *is* whisper.cpp, so those
    artifacts are the guaranteed-compatible format (FUTO ACFT q8_0 quant may not even load on
    upstream whisper.cpp).
  - HF LFS OIDs are authoritative SHA-256 pins (verified via HF tree API this session).
  - `reqwest 0.13.4` (transitive via tauri) and `sha2 0.10.9` are already in `Cargo.lock` — optional
    feature-gated deps add zero new lock entries / default-build cost.
  - Task-10 is NOT STARTED → the shared `Transcriber` trait does not exist yet; I define a local
    `InferenceBackend` trait seam inside `local.rs` for tests and integration adapts later.
- **Decisions made:**
  - Catalog URLs = HuggingFace whisper.cpp official GGMLs (tiny_en default / base_en / small_en),
    each SHA-256-pinned from HF LFS OIDs. Models.kt's ACFT pins are recorded in the catalog docs as
    provenance but are unusable (dead files). Checksum-verify-before-rename makes any stale URL fail
    safely instead of installing a wrong model.
  - Ownership deviation (flagged): added `sha2` + `reqwest` as **optional** deps behind `local-stt`
    alongside `whisper-rs`. The deliverables (`download_stt_model`, "verify checksum") are impossible
    without an HTTP client and a hasher; both crates already sit in the dependency graph via tauri,
    so default builds are untouched. WAV reading stays hand-rolled (no hound), mirroring recording.rs.
  - One `WhisperContext` cached per model file on the worker thread (FUTO WhisperGGML semantics);
    a fresh `create_state()` per job — cheap, and states carry the abort callback + segment callbacks.
- **Open questions:** none yet.
- **Progress:** task.md → IN PROGRESS. Recon done; writing models.rs / local.rs next.

## [2026-08-23 01:05] session-1 (ox-alpha) — implementation complete
- **What I learned:**
  - **`lib.rs` does not declare `mod stt;`** (task-09 deferred registration too), so
    `cargo clippy/test -p scholiast --features local-stt` compiles whisper-rs as an unused dep but
    **never type-checks `stt/local.rs` or `stt/models.rs`** — the specified gate passes vacuously.
    Verified this concretely: first "green" clippy hid 8 real compile errors.
  - Verification harness (no forbidden files touched): `/tmp/opencode/stt-check/` mounts the REAL
    source files via `#[path = ".../src-tauri/src/stt/mod.rs"] pub mod stt;`, mirrors the feature
    set (`local-stt = [dep:whisper-rs, dep:sha2, dep:reqwest]`), and shares the project target dir
    (`CARGO_TARGET_DIR=scholiast_tauri/target`). All clippy+test gates below ran through it.
  - whisper-rs 0.14 API facts: `set_segment_callback_safe(F)/set_abort_callback_safe(F)` take
    `impl Into<Option<F>>` where F is 'static — pass the **bare closure** (not `Some(clo)`), and
    the segment hook must OWN its captures, so the partial hook travels as
    `Box<dyn FnMut(String)>` (`PartialHook` alias), not a borrowed `&mut dyn FnMut`.
  - std mpsc has no `UnboundedSender`; unbounded = plain `mpsc::channel()` types.
  - Real inference on this machine (debug build): tiny_en loads in ~0.5 s, transcribes a 2 s clip
    in ~3.9 s across N threads; silence/tone yields characteristic hallucinations ("(phone ringing)"
    for a 440 Hz sine).
- **Decisions made:**
  - Catalog = HuggingFace `ggerganov/whisper.cpp` GGMLs, SHA-256 pinned to HF LFS OIDs; the pin for
    `tiny_en` was independently confirmed by downloading the artifact this session (hash match).
    FUTO Models.kt ACFT pins recorded as provenance comments in models.rs (dead upstream).
  - One `WhisperContext` per model file cached on the worker thread (static `CONTEXT_CACHE`);
    fresh `WhisperState` per job (states own callbacks). Matches FUTO single-context semantics;
    per-job context creation avoided entirely.
  - Cooperative cancel: `Arc<AtomicBool>` checked inside whisper's abort callback (mid-decode),
    again in the segment callback (suppresses post-cancel partials), between download chunks, and
    pre-dispatch in the worker loop. Session ids registered in a static map; one cancel command
    covers transcription and downloads.
  - `InferenceBackend` trait seam defined locally in `local.rs` (task-10's shared `Transcriber`
    doesn't exist yet — NOT STARTED). Integration task should adapt `WhisperBackend` →
    `Transcriber` (VERBATIM cap) or swap the engine; the seam keeps mocks trivial.
  - Partial emission: `Job.partial_tx` channel hook; command layer passes `None` today so partials
    are logged via `eprintln!("stt://partial …")`. Real `stt://partial {sessionId,text}` event emit
    is deferred to lib.rs integration (as instructed). Download progress logged every ~10 MB the
    same way.
  - WAV reading hand-rolled RIFF chunk-walk (fmt validation: PCM/mono/16-bit/16 kHz; odd-chunk pad
    skip) mirroring recording.rs's writer — no hound dep, recording.rs untouched.
  - Ownership deviation (flagged for orchestrator): added `sha2 0.10` + `reqwest 0.13`
    (rustls, charset) alongside `whisper-rs`, all `optional = true`, referenced ONLY by the
    `local-stt` feature. Justification: `download_stt_model` + checksum verification are mandated
    deliverables and impossible without an HTTP client/hasher; both already sit in Cargo.lock via
    tauri, so default builds compile nothing new and the lock file gained entries only under the
    `[features] local-stt` closure (whisper-rs build chain).
- **Open questions:**
  - Active-model pref: spec'd to move JS-side via tauri-plugin-store later; commands currently take
    an explicit `model_path` param falling back to first-installed catalog model (tiny_en preferred).
    Settings UI (task-19) should write `stt.active_model` and pass it through.
  - When task-10 lands `Transcriber`, decide whether `InferenceBackend` folds into it or stays as
    the local engine adapter.
  - sherpa-onnx engine swap remains the documented pre-distribution TODO (FUTO Source First License
    1.1 — personal use only; also the ACFT models are FUTO-hosted).
- **Progress:** DONE. Files: `stt/local.rs` (worker+queue+cancel+WAV parse+commands+tests),
  `stt/models.rs` (catalog/checksum/installer+tests), `stt/mod.rs` (+2 gated lines, byte-exact
  otherwise), `Cargo.toml` (optional deps + default-off `local-stt`). Real-inference smoke RAN:
  output "(phone ringing)" from a synthetic tone — manual-smoke NOT pending.

### Gate results (final)
| Gate | Result |
|---|---|
| `cargo clippy -p scholiast -- -D warnings` | PASS (7.4 s warm; default build untouched) |
| `cargo clippy -p scholiast --features local-stt -- -D warnings` | PASS |
| `cargo test -p scholiast --features local-stt` | PASS (5 crate tests; STT modules not in crate tree until integration adds `mod stt;`) |
| harness `cargo clippy -p stt-check --features local-stt --tests -- -D warnings` | PASS (real check of stt/*.rs) |
| harness `cargo test -p stt-check --features local-stt` | PASS — 14/14 (11 new STT + 3 recording) |
| real smoke: tiny_en @ /tmp, 2 s tone wav | PASS — `"… -> \"(phone ringing)\""`, 3933 ms debug |
| pnpm lint/typecheck/vitest | UNTOUCHED — zero frontend files modified |

### Model catalog captured (exact)
| id | url | sha256 | size |
|---|---|---|---|
| tiny_en (default) | https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin | `921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f` | 77,704,715 |
| base_en | https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin | `a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002` | 147,964,211 |
| small_en | https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin | `c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d` | 487,614,201 |

FUTO provenance (Models.kt, files dead upstream — verified by android port): base_en_acft_q8_0 =
e9b4b7b8…caf1c8, small_en_acft_q8_0 = 58fbe949…bed3aa8; tiny_en was asset-only (no URL/hash).

### Build-time notes
- First `--features local-stt` build compiles whisper.cpp C++ via whisper-rs-sys (cmake + bindgen):
  1m50s wall (~285 s CPU) cold, on top of a warm tauri dep tree; incremental after that ≈ default.
  Test profile links add ~4m35s cold once. Default-feature builds stay at seconds (whisper chain
  never compiled without the flag).
- cargo builds share `scholiast_tauri/target` — lock waits are normal when agents build in parallel.

## [2026-08-23 21:58] session-1 addendum (ox-alpha) — concurrent-edit collision resolved
- **What happened:** while I was finishing gates, task-10's owner landed `Cargo.toml` edits that
  rewrote `[features]` (dropping `dep:reqwest` from `local-stt`), promoted `reqwest` to a required
  dep (keeping my `charset`+`rustls` features verbatim), and added `tempfile`/`wiremock`
  dev-deps. My `stt/*` files and `mod.rs` were untouched.
- **Resolution:** accepted their non-optional reqwest (so `local-stt = ["dep:whisper-rs",
  "dep:sha2"]` is now correct — referencing a non-optional dep would not compile); sha2/whisper-rs
  remain optional behind `local-stt`. All four gate lines re-run green on the merged manifest.
  Note for integration: default builds now always compile reqwest (task-10's call), whisper chain
  still stays out of default builds.

