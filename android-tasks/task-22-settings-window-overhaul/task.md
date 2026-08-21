# Task 22 — Settings window overhaul

**Status:** IN PROGRESS
**Owner:** this task only. Do NOT edit any file not listed under "Files you own".
**Depends on:** nothing blocking. Other tasks (21/22) run in PARALLEL — stay in your lane.

---

## 1. Context

Scholiast Android (`android/`) is a Kotlin + Jetpack Compose tablet app for YouTube
lecture annotation. Read `android/AGENTS.md` (operating manual) before starting.
The user reviewed screenshots of the Settings screen and demanded fixes. Decisions
below are FINAL — agreed with the user; do not relitigate them.

### Theme rule (critical, repo-wide)

The app theme uses `dynamicDarkColorScheme` on Android 12+ (`ui/theme/Theme.kt`), so
`MaterialTheme.colorScheme.primary` follows the device wallpaper (teal on the user's
tablet). A refactor is underway to kill every hardcoded accent:

- **NEVER write `AccentPurple` (or any hardcoded accent) in UI code.** Use
  `MaterialTheme.colorScheme.primary` (and `.copy(alpha = …)`; `colorScheme.onPrimary`
  for content on filled accents).
- Fixed highlight colors (`HighlightYellow/Red/Green`) are semantic and stay hardcoded.
- Most files are already migrated; yours still contains `AccentPurple` usages — remove
  them as specified below.

---

## 2. Files you own

| File | Role |
|------|------|
| `android/app/src/main/java/com/scholiast/android/ui/settings/SettingsScreen.kt` | The entire settings UI |

You may READ (never edit) `SettingsViewModel.kt`, `SettingsPrefs.kt`,
`SyncStatusBar.kt`, and the transcriber/domain classes to get state fields right.
Everything else is off-limits; note gaps in LOG.md instead of editing.

---

## 3. What to fix (exact spec)

### 3.1 The width cap is broken (the big one)

`SettingsScreen.kt:100-105`: the LazyColumn uses
`.fillMaxWidth().widthIn(max = 600.dp).wrapContentWidth(...)` — because
`fillMaxWidth()` runs FIRST, it forces min-width to the parent's max and the cap never
applies; on the tablet everything stretches edge-to-edge. Fix by reordering so the cap
constrains BEFORE filling, e.g.:

```kotlin
LazyColumn(
    modifier = Modifier
        .fillMaxHeight()
        .widthIn(max = 600.dp)
        .fillMaxWidth()
        .wrapContentWidth(Alignment.CenterHorizontally),
    …
)
```

The outer Box already has `contentAlignment = Alignment.TopCenter`. Verify the result
is a centered ≤600dp column with black margins on a wide screen.

### 3.2 Section headers read as links

`SettingsSectionTitle` is `titleSmall` + accent color — looks like a hyperlink.
Restyle: `MaterialTheme.typography.titleMedium`, color
`MaterialTheme.colorScheme.onSurface`, keep SemiBold, give it clear top separation
(e.g. top padding 12dp) so sections breathe.

### 3.3 Field labels glued to pickers

"Preferred Transcriber" / "Speech Language" labels sit flush on their dropdowns (same
item, no spacer). Add ~6dp spacing between label and field.

### 3.4 Raw enum leak in the transcriber picker

`TranscriberPicker` shows `selected.name` → "LOCAL". Map `TranscriberSource.entries`
(read the enum in `domain/transcribe/Transcriber.kt`) to friendly labels:
- LOCAL → "Local (on-device)"
- GROQ → "Groq Whisper (cloud)"
- GEMINI → "Gemini (cloud)"
(use the enum's real constant names). Both the selected display AND the menu items use
friendly labels; keep values as enum constants.

### 3.5 "(Default)" baked into language copy

`SPEECH_LANGUAGES` has `"English (Default)"`. Change the label to plain "English";
when it is the active selection show a small trailing "default" hint instead — simplest
faithful approach: label stays "English" and the picker's displayed value for null code
reads "English"; add a `labelMedium` "Default" suffix chip/text next to the field's
trailing icon is overkill — just render the value as "English" and rename the last
option's ordering note: keep "Auto-detect" as-is. Also fix the fallback branch at
~line 305 that hardcodes "English (Default)".

### 3.6 KeyField fixes

1. **Eye toggle inside the field**: move the visibility IconButton into the
   OutlinedTextField's `trailingIcon` slot (delete the external Row wrapper around
   field + button).
2. **Blank Save deletes the key**: `onSave(value.ifBlank { null })` means tapping
   "Save key" with an empty field REMOVES the stored key while labeled "Save".
   Disable the Save button when `value.isBlank()`.
3. Copy: label "Groq API key (cloud Whisper)" → "Groq API key (Cloud Whisper)".

### 3.7 Cloud transcriber without key → warn, don't block

User decision: options stay selectable; picking GROQ/GEMINI whose key isn't saved
shows an inline warning under the picker:
"Requires the Groq API key above." / "Requires the Google AI key above."
(`state.groqKeySet`, `state.geminiKeySet` already exist in the UI state; the Gemini
picker warning should reflect `state.geminiKeySet || state.gemmaKeySet` — same rule
the Google AI KeyField uses for its saved check.) Style: `bodySmall`,
`MaterialTheme.colorScheme.error` is acceptable here since it blocks functionality,
but prefer `colorScheme.onSurfaceVariant` with a small Warning icon — your call, be
consistent.

### 3.8 Unconfigured OAuth notice styled as error

`DriveSection`'s "This build has no OAuth client values…" text uses
`colorScheme.error` red — it's an expected dev-build state, not a failure. Restyle
neutral: `bodySmall` + `colorScheme.onSurfaceVariant`. Keep actual sync failures
(`lastError`, OFFLINE) red.

### 3.9 Destructive wipes → dialog confirmations

User decision: both wipes open a dialog stating exactly what will be deleted; the
DRIVE wipe additionally requires typing DELETE (desktop parity).

- Replace the inline two-step confirm buttons (`confirmLocal`/`confirmDrive` state)
  with dialogs:
  - Local: title "Delete local data?", body naming exactly what dies (all notes,
    highlights, drawings, video items, frame images on this device; settings and the
    Drive connection are kept; Drive data untouched), confirm "Delete" (error-colored),
    dismiss "Cancel".
  - Drive: same pattern + a TextField that must equal "DELETE" (case-sensitive) before
    Confirm enables; body states it deletes every synced page record, frame image and
    diagram blob from the app's Google Drive appdata folder; local annotations are
    untouched.
- While `busy`, BOTH trigger buttons are disabled (today only the armed one is).

### 3.10 Model section buttons

"Explore Models" / "Load .bin File" each stretch half the column via `weight(1f)` —
giant pills for secondary actions. Make both natural-width (remove weight; keep the
8dp row spacing, height 44dp) inside the existing Row; add `Arrangement.Center` or
keep start-aligned — match the card's left-aligned rhythm (start-aligned).

### 3.11 Active-model accents

Lines ~380/386/391/440 use `AccentPurple` (active model name, ACTIVE badge bg/text,
installed-list "Active" label) → `MaterialTheme.colorScheme.primary` variants. Delete
the import.

### 3.12 Sanity checks

- `grep -n AccentPurple SettingsScreen.kt` → no hits.
- No hardcoded accent colors anywhere in the file.
- Match surrounding comment density/idioms; don't reflow unrelated code.

---

## 4. Build & verify (compile only)

From `android/`:

```bash
./gradlew :app:compileDevDebugKotlin --console=plain
```

- May take minutes on first run (native build hooks); timeout ≥600s.
- Another agent may be building concurrently — Gradle queues on project locks; if it
  waits, retry once.
- Do NOT run `assembleDevDebug`, tests, or install to Waydroid — the orchestrator does
  that after both tasks land.

## 5. Logging protocol (REQUIRED)

Append dated entries to `LOG.md` (this folder) WHILE working, format:

```
## [YYYY-MM-DD HH:MM] task-22 agent
- **What I learned:** …
- **Decisions made:** …
- **Open questions:** …
- **Progress:** …
```

Append-only. Finish with a final summary entry.
