# LOG — task-22-settings-window-overhaul

## [2026-08-21 12:16] task-22 agent
- **What I learned:** `TranscriberSource` enum constants are `LOCAL`/`GROQ`/`GEMINI`
  (`domain/transcribe/Transcriber.kt:54`). UI state already carries everything needed:
  `groqKeySet`, `geminiKeySet`, `gemmaKeySet`, `busy`, `preferredTranscriber`,
  `speechLanguage`, `activeSttModel`. The width-cap bug is real: `.fillMaxWidth()`
  before `.widthIn(max=600.dp)` makes min-width = parent max, so the cap never binds.
  Dialog pattern to follow lives in `ui/notes/NotesTab.kt:221` (AlertDialog +
  error-colored TextButton confirm + Cancel dismiss).
- **Decisions made:** §3.7 warning style → `onSurfaceVariant` bodySmall with a small
  `Icons.Filled.Warning` (spec's stated preference over red). Gemini warning condition
  mirrors the KeyField saved-check: `geminiKeySet || gemmaKeySet`, computed at the
  call site and passed into `TranscriberPicker` as booleans. Friendly transcriber
  labels via a private `transcriberLabel()` when-mapping; values stay enum constants.
  Wipe dialogs replace the armed-button state entirely (`confirmLocal`/`confirmDrive`
  become dialog visibility flags); Drive dialog gates its Delete on a case-sensitive
  "DELETE" text field. Model buttons keep start alignment (card rhythm).
- **Open questions:** none blocking.
- **Progress:** spec read, file read, starting edits on SettingsScreen.kt only.

## [2026-08-21 12:19] task-22 agent
- **What I learned:** Wipe dialogs render fine outside the Card (AlertDialog is
  window-level); Drive dialog's `confirmText` state declared inside its `if` block so it
  resets each open. KeyField's external Row wrapper removed cleanly — trailingIcon slot
  takes the eye toggle.
- **Decisions made:** Local wipe dialog body names exactly: notes, highlights,
  drawings, video items, frame images; settings + Drive connection kept; Drive untouched.
  Drive dialog body: every synced page record, frame image + diagram blob from appdata;
  local annotations untouched. Both dialogs follow NotesTab's pattern (error-colored
  "Delete" TextButton + "Cancel"). Trigger buttons keep their red-outline style, now
  always visible and both disabled while `busy`.
- **Open questions:** none.
- **Progress:** All §3.1–3.11 edits applied to SettingsScreen.kt only. Sanity checks
  pass: zero AccentPurple / hardcoded Color(0x…) hits. Starting compile.

## [2026-08-21 12:24] task-22 agent
- **What I learned:** Two build blockers found while compiling:
  1. ENV: system default JDK is Java 25 (`25.0.3`); Gradle 8.11.1's Kotlin compiler
     throws `IllegalArgumentException: 25.0.3` at `JavaVersion.parse`. Fix without
     touching any file: `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew …`.
     JDK 17/21 are installed under /usr/lib/jvm. gradle.properties pins no java.home.
  2. MINE: dialog state vars were declared inside the Card's Column lambda but the
     AlertDialogs sit outside the Card → `Unresolved reference 'showLocalDialog'`.
     Fixed by hoisting both `remember` states to the top of DataSection's body.
  3. NOT MINE: `ui/notes/editor/CommentEditorSheet.kt:262-267` fails with
     `Unresolved reference 'TextButton'` (+2 composable-context errors) — that file
     belongs to the parallel Task 21; per lane rules I did not touch it.
- **Decisions made:** Used JAVA_HOME override on the command line only (no gradle.properties
  edit — off-limits).
- **Open questions:** Full-module compile stays red until Task 21 fixes
  CommentEditorSheet.kt; my file must show zero errors of its own.
- **Progress:** Scope fix applied; recompiling.

## [2026-08-21 12:24] task-22 agent — FINAL SUMMARY
- **What I learned:** Kotlin's compile diagnostics list every broken file in the module,
  which lets me prove my file is clean even when a sibling task's file is not.
- **Decisions made:** All §3 items implemented as specified; no spec deviations.
- **Open questions:** Module-wide `:app:compileDevDebugKotlin` stays red ONLY due to
  `ui/notes/editor/CommentEditorSheet.kt:262-267` (`Unresolved reference 'TextButton'`
  ×2 + 2 composable-context errors) — owned by parallel Task 21, untouched by me per
  lane rules. Orchestrator should have Task 21 add the missing
  `androidx.compose.material3.TextButton` import / fix its dialog block; once landed the
  module should go green since SettingsScreen.kt contributes zero diagnostics.
  Also note for everyone building here: default JDK is Java 25 and breaks Gradle 8.11.1 —
  prefix builds with `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64`.
- **Progress:** DONE (my scope). Implemented in SettingsScreen.kt ONLY:
  §3.1 width cap fixed via modifier order (widthIn → fillMaxWidth → wrapContentWidth);
  §3.2 section titles → titleMedium/onSurface/SemiBold + 12dp top padding;
  §3.3 6dp spacer between picker labels and fields;
  §3.4 transcriberLabel() maps LOCAL/GROQ/GEMINI → "Local (on-device)"/"Groq Whisper
  (cloud)"/"Gemini (cloud)" for both selected display and menu items;
  §3.5 "English (Default)" → "English" in SPEECH_LANGUAGES + fallback branch;
  §3.6 eye toggle moved into OutlinedTextField trailingIcon (external Row deleted),
  Save disabled while value blank, label → "Groq API key (Cloud Whisper)";
  §3.7 inline missing-key warning under picker (Warning icon + bodySmall +
  onSurfaceVariant; Gemini condition = geminiKeySet || gemmaKeySet);
  §3.8 unconfigured-OAuth notice → onSurfaceVariant (ERROR/OFFLINE stay red);
  §3.9 wipe confirms → AlertDialogs (local confirm; Drive requires typing DELETE,
  case-sensitive), both trigger buttons disabled while busy;
  §3.10 model buttons natural-width (weight removed, 44dp height, 8dp gap, start-aligned);
  §3.11 active-model accents → colorScheme.primary (+ .copy(alpha=0.2f) badge bg);
  AccentPurple import deleted. Sanity checks: no AccentPurple, no hardcoded Color(0x…).
  Compile: my file clean (0 diagnostics); module red only from Task 21's file (above).
