# 01: Settings Screen & Configuration Groups

**What to build:** Settings Screen & Configuration Groups

**Blocked by:** None

**Status:** completed

- [x] Speech, sync, playback, appearance, and data management settings cards (Invariants 1, 2, 3)

## Scope & Implementation Notes
# Task 19: Settings Screen

Status: DONE
Wave: 4
Depends on: task-10, task-11, task-16, task-02

## Scope & Owned Files
- `scholiast_tauri/src/routes/Settings.tsx` — grouped sections, capped-width column, dark tokens:
  - **Speech**: Groq/Gemini key fields (set-once via keyring commands, show "configured" state + Test buttons), model-id fields, speech-language select (default English), prompt editors (`prompt.add_comment`, `prompt.edit_comment`) with restore-defaults, local-model manager UI (list/download/activate/delete + active badge)
  - **Sync**: connect/disconnect, status card slot (task-18), storage used
  - **Playback**: default speed, seek-step size
  - **Appearance**: density toggle; dark-only note
  - **Data**: Delete local data / Delete Drive data — typed confirmation naming exact counts (commands `wipe_local_data`, `wipe_drive_data` implemented here against store + Drive REST)
  - **About**: version (tauri getVersion), privacy note (what goes to Groq/Gemini/Drive)
- All prefs through the typed store facade (`src/lib/store.ts`); Rust-side writes emit `store://changed`

## Acceptance Criteria
- Component tests: section render, prompt edit persistence, wipe confirm gating
- Manual gate: keys set → Test buttons green; wipes guarded

## Notes
Player screen stays clean — nothing playback-related lives here beyond defaults.


## Execution History & Log
# Task 19 — Settings screen (LOG)

## Status: DONE

## Final gates (all green)
- `pnpm lint` ✓ · `pnpm typecheck` ✓ · `pnpm vitest run` ✓ (17 files / 116
  tests, includes the 9 new ones)
- `cargo clippy --workspace --all-targets -- -D warnings` ✓ clean (after a
  sibling's in-progress `drive/rest.rs` + `store/assembly.rs` settled; all
  intermediate failures were in those files, none in mine — see below)
- `cargo test --workspace` ✓ every suite 0 failed, incl.
  `commands::settings::tests::*` ping tests

## What was built

### Rust (`src-tauri/src/commands/`)
- **`settings.rs`** (new):
  - `get_prompt_defaults` → `{ addComment, editComment }` straight from the
    `stt/cloud.rs` consts `ADD_PROMPT_DEFAULT` / `EDIT_PROMPT_DEFAULT`
    (single source of truth, plan §6.5.6).
  - `stt_test_groq` / `stt_test_gemini` — tiny inline reqwest clients pinging
    each provider's cheapest authenticated endpoint (Groq `/openai/v1/models`
    with bearer; Gemini `/v1beta/models` with `x-goog-api-key`). Keys come from
    the OS keyring via the existing `KeyringProvider`; missing key and network
    failure are *data* (`TestResult { ok, detail }`), not IPC errors. Provider-
    agnostic on failure (never names the vendor), mirroring `stt/cloud.rs`.
    3 unit tests (no key / blank key / dead host).
- **`data.rs`** (new):
  - `data_stats` → `{ videos, items }` counts for the typed-confirm dialog.
  - `wipe_local_data` — DELETE from all 12 tables in FK-safe order, clears
    contents of `app_data_dir/{frames,voice,models}`, removes recorded diagram
    PNG paths before the diagrams table drops them. Keyring + `settings.json`
    prefs are kept.
  - `wipe_drive_data` — lists + deletes every file in Drive appDataFolder via
    the public `drive::access_token()` token provider (task-16). Returns the
    deleted count. No duplication needed: `drive::access_token` IS public.
- **Registrations**: appended `commands::data::{data_stats,wipe_local_data,
  wipe_drive_data}` + `commands::settings::{get_prompt_defaults,stt_test_groq,
  stt_test_gemini}` at the END of `lib.rs`'s `generate_handler!`; added
  `pub mod data; pub mod settings;` to `commands/mod.rs` (existing lines kept
  in place).

### Frontend
- **`src/lib/store.ts`** (new) — typed prefs facade over
  `@tauri-apps/plugin-store`. File name **`settings.json`** matches task-10's
  Rust read (`app.store("settings.json")`, stt/cloud.rs:409); dotted keys match
  its `PREF_*` consts exactly: `stt.groq_model`, `stt.gemini_model`,
  `prompt.edit_comment` (+ symmetric `prompt.add_comment`), plus
  `speech.language`, `stt.local_model`, `playback.default_speed`,
  `playback.seek_step`, `appearance.density`. Defaults table mirrors the Rust
  consts (whisper-large-v3-turbo / gemini-flash-latest / en / 1× / 10 s /
  comfortable). Test seam: `setPrefsStoreForTests`.
- **`src/components/settings/`**:
  - `usePref.ts` — load-once/persist-on-change hook.
  - `SpeechSection.tsx` — Groq/Gemini rows: password input + Save via
    `set_secret`, existence-only "configured ✓" chip via `get_secret_status`
    (values never displayed or returned), Test buttons → ping commands with
    ✓/✗ chips; model-id inputs + speech-language select (12 languages, en
    default) bound to prefs.
  - `PromptsEditor.tsx` — two textareas persisting on change; per-prompt
    Restore-default buttons through `get_prompt_defaults`.
  - `ModelManagerSection.tsx` — `list_stt_models`; IPC failure renders the
    "not built into this install" hint (feature-gated `local-stt`); Active
    badge from `stt.local_model`; Download button with progress-text state;
    click-to-activate.
  - `PlaybackSection.tsx` — speed 0.25–2×, seek step 5/10/15/30 s.
  - `AppearanceSection.tsx` — density select + dark-only note.
  - `DataSection.tsx` — both wipe actions behind a dialog requiring the exact
    word "delete"; local dialog shows live `data_stats` counts; Drive dialog
    shows no count beforehand (listing costs an API round-trip), reports the
    deleted-file count after the wipe instead — as specified.
  - `AboutSection.tsx` — `getVersion()` + privacy note (what goes to Groq /
    Gemini / Drive).
- **`src/routes/Settings.tsx`** rebuilt: capped `max-w-3xl` column, uppercase
  group headers (Speech · Prompts · Local models · Sync · Playback ·
  Appearance · Data · About), all styling via existing dark tokens
  (`surface/elevated/hairline/text-2/accent/--sc-danger`). The task-16
  `<DriveSection/>` is preserved verbatim under Sync.

### Shared-file edits (integration notes)
- **`src-tauri/capabilities/default.json`**: added `store:default` — required
  for the JS plugin-store API to reach `settings.json`. Not owned by any task;
  flagged here for the orchestrator.

### Tests
- `src/lib/store.test.ts` — fallback when unset, defaults table, set/get
  round-trip under dotted keys, overwrite.
- `src/components/settings/PromptsEditor.test.tsx` — edit persists to pref
  store; restore-default loads injected defaults and saves them.
- `src/components/settings/DataSection.test.tsx` — confirm gating (disabled
  until "delete" typed; counts shown), drive count reported only after wipe,
  cancel invokes nothing.

## Deviations / notes
- **Workspace clippy/test were temporarily blocked by sibling files**:
  `crates/core/src/merge.rs` (E0277/E0382, later fixed by its owner) and then
  `src-tauri/src/drive/rest.rs` + `src-tauri/src/store/assembly.rs` (mid-
  integration dead-code + unresolved imports). I did NOT touch any of them;
  polled until their owner's integration landed and the full-workspace gates
  went green. Zero gate failures ever referenced task-19 files after my two
  fixes below.
- Two of my own clippy fixes during bring-up: removed an unused `Arc` import;
  this workspace builds reqwest with `default-features = false`, so
  `RequestBuilder::query()` / `Response::json()` don't exist — data.rs builds
  the Drive list URL manually (percent-encoded fixed params) and parses via
  `text()` + `serde_json::from_str`, matching the codebase idiom in auth.rs.
- **Diagram PNG cleanup detail**: the plan said "remove … diagrams … dir", but
  diagram PNGs are stored at arbitrary recorded paths (`diagrams.png_path`),
  not one directory — wipe deletes those recorded files instead of a fixed dir,
  which is strictly more correct. Frames/voice/models are cleared as dirs.
- Drive wipe reuses the public `drive::access_token()` directly — no duplicated
  refresh code was necessary, so no dedupe follow-up is owed.
- The manual gate ("keys set → Test buttons green") needs a real keyring +
  network; automated coverage asserts command wiring and UI states instead.

