# Task 19 — Settings window

Status: DONE (finalized 2026-08-20 by orchestrator)

## Objective
The separate Settings window (never on the player screen): speech (keys, prompts, models, speech language, local STT model management), sync, playback, appearance, data wipes, about.

## Scope — files you OWN (in `../android/app/src/main/java/com/scholiast/android/`)
- `ui/settings/SettingsScreen.kt` — the settings UI (grouped list, dark, Material 3)
- `ui/settings/SettingsViewModel.kt` — state + actions
- `ui/settings/SettingsPrefs.kt` — DataStore-backed `SpeechSettings` (implements Task 10's interface) + Keystore-secured secrets (implements Task 16's `TokenStore` where relevant); playback prefs; sync prefs
- `ui/settings/SettingsViewModelTest.kt` — tests

## References (read first)
- `../scholiast_mobile_app_plan.md`: §5.11 (the full settings spec), §5.5.6 (speech settings: keys, prompts, model IDs, speech language), §2 (keys in Keystore, settings in a separate window), §6.3 (Settings design), §9 M6
- Interfaces to implement/provide: Task 10's `SpeechSettings` (keys, prompts, model IDs, speechLanguage), Task 11's local STT model management, Task 16's `TokenStore` (reuse theirs, don't re-implement), Task 18's `SyncStatusRepository` + Drive disconnect, Task 15's Gemma model id

## Requirements
- **Speech section**: Groq key, Gemini/Gemma key (masked, show/hide, Test connection), model IDs (defaults `whisper-large-v3-turbo`, `gemini-3.6-flash`, Gemma OCR model), the two editable prompts (add-comment, edit-comment defaults from §5.5.6), **speech language** selector (default English — used by Groq Whisper + local STT), local STT model download/update/delete (checksum-verified, Task 11).
- **Sync section**: connect/disconnect Drive (runs Task 16's flow), **Sync now**, last-synced, storage used (local + Drive).
- **Playback section**: speed defaults, seek-step size (default 15), auto-pause-on-record toggle (always-on in v1 — show but disabled).
- **Appearance section**: theme is dark-only in v1; show the Material You choice (dynamic vs fixed purple fallback) with the fallback preview.
- **Data section**: Delete local data / Delete Drive data — typed-confirm dialogs (type `delete`), mirroring the desktop's destructive-wipe guards; routes to Task 16/17's wipe methods.
- **About**: version, links, privacy note (which data goes to which provider).
- All settings persisted in DataStore (non-secrets) + Keystore (secrets); survive rotation.

## Acceptance criteria
- Settings screen renders all sections; edits persist and reload.
- A Test connection button pings the configured providers (reuse Task 10's clients).
- Typed-confirm wipes work with the exact-count dialog.
- SpeechSettings implements Task 10's interface so the transcribers read live values.

## Agent notes
- Settings must not touch the player screen's layout — it's a separate route only.
- Coordinate with Task 16 (Drive connect UI triggers its OAuth flow; log the exact contract), Task 11 (model download UI triggers its manager), Task 18 (Sync now triggers its scheduler).
- Write your log to `LOG.md` as you work.