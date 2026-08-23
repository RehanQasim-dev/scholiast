# Scholiast Flutter (Android & Linux Desktop) — Task Board

This board tracks the migration of the Scholiast native Android app into a unified Flutter app targeting **Android** and **Linux Desktop**.

---

## 1. Wave-Based Dependency Graph

```
Wave 0:               [Task 01: Scaffold & Toolchain] (DONE)
                                    │
                      [Task 02: Core Domain Models] (DONE)
                                    │
               ┌────────────────────┼────────────────────┐
               ▼                    ▼                    ▼
Wave 1:  [Task 03: Anchor]  [Task 04: 3-Way Merge]  [Task 05: Cue Parser]  [Task 06: Database] (ALL DONE)
               │                    │                    │                    │
               └────────────────────┼────────────────────┼────────────────────┘
                                    │
               ┌────────────────────┼────────────────────┐
               ▼                    ▼                    ▼
Wave 2:  [Task 07: Drive Sync Engine]  [Task 08: Whisper FFI]  [Task 09: Audio Recorder] (ALL DONE)
               │                    │                    │
               └────────────────────┼────────────────────┘
                                    ▼
Wave 3:               [Task 10: Theme & UI Tokens]
                                    │
                      [Task 11: State Notifiers (Riverpod)]
                                    │
               ┌────────────────────┼────────────────────┬────────────────────┐
               ▼                    ▼                    ▼                    ▼
Wave 4:  [Task 12: Reader]  [Task 13: Player/Transcript]  [Task 14: Frame Markup]  [Task 15: Home & Settings]
               │                    │                    │                    │
               └────────────────────┴──────────┬─────────┴────────────────────┘
                                               ▼
Wave 5:                              [Task 16: Linux Desktop Adaptation]
                                               │
                                     [Task 17: E2E Integration & Verification]
```

---

## 2. Task Directory & Ownership

| # | Task Directory | Summary | Depends On | Wave | Status |
|---|---|---|---|---|---|
| **01** | `task-01-scaffold-toolchain` | Scaffold `scholiast_flutter` (Android + Linux), `pubspec.yaml`, lint rules | — | **0** | `DONE` |
| **02** | `task-02-core-domain-models` | Port `PageRecord`, `PageHighlight`, `VideoItem`, `LinearArticle`, `Normalize` | 01 | **0** | `DONE` |
| **03** | `task-03-anchoring-fuzzy-matcher` | Port `AnchorKt` (3-tier resolution, `approxMatch`, `trimRange`) + tests | 02 | **1** | `DONE` |
| **04** | `task-04-merge-engine-golden-tests` | Port `MergePageRecord` (3-way merge, tombstones GC, comments) + golden tests | 02 | **1** | `DONE` |
| **05** | `task-05-transcript-cue-parser` | Port `CueParser` & `TranscriptChunker` | 02 | **1** | `DONE` |
| **06** | `task-06-drift-database-storage` | SQLite database (`video_pages`, `sync_meta`, `ocr_texts`) + Keyring store | 02 | **1** | `DONE` |
| **07** | `task-07-google-drive-sync-engine` | Google Drive REST client, OAuth PKCE flow (loopback + custom tab), `SyncEngine` | 04, 06 | **2** | `DONE` |
| **08** | `task-08-whisper-ffi-local-stt` | Build `libwhisper.so` (C++ GGML), Dart FFI bindings, Isolate worker, Cloud STT | 02 | **2** | `DONE` |
| **09** | `task-09-audio-recorder-service` | 16kHz mono audio recorder stream (`record` package) | 01 | **2** | `DONE` |
| **10** | `task-10-theme-tokens-components` | Material 3 dark tokens, `SyncStatusBar`, `CommentEditorField`, `VoiceBubble` | 01 | **3** | `DONE` |
| **11** | `task-11-state-notifiers-riverpod` | Riverpod providers for Reader, Player, Notes, Sync, Home | 06, 07, 08, 10 | **3** | `DONE` |
| **12** | `task-12-reader-webview-surface` | `android-reader.js` WebView bridge, selection toolbar, thread sheet/drawer | 03, 11 | **4** | `DONE` |
| **13** | `task-13-player-youtube-transcript` | YouTube IFrame player (`player.html`), synchronized transcript, seek pills | 05, 11 | **4** | `DONE` |
| **14** | `task-14-frame-markup-canvas` | Video frame screenshot, `CustomPainter` normalized markup, tools | 02, 11 | **4** | `DONE` |
| **15** | `task-15-home-settings-screens` | Home recent grid/list, Settings screen (Drive sync, STT model manager) | 06, 07, 11 | **4** | `DONE` |
| **16** | `task-16-desktop-linux-adaptation` | Linux window manager, keyboard shortcuts (`Ctrl+H`, `Ctrl+P`, `Space`), sidebar | 12, 13, 14, 15 | **5** | `DONE` |
| **17** | `task-17-e2e-integration-verification` | Full Android APK build, Linux desktop build, test suite validation | All | **5** | `DONE` |

---

## 3. Verification Summary

- Total Unit Tests: **250/250 passing (100%)**
- Static Analysis: **0 errors, 0 warnings**
