# Scholiast Tauri — Task Board

Work board for building the Scholiast desktop/mobile app on **Tauri v2 + React + TypeScript + Rust**.
Each subfolder is one independently executable task: read its `task.md`, work in `../scholiast_tauri/`,
log progress in the sibling `LOG.md`.

**Product & architecture authority:** `../scholiast_tauri_app_plan.md` (consolidates the full
feature spec from `scholiast_mobile_app_plan.md` + Reader plan onto the new stack).
**Reference implementations for ports:** native Android app (`../android/`) and the browser
extension (`../src/utils/*`, `../shared/*`).

## How to work a task

1. Read the plan sections your `task.md` cites **before writing code**.
2. Read `../AGENTS.md` §8 (orchestrator/agent playbook — binding) and, once created,
   `../scholiast_tauri/AGENTS.md` for app conventions.
3. Set your `task.md` status to `IN PROGRESS`, then work **only** in the files it owns.
4. Append to `LOG.md` as you go (format below); finish by setting `DONE`/`BLOCKED` + final summary.
5. Quality gates: `cargo clippy -D warnings && cargo test` for Rust tasks;
   `pnpm lint && pnpm typecheck && pnpm vitest run` for frontend tasks; both where mixed.
   Minimal tests only — no suite-growing (user mandate).

### Agent logging protocol

```
## [YYYY-MM-DD HH:MM] <agent/session id>
- **What I learned:** …
- **Decisions made:** …
- **Open questions:** …
- **Progress:** …
```

Append-only, concise bullets. Record interface signatures and dependency gaps — later waves
code against what your log documents.

## Core app — tasks 01–20

| # | Task | Summary | Depends on | Wave |
|---|------|---------|------------|------|
| 01 | Project scaffold | pnpm/Vite/React-TS + Tauri v2 workspace (`crates/core`, `crates/server`), tokens.css, router shell + sidebar, AGENTS.md | — | 0 |
| 02 | Domain models (Rust) | serde structs pinned to extension JSON (`VideoItem`, `PageRecord`, highlights, strokes, diagrams), sqlx schema v1 | 01 | 1 |
| 03 | URL normalization | `core::normalize`: normalizeUrl/urlHash/videoId/genVideoId + test vectors | 02 | 1 |
| 04 | Home screen | open-link hero, recent grid (thumbnails, counts, resume), deep-link entry | 02 | 2 |
| 05 | Player bridge | `PlayerHost` IFrame-API component, chrome overlay, canonical event/command contract | 01 | 1 |
| 06 | Note timeline | item cards, `M:SS` seek chips, thread previews, ordering | 02 | 2 |
| 07 | Comment editor sheet | light-markdown editor, `#tag` autocomplete, mic+keyboard buttons, save/cancel | 02 | 2 |
| 08 | Comment rendering | `noteMarkdown.ts` port (`video-notes.ts` subset) + fixture tests | 02 | 2 |
| 09 | Voice recorder | getUserMedia→AudioWorklet 16 kHz→IPC chunks→WAV in Rust, tap-to-toggle hook | 01 | 1 |
| 10 | Groq + Gemini transcribers | `Transcriber` trait, reqwest clients, prompt plumbing, voice-edit accept/discard UI | 09 | 2 |
| 11 | Local STT (whisper-rs) | worker thread, streaming partials via events, cancel, GGML model manager (SHA-256) | 01 | 1 |
| 12 | Transcript fetch/parse | innertube client (IOS→WEB) in Rust, json3 cue parser + semantic chunker in `core::cue` | 01 | 1 |
| 13 | Transcript panel + annotate | live-follow, selection→SwatchPopup→highlight items, repaint, language picker, search | 02, 12 | 3 |
| 14 | Frame capture + Excalidraw markup | `CaptureBackend` trait (Linux WebKitGTK first), crop/black-detect/JPEG store; draw surface; 4 comment paths | 05, 02 | 3 |
| 15 | Gemma OCR (v1.1) | OCR-at-save → `ocr_texts` | 14 | deferred |
| 16 | Drive OAuth + keyring | loopback PKCE one-shot listener, refresh flow, keyring token store | 02 | 3 |
| 17 | Drive sync engine | `core::merge` port + **golden tests**, Drive REST client, per-page reconcile, snapshots/meta | 16, 02 | 4 |
| 18 | Sync scheduler + status | interval + debounced queue, `sync://progress`, Settings card + Home chip, Sync now | 17 | 5 |
| 19 | Settings screen | Speech / Sync / Playback / Appearance / Data groups; typed-confirm wipes | 10, 11, 16, 02 | 4 |
| 20 | Chat + flashcards (v1.1) | RAG chat route, flashcard generation, markdown export | 02, 13, 15 | deferred |

## Reader (webpage annotation) — tasks 23–32

Plan basis: Reader chapter of `../scholiast_tauri_app_plan.md` §6.9 (originally `scholiast_web_annot_app_plan.md`, Android tasks 23–32).

| # | Task | Summary | Depends on | Wave |
|---|------|---------|------------|------|
| 23 | Reader foundation | `pages` table + repository commands, ReaderPrefs, sanitize contract | 17 | 6 |
| 24 | Anchor port (TS) | `shared/anchor.ts` + `fuzzy-match.ts` ports into `src/lib/anchor/` + vitest vectors | 01 | 6 |
| 25 | Extraction pipeline | reqwest fetch → `readability` crate → sanitize → `pages.source_markdown` | 23 | 7 |
| 26 | Article renderer | measured single-column dark reading view over sanitized HTML | 23 | 7 |
| 27 | Pages sync spine | `assembleLocalPage` incl. highlights/drawings pointers, round-trip tests | 23 | 7 |
| 28 | Reader shell UI | routing, sidebar library rail, top bar, empty/error states | 25, 26 | 8 |
| 29 | Selection + highlights | CSS Custom Highlight API painting, SwatchPopup, grouping, anchor creation | 24 | 8 |
| 30 | Reader voice comments | reuse recorder chain inside reader threads | 28, 29 | 9 |
| 31 | Thread panel + actions | side-panel threads, replies, recolor, delete-with-undo | 28 | 9 |
| 32 | Reader integration + polish | deep links, extension-dashboard cross-client verification, motion/a11y pass | 30, 31 | 10 |

```
Wave 0 : 01 scaffold ──────────────────────────────────────────────┐
Wave 1 : 02 models · 03 normalize · 05 player · 09 recorder ·      │
         11 local-STT · 12 transcript-core                         │
Wave 2 : 04 home · 06 timeline · 07 editor · 08 rendering ·        │
         10 cloud-STT                                              │
Wave 3 : 13 transcript-UI · 14 frames · 16 oauth                   │
Wave 4 : 17 sync-engine · 19 settings                              │
Wave 5 : 18 scheduler/status          [15·20 deferred → v1.1]      │
Wave 6+: 23 → (24·25·26·27) → (28·29) → (30·31) → 32   [Reader]    │
```

"Depends on" is informational for interfaces, blocking for compile-time code. Parallel agents
own disjoint file lists; shared-file changes belong to the wave's designated integrator or are
coordinated by the orchestrator.

## Status log

| Wave | Tasks | State |
|---|---|---|
| 0 | 01 scaffold | **DONE** — all gates green; deb bundle built |
| 1 | 02 models-db · 03 normalize · 05 player · 09 recorder · 11 local-stt · 12 transcript-core | **DONE** — integrated into lib.rs by orchestrator; workspace clippy `-D warnings` clean; 57 rust tests + 17 vitest green (+23 with `local-stt` feature) |
| 2 | 04 home · 06 timeline · 07 editor-sheet · 08 rendering · 10 cloud-STT | **DONE** — combined state verified: 74 vitest + 65 rust green, clippy clean |
| 3 | 13 transcript-UI · 14 frames · 16 oauth | **DONE** — combined: 91 rust + 91 vitest green, clippy clean, production build + app boot verified with screenshot; task-14/16 manual gates pending real credentials/video |
| 4 | 17 sync-engine · 19 settings · 24 anchor-port (pulled forward) | **DONE** — combined: 112 rust + 116 vitest green, clippy/typecheck clean; 11/11 merge goldens Value-identical |
| 5+6 | 18 scheduler/status · 23 reader-foundation | **DONE** — combined: 126 rust + 134 vitest green; sync scheduler live, reader tables/repos/commands in |
| 7 | 25 extraction · 26 renderer · 27 pages-sync-spine | **DONE** — combined: 160 rust + 139 vitest green; dom_smoothie extractor, reader round-trips through extension Drive layout, snapshot-projection engine fix |
| 8 | 28 reader-shell · 29 selection-highlights | **DONE** — combined: 187 vitest green; rail+topbar+keyboard, Custom Highlight API painting with quote-anchor fallback, multi-block grouping |
| 9 | 30 reader-voice · 31 thread-panel | **DONE** — 206 vitest green; voice chain live in comment sheets, thread panel with recolor/delete-undo + j/k cycling |
| 10 | 32 reader-integration | **DONE** — 💬→highlight→thread chain wired; j/k/f/g g verified end-to-end in shell; 209 vitest + 161 rust green; clippy `-D warnings` clean; deb built + boot screenshots; cross-client serde test pins PageRecord to extension field names; 300-highlight paint ≈15ms/pass |

## Verification summary (Reader exit, task-32)

- **Gates:** `pnpm lint` · `pnpm typecheck` · `pnpm vitest run` (30 files / 209 tests) ·
  `cargo clippy --workspace --all-targets -- -D warnings` · `cargo test --workspace`
  (161 passed / 0 failed) — all green.
- **Real-article E2E** (`cargo test --lib real_article -- --ignored`): live Wikipedia fetch →
  extraction → 3-color highlights → comment → recolor → delete-with-undo → re-read. example.com
  itself is correctly rejected `NotReadable` by the extraction guard.
- **Cross-client contract:** assembled `PageRecord` of an annotated article is pinned by test to the
  extension's exact field names (`src/utils/highlighter.ts` + `shared/anchor.ts`) — the data-compat
  product promise holds.
- **Perf:** 300-highlight paint pass median **15.33ms** (target <16ms), logged in
  `highlightPaint.test.ts`.
- **A11y:** token-based `:focus-visible` ring added; aria labels + reduced-motion verified.
- **Build/boot:** `Scholiast_0.1.0_amd64.deb` (debug) built; binary boots under `GDK_BACKEND=x11`,
  Home renders (screenshots in `task-32-reader-integration/` evidence, `/tmp/opencode/reader-home-*.png`).
- **Remaining human gates:** physical mouse/keyboard pass (input injection unavailable in CI env),
  real Drive OAuth round-trip (needs interactive consent — steps in task-32 LOG), offline voice via
  local model, frame-capture round-trip.
| 10 | 32 reader-integration-verification | **DONE** — final: 161 rust + 209 vitest green, clippy clean, deb builds, boot verified; a11y/perf/data-compat checks logged |

## Final verification summary

- **Rust:** 161 tests passing · clippy `-D warnings` clean · 11/11 merge golden tests Value-identical to TS fixtures
- **Frontend:** 209 tests passing · lint + strict typecheck clean · production vite build green
- **App:** debug deb bundles; binary boots (screenshot-verified Home + Reader flows); WEBKIT SW-compositing set programmatically
- **Deferred to v1.1:** task-15 (Gemma OCR) · task-20 (chat + flashcards)
- **Human gates remaining:** frame-capture round-trip on a real video · real Drive OAuth connect + two-client sync · offline voice via local whisper model · physical keyboard/mouse pass
