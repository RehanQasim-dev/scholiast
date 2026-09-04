# AGENTS.md — Scholiast Architecture & Subsystems

This file is the high-level router for agents working in this repository. Detailed subsystem architecture is progressively disclosed in `docs/architecture/`.

---

## Hard Rules for Agents
- **Do not run tests without a reason**: Never run test suites (`cargo test`, `vitest`, `npm test`, etc.) casually or without an explicit reason or necessity. Running test suites takes significant time and resources. Only run minimal, targeted tests when specifically verifying changes that require testing.
- **Run the Pre-CI local gates before push**: After any Rust/TypeScript change, run the mandatory low-cost gates in [`docs/guides/build-and-release.md`](docs/guides/build-and-release.md) (§ Pre-CI Local Gates): host `cargo check` + `cargo check` for all 3 Android targets + `pnpm typecheck`. Host-only checks miss Android-`cfg` breakage that fails CI 9–25 min in.
- **Consult Domain Glossary**: Always use the canonical terms defined in `CONTEXT.md`.
- **Progressive Disclosure**: Consult the relevant subsystem doc in `docs/architecture/` on demand rather than loading the entire documentation tree.

---

## 1. Project Overview

Browser extension (Chrome MV3 / Firefox / Safari), shipped as **Scholiast** (`src/icons/logo.svg`).
Base product clips web pages to Obsidian; this fork adds live-webpage annotation (highlights, comments, freehand drawing), a highlights dashboard, Google Drive sync, YouTube video frame/transcript notes, and a companion Tauri desktop/mobile app (`scholiast_tauri/`).

- **Language**: TypeScript, SCSS (Webpack $\to$ `dist/`, `dist_firefox/`, `dist_safari/`).
- **Tauri App**: Rust core + React 18 in `scholiast_tauri/` (see `scholiast_tauri/AGENTS.md`).

### Key Files
| File | Role |
|------|------|
| `src/content.ts` | Page entry point. Inits highlighter+pencil, CSS injection, global keydown dispatch, exposes `window.__obsidianHighlighter`. |
| `src/utils/highlighter.ts` | Highlight CRUD, storage, anchoring, undo/redo, migrations. |
| `src/utils/highlighter-overlays.ts` | Text/element rendering (CSS Custom Highlight API), color swatch menu. |
| `src/utils/comment-overlays.ts` | Comment card layout (right column), threads, truncation, WYSIWYG editor. |
| `src/diagram.tsx` | Excalidraw editor window (comment diagrams and image edits). |
| `src/core/highlights/` | Highlights Dashboard (annotation manager). |
| `src/utils/video/` | YouTube notes, frame capture, transcript panel (`T`), frame store (IndexedDB). |
| `src/utils/sync-engine.ts` | 3-way merge sync state machine, tombstones, push/pull. |
| `src/utils/google-drive.ts` | Google Drive REST + OAuth, appData folder sync. |
| `src/utils/obsidian-rest.ts` | Local REST API client (config, ping, note PUT/GET). |
| `src/background.ts` | Service worker message routing, alarms, debounced sync. |

---

## 2. Progressive Disclosure: Subsystem Architecture

Read the dedicated architecture file for the subsystem you are modifying:

- **Storage Model & Anchoring**: Sharded `hl:`, `dr:`, `va:`, `src:` keys, XPath + text-quote dual anchoring, 3-tiered fuzzy resolution. See [`docs/architecture/storage-and-anchoring.md`](docs/architecture/storage-and-anchoring.md).
- **Highlighter & Toolbar**: Annotation mode, Excalidraw-style top floating toolbar, selection hygiene (`trimRange`), action bar hover. See [`docs/architecture/highlighter-and-toolbar.md`](docs/architecture/highlighter-and-toolbar.md).
- **Comment System**: Right-side margin cards, multi-pass gutter reservation, WYSIWYG `contenteditable` editor, pasted images. See [`docs/architecture/comment-system.md`](docs/architecture/comment-system.md).
- **Excalidraw & Pencil**: Comment diagrams, image redrawing over element highlights, freehand SVG strokes. See [`docs/architecture/excalidraw-and-pencil.md`](docs/architecture/excalidraw-and-pencil.md).
- **Highlights Dashboard**: High-density stream, filters, batch operations, sharded page reads. See [`docs/architecture/dashboard.md`](docs/architecture/dashboard.md).
- **Video Notes & Transcripts**: YouTube player detection, frame capture, normalized markup, caption cue anchoring. See [`docs/architecture/video-notes-and-transcripts.md`](docs/architecture/video-notes-and-transcripts.md).
- **Google Drive Sync**: AppData folder layout, CAS revisions (`headRevisionId`), 3-way merge engine, blob uploads. See [`docs/architecture/google-drive-sync.md`](docs/architecture/google-drive-sync.md).
- **Obsidian REST Sync**: Local REST API client, managed markdown regions, callout styling. See [`docs/architecture/obsidian-rest-sync.md`](docs/architecture/obsidian-rest-sync.md).
- **Cross-Surface Obsidian Plugin**: `clipper-annotations-plugin/`, shared pure models (`shared/anchor.ts`, `shared/merge.ts`). See [`docs/architecture/cross-surface-obsidian-plugin.md`](docs/architecture/cross-surface-obsidian-plugin.md).
- **Tauri Desktop/Mobile App**: Rust core, React 18, SQLite, release target architectures. See [`docs/architecture/tauri-app-architecture.md`](docs/architecture/tauri-app-architecture.md) and [`scholiast_tauri/AGENTS.md`](scholiast_tauri/AGENTS.md).
- **UI/UX & Ergonomics**: Space efficiency, anti-nesting card hierarchy, S-Pen vs touch gestures, and chat-style ergonomics. See [`docs/architecture/ui-ux-and-ergonomics.md`](docs/architecture/ui-ux-and-ergonomics.md).

Developer and operational setup guides (Drive OAuth, verification, release packaging) live in [`docs/guides/`](docs/guides/).

---

## 3. Agent Skills & Working Conventions

### Issue Tracking
Issues live on GitHub at `RehanQasim-dev/scholiast`. See [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).

### Domain Docs & Glossary
Canonical vocabulary is in [`CONTEXT.md`](CONTEXT.md). Architectural decisions are in [`docs/adr/`](docs/adr/). See [`docs/agents/domain.md`](docs/agents/domain.md).

### Feature Specifications (Spec-Driven Development)
All feature specifications follow the `spec-driven-implementation` lifecycle under `specs/<feature-slug>/`:
- **Naming Prefix Convention**:
  - `ext-*`: Browser extension-specific features (e.g., [`specs/ext-live-highlighting/`](specs/ext-live-highlighting/), [`specs/ext-margin-comments/`](specs/ext-margin-comments/), [`specs/ext-youtube-video-notes/`](specs/ext-youtube-video-notes/), [`specs/ext-highlights-dashboard/`](specs/ext-highlights-dashboard/), [`specs/ext-freehand-pencil-and-diagrams/`](specs/ext-freehand-pencil-and-diagrams/)).
  - `tauri-*`: Tauri desktop/mobile companion features (e.g., [`specs/tauri-foundation/`](specs/tauri-foundation/), [`specs/tauri-lecture-player/`](specs/tauri-lecture-player/), [`specs/tauri-comment-system/`](specs/tauri-comment-system/), [`specs/tauri-voice-notes/`](specs/tauri-voice-notes/), [`specs/tauri-transcript-annotation/`](specs/tauri-transcript-annotation/), [`specs/tauri-frame-markup/`](specs/tauri-frame-markup/), [`specs/tauri-reader-mode/`](specs/tauri-reader-mode/), [`specs/tauri-android-adaptation/`](specs/tauri-android-adaptation/), [`specs/tauri-settings-and-preferences/`](specs/tauri-settings-and-preferences/)).
  - Neither prefix: Cross-surface shared capabilities (e.g., [`specs/google-drive-sync/`](specs/google-drive-sync/), [`specs/obsidian-rest-sync/`](specs/obsidian-rest-sync/), [`specs/portable-anchoring/`](specs/portable-anchoring/)).
- **Feature Directory Structure**:
  Each feature directory strictly adheres to the standard:
  ```
  specs/<feature-slug>/
  ├── PRODUCT.md      # User behavior & numbered invariants (write-product-spec)
  ├── TECH.md         # Architecture, seams, commit pins & test plan (write-tech-spec)
  └── tasks/          # Tracer-bullet execution batches (to-tickets)
      ├── 01-<slug>.md
      └── 02-<slug>.md
  ```

