# AGENTS.md — Scholiast for Android Tablet

This file is the operating manual for agent work on the **Scholiast Android app** — the
native Kotlin + Jetpack Compose companion to the Scholiast browser extension. It sits in
the app's code folder (`android/`) and is the single source of truth for *how agents work
here*: what the app is, what the plan is, how the task board works, the architecture,
conventions, and the logging protocol. Read this file before writing any code in this
folder.

---

## 1. What this app is

Scholiast is a browser extension (Chrome MV3 / Firefox / Safari) that clips web pages to
Obsidian and adds a lecture-note workflow on YouTube: live transcript annotation,
timestamped comments, frame capture and drawing, and Google Drive sync. The desktop
extension's full architecture is documented in the repo-root `AGENTS.md` — read it too.

This folder is the **Android tablet app**: a native Kotlin + Jetpack Compose application
targeting Samsung Galaxy Tabs with an S-Pen, Android 11+ (API 30), that brings the same
YouTube lecture-note workflow to a tablet that sits on a desk in a lecture hall. It is

- **Keyboard-less first** — voice is the primary text input; the OS keyboard is opt-in
  via a small keyboard icon next to the mic inside comment fields (focus alone never
  opens it).
- **Stylus-native** — S-Pen pressure and hover-based palm rejection on drawing surfaces.
- **Dark by default** — black/very-dark surfaces, Material You dynamic accent (purple
  `#8B7CF6` fallback), fixed highlight colors that match the desktop extension.
- **Offline-aware** — a local whisper.cpp speech-to-text engine works offline; cloud
  features are dimmed/disabled when the network is gone.
- **Data-compatible with the desktop extension** — identical JSON schema, identical
  Google Drive layout (`pages/page-<urlhash>.json` + frame blobs), identical 3-way merge
  rules. Data moves freely between desktop and tablet.

The product plan is `../scholiast_mobile_app_plan.md` (repo root). It specifies every
feature's behavior, the data model, the design system, milestones, and risks. **It is the
authority.** When a task.md and the plan disagree, the plan wins unless a task log records
a deliberate, user-approved deviation.

---

## 2. How work is organised here

### 2.1 The task board

All work is driven from `../android-tasks/` (repo root). That folder contains one
subfolder per task, numbered `task-01-project-skeleton` through `task-20-chat-flashcards`.
Each task folder contains:

- `task.md` — what the task builds, the exact files it owns, the plan sections to read,
  acceptance criteria, and agent-specific notes.
- `LOG.md` — the agent's work log for that task (see §4).

Agents run **in parallel**, one agent per task. Each agent is responsible for only the
files its `task.md` assigns to it. Do not edit files owned by another task.

### 2.2 Dependencies

Dependencies between tasks are informational, not blocking. They identify modules whose
*interfaces* you must respect. If a dependency isn't built yet, code against the interface
defined in the plan and the task.md, stub the missing pieces, and note the assumption in
your `LOG.md`. A final integration pass reconciles the modules.

Key dependency spine:

- **Task 02 (data model)** is the contract — its DTOs and repository interfaces feed
  tasks 04, 06, 07, 08, 13, 14, 15, 17, 20.
- **Task 05 (player bridge)** feeds 06, 09, 13, 14 (seek, time, capture).
- **Task 09 (recorder)** feeds 10 and 11 (they consume its samples/WAV).
- **Task 10 (speech settings interface)** is implemented by 19.
- **Task 14 (frame + OcrHook)** is implemented by 15.
- **Task 16 (Drive auth/API)** is consumed by 17, and its TokenStore by 19.
- **Task 17 (sync engine)** is scheduled and surfaced by 18.

### 2.3 Status flow

A task's status lives at the top of its `task.md`: `NOT STARTED` → `IN PROGRESS` →
`DONE` or `BLOCKED (reason)`. Update it as you work.

---

## 3. The app's architecture (in brief)

Full detail is in the plan (§3). The mental model:

```
Compose UI (screens)  →  ViewModels (StateFlow)  →  Domain layer  →  Data layer
  home / player /          voice / transcript /        merge / drive /    Room / files /
  notes / transcript /     draw / ocr / study /        voice / sync       DataStore /
  frame / settings         sync                                          Keystore
                                                                        + native C++ (whisper)
```

- **Player**: a `WebView` hosts the YouTube IFrame Player API (`app/src/main/assets/player.html`).
  All media playback and frame capture happen inside the WebView; all chrome (play/pause,
  seek, −15s/+15s, Closed Captions/subtitles toggle with high-contrast text rendering, speed, fullscreen) is Compose overlay.
  The landscape screen features a draggable resizable split panel between video and notes/transcript,
  and note creation/replies automatically pause playback and resume upon saving. A `JavascriptInterface`
  bridge carries events out and commands in.
- **Notes & Transcript UX**:
  - **Transcript**: Paragraph cards with rounded borders, clickable `[M:SS]` timestamp seek pills,
    karaoke-style active spoken cue highlights in bold white, "● Playing" status, and smooth auto-scrolling
    following live playback.
  - **Notes & Comment Editor**: Floating modal dialog with no swipe drag-handle, prominent primary "Create note"
    button in the empty state, standard Material microphone icon with recording ring animation, formatting bar with
    inline code `<>` button and tooltips, and high-contrast disabled Save states.
  - **Settings**: Responsive capped width (max 600dp) for clean tablet layout, dropdown menus for Speech Language
    and Preferred Transcriber, simplified single Explore & single Import model actions with active engine status badge,
    and distinct destructive red styling for data wipes.
- **Data**: kotlinx.serialization DTOs that mirror the desktop TypeScript types
  byte-for-byte (`VideoItem`, `VideoMarkup`, `PageRecord`, …). Room stores per-page JSON
  blobs + OCR text + sync metadata. Frame JPEGs are real files in `filesDir/frames/`,
  never inline bytes. Secrets (API keys, Drive tokens) live in the Android Keystore.
- **Voice**: a tap-to-toggle recorder streams 16 kHz PCM on background IO (ported from the FUTO Keyboard's
  `AudioRecognizer`), feeds either Groq Whisper (online), Gemini (online, prompt-aware), or
  the local whisper.cpp engine (offline). A Gemini voice-edit pipeline offers preview →
  Accept/Discard.
- **Sync**: per-page Google Drive sync (appdata folder) with a 3-way merge ported from
  `shared/merge.ts`. Golden tests pin byte-compatibility with the TypeScript output.
- **Local STT**: whisper.cpp/GGML vendored from the cloned FUTO Keyboard
  (`../android-keyboard/`), compiled via CMake/JNI as `libscholiast_whisper.so`. Models are
  ACFT-quantized GGML files downloaded from keyboard.futo.tech with SHA-256 verification.
  License: FUTO Source First 1.1 — personal/sideloaded use only.

### 3.1 Package map

```
com.scholiast.android/
├── MainActivity.kt
├── ui/            theme/ navigation/ home/ player/ notes/ transcript/ frame/ voice/ settings/ sync/ components/
├── player/        PlayerWebView.kt  PlayerBridge.kt  assets/player.html
├── data/          model/  db/  normalize/  notes/  frames/  prefs/
├── domain/        transcript/  voice/  edit/  draw/  ocr/  study/  sync/{merge,drive,worker}/
└── util/          logging, time formatting (M:SS), haptics
```

### 3.2 Conventions

- **Kotlin + Jetpack Compose (Material 3, adaptive), Coroutines + Flow.**
- kotlinx.serialization with `@SerialName` where field names must match the TS JSON.
- Pure logic separated from Android dependencies wherever possible (JVM-testable).
- Suspend functions for all IO; StateFlow for UI state; ViewModels own state, composables
  render it.
- Match the existing desktop code's naming and idioms where you port logic — read the
  referenced TS file before porting.

---

## 4. The agent logging protocol (REQUIRED)

**Every agent must log to its task's `LOG.md` while working, not just at the end.** This
is the project's memory. The orchestrator, other agents, and the user read these logs.

While you work, append dated entries in this exact format:

```
## [YYYY-MM-DD HH:MM] <agent/session id>
- **What I learned:** <key discoveries, gotchas, API details, source-code findings>
- **Decisions made:** <choices that affect architecture/data/interfaces>
- **Open questions:** <unresolved items for the user or another task>
- **Progress:** <what was implemented / verified / tested>
```

Rules:

1. **Append only.** Never rewrite or delete earlier entries.
2. **Concise bullets, not essays** — this is a log, not documentation.
3. Record anything another task or the orchestrator would need: interface signatures,
   dependency gaps you stubbed, plan deviations, build commands that worked, test failures.
4. If you change a decision or find the plan wrong, say so in your log entry — do not
   silently diverge.
5. When you finish, set your `task.md` status and write a final summary entry.

---

## 5. Build, test, run, and install

- The app module is `android/app`. From `android/`:
  - **Always build `dev` version**: Always build the development flavor by default (`./gradlew assembleDevDebug`) unless the user explicitly asks for the `prod` version. Output APK: `app/build/outputs/apk/dev/debug/app-dev-debug.apk`.
  - **Auto-install to Waydroid**: Whenever you build an APK after changes, ALWAYS run:
    ```bash
    waydroid app install app/build/outputs/apk/dev/debug/app-dev-debug.apk
    ```
    (or using absolute path `waydroid app install <repo-root>/android/app/build/outputs/apk/dev/debug/app-dev-debug.apk`)
    so that the updated app is automatically installed in Waydroid for the user.
  - **Testing**: **Do NOT run the entire test suite repeatedly** (`testDevDebugUnitTest` or all tests across the app take a lot of time and waste user time). Run ONLY the specific targeted test class or method that is affected by your changes:
    ```bash
    ./gradlew testDevDebugUnitTest --tests "com.scholiast.android.player.PlayerViewModelTest"
    ```
  - **Build Timestamp Indicator**: The app exposes `BuildConfig.BUILD_TIME` in `build.gradle.kts` and displays `Build: <timestamp> (<version>)` in the bottom-left corner of the Home screen so the user can immediately verify the active installation.
  - Native (whisper): compiled automatically by the Gradle build via CMake; needs the NDK (see `app/build.gradle.kts` / `libs.versions.toml`).
  - Sync golden tests compare Kotlin merge output to the TS fixtures in `../shared/` — run only `MergePageRecordTest` when touching `domain/sync/merge/`.

---

## 6. Non-negotiable rules

- **Never commit secrets.** API keys, OAuth client secrets, tokens — placeholders only;
  real values come from `../oauth.local.json` or user Settings at runtime.
- **Never put image bytes in JSON.** Frames and diagram images are files/blobs referenced
  by id.
- **Keep the Drive layout byte-compatible.** Field names, file names, and merge semantics
  match the desktop repo exactly.
- **Do not edit files owned by another task** — note gaps in your `LOG.md` instead.
- **Respect the plan.** Deviations require a logged reason and, where product-affecting,
  user sign-off.
- **The player screen stays clean.** No settings controls on the watch interface.

---

## 7. Current state

The app code in this folder is being built task by task from the task board. Until the
first task lands, this folder may contain only this file. Check each task's `LOG.md` for
what has been built and what is stubbed. The plan file (`../scholiast_mobile_app_plan.md`)
records the full product spec and the milestone map (M0–M6 + v1.1).

Milestones in brief: M0 skeleton+Home · M1 player+notes · M2 voice (Groq/Gemini/local) ·
M3 transcript · M4 frames+OCR · M5 Drive sync · M6 settings+polish · v1.1 chat+flashcards.
---

## 8. Managing implementation agents (orchestrator playbook — hard rules)

Lessons distilled from the tasks 23–33 orchestration. Every rule here exists because its
violation cost a re-do; treat them as binding, not advisory.

### 8.1 How subagents actually behave

- **Empty final messages are NORMAL and do NOT mean "did nothing".** Agents frequently write
  files silently, then truncate or drop their report. ALWAYS verify on disk before judging:
  task.md `Status:`, LOG.md line count, `ls` of the files the task owns.
- **They stall mid-task** — long thinking phases end in cut-off one-liners ("Now build:",
  "Rewriting it cleanly…"). This is a pause, not a failure.
- **They cannot see the orchestrator's conversation.** A prompt without exact paths, signatures,
  and commands produces guesswork.

### 8.2 The resume protocol (the single most important skill)

- **NEVER take over an agent's task yourself once it is handed off** — not after one empty
  reply, not after three. The orchestrator doing the work silently robs the agent of context
  and breaks the logging trail. The only exception: the user explicitly orders it.
- **Resume the SAME session** (`task_id`) as many times as needed. An agent that looked dead
  for four resumes has finished on the fifth. Expected resume counts per task: 1–6+.
- **Before every resume, check what landed on disk**, then open with: what is ALREADY done
  ("do NOT redo X"), what remains, step by step. Never make it re-read finished work.
- **Nudge phrasing that works:** "Proceed to implementation NOW", "you have thought enough —
  act", "your next output must contain tool calls that write code", "think briefly, act much".
  Discourage further analysis explicitly when an agent keeps returning planning text.
- **Give numbered order-of-work lists** — file-by-file, exact signatures, exact build/test
  commands. Vague nudges get vague silence; concrete step 1 gets tool calls.
- **Handoff protocol:** if any work happened outside the agent (orchestrator, user, another
  agent), the resume prompt MUST itemize it file-by-file — including breakages left
  intentionally — so nothing is redone or conflicts.

### 8.3 Rules for every launch prompt

- **Self-contained always**: spec path, plan sections to read, EXACT public API signatures from
  prior tasks' LOG.md files, build/test/install commands, environment quirks already fixed.
- **Minimal tests only** (user mandate): "only write minimal tests, the most necessary ones, not
  any unnecessary ones." One line per launch prompt; never let an agent grow a test suite for
  its own sake.
- **Always include**: "Report progress EVERY response even mid-work — NEVER return an empty
  final message" and "Final message MUST include build outcome + test counts + deviations."
- **Carry environment fixes forward** in the prompt (e.g., the pinned JDK in
  `gradle.properties`) so later agents don't rediscover solved problems.
- **File ownership is sacred**: parallel agents own disjoint file lists from their task.md;
  cross-file edits are forbidden (log-and-request instead). Integration into shared files
  belongs exclusively to the final integration task.

### 8.4 Orchestration structure

- **Wave-based parallelism**: one small baseline/contract task first (models, interfaces,
  migration), then fan out only genuinely independent tasks in parallel (2–4 at a time),
  dependency graph written into `../android-tasks/README.md`. Later waves start only when the
  wave they depend on is DONE on disk (statuses verified, not assumed).
- **Wave agents skip Waydroid installs** — only the final integration/verification task builds,
  installs, and runs the on-device checklist (avoids install thrash between parallel agents).
- **Verify independently at the end**: statuses read, one clean `assembleDevDebug`, targeted
  test suites green — trust but confirm, agents' self-reports have been wrong about tests.
