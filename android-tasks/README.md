# Scholiast Android — Task Board

This folder is the **work board** for building the Scholiast Android tablet app.
Each subfolder is one independently executable task. Agents pick a task, read its
`task.md`, work in the `android/` codebase, and log their progress in the task's
sibling `LOG.md` while they work.

## How to work a task

1. **Read the plan first.** The single source of truth for the product is
   `../scholiast_mobile_app_plan.md` (repo root). Every `task.md` references its
   relevant plan sections — read them before writing code.
2. **Read this repo's `../AGENTS.md`** (repo root) for the desktop-extension
   conventions, and **`../android/AGENTS.md`** for the Android app's conventions.
3. **Claim a task.** Mark your task folder's `task.md` status to `IN PROGRESS`.
4. **Work in the `../android/` folder only.** Write code only in the package/file
   paths your `task.md` assigns you. Do not edit files owned by other tasks.
5. **Log as you go.** Appended to `LOG.md` in your task folder — see the
   "Agent logging protocol" below.
6. **Finish.** Set the task status to `DONE` (or `BLOCKED` with reasons), and
   leave a concise final summary in `LOG.md`.

## Agent logging protocol (IMPORTANT)

While working on a task, the agent **appends** entries to the task folder's
`LOG.md`. This is the project's memory: the next agent, the orchestrator, and the
user all read these logs to know what was decided, discovered, or stuck on.

Each `LOG.md` entry is a dated block in this exact format:

```
## [YYYY-MM-DD HH:MM] <agent/session id>
- **What I learned:** <key discoveries, gotchas, API details>
- **Decisions made:** <choices that affect the app's architecture/data>
- **Open questions:** <anything unresolved that needs the user or another task>
- **Progress:** <what was implemented / verified / tested>
```

Rules:
- Append; never rewrite or delete earlier entries.
- Keep it concise — bullet points, not essays. This is a log, not documentation.
- Record anything another task or the orchestrator would need to know.
- If you change a decision in the plan file, say so in your log entry.

## Task list (20 tasks)

| # | Task | Summary | Depends on |
|---|------|---------|------------|
| 01 | Project skeleton | Gradle, manifest, theme, navigation, MainActivity | — |
| 02 | Shared data model | DTOs, Room schema, JSON converters | — |
| 03 | URL normalization | normalizeUrl, videoId, urlHash | 02 |
| 04 | Home screen | recent grid, open-link, share intent | 02 |
| 05 | Player WebView bridge | player.html, JS bridge, chrome, capture | — |
| 06 | Note timeline | notes list, M:SS chips, item cards | 02 |
| 07 | Comment editor sheet | editor, mic+keyboard icons, save/cancel | 02 |
| 08 | Comment rendering | markdown → AnnotatedString | 02 |
| 09 | Voice recorder | tap-to-toggle, audio streaming, permissions | — |
| 10 | Groq + Gemini transcribers | API clients, prompts, voice-edit pipeline | 09 |
| 11 | Local STT (FUTO) | whisper.cpp JNI, wrappers, model mgmt | — |
| 12 | Transcript fetch/parse | innertube, cues, chunking, language | — |
| 13 | Transcript panel + annotate | live follow, swatch, highlight, comment | 02, 12 |
| 14 | Frame capture + MarkupView | draw tools, palm rejection, 4 comment paths | 05, 02 |
| 15 | Gemma OCR | OCR at save, ocrText storage | 14, 02 |
| 16 | Drive OAuth + Keystore | PKCE Custom Tab, token storage | 02 |
| 17 | Drive sync engine | merge port, REST client, golden tests | 16, 02 |
| 18 | Sync worker + status | WorkManager, retries, status UI | 17 |
| 19 | Settings window | speech, sync, playback, appearance, data | 10, 11, 16, 02 |
| 20 | Chat + flashcards (v1.1) | RAG chat, flashcard gen, export | 02, 15, 13 |

"Dependencies" are informational — they identify modules whose interfaces you
should respect. Agents still work in parallel; where a dependency isn't built
yet, code against the DTOs/interfaces defined in the plan and Task 02, and note
the assumption in your log.

## Build & test

- The app lives in `../android/`. Build with `./gradlew :app:assembleDebug` from
  that folder (first run downloads the toolchain).
- Run unit tests: `./gradlew test` · instrumented tests: `./gradlew connectedAndroidTest`.
- Golden tests for the sync merge must match the TS fixtures in `../shared/`.