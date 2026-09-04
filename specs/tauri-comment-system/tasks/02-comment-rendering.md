# 02: Comment Markdown Rendering

**What to build:** Comment Markdown Rendering

**Blocked by:** 01

**Status:** completed

- [x] Parses bold, italic, code, bullets, and tags into styled elements (Invariant 1)

## Scope & Implementation Notes
# Task 08: Comment Rendering (markdown subset)

Status: DONE
Wave: 2
Depends on: task-02

## Scope & Owned Files
- `scholiast_tauri/src/lib/noteMarkdown.ts` — the single definition of the note/comment markdown subset, ported semantically from extension `../src/utils/video-notes.ts` + `comment-markdown.ts` display pass:
  - parse/render: `**bold**`, `*italic*`, `[text](url)`, bare urls, `#tag` pills, `<!--timestamp:N-->` (hidden id), `<!--edited:M-->` (edited badge)
  - React renderer → sanitized nodes only (no raw HTML injection)
  - inverse serializer for editing (display→plain markdown)
- Fixture tests copied from extension cases where applicable + new round-trip cases

## Acceptance Criteria
- Vitest round-trip: render(parse(md)) stable for all fixture strings
- Escaping: `<script>`/attribute injection impossible (test)
- NoteCard/thread previews consume this module (coordinate import surface with task-06)

## Notes
This is TS-side only. Rust-side parsing for SYNC payloads already exists in task-02's model helpers — do not duplicate logic here beyond display concerns.


## Execution History & Log
# LOG — task-08-comment-rendering

## [2026-08-23 22:40] task-08 agent
- **What I learned:** Port sources reconciled: extension `video-notes.ts` renders only links/bold/italic over escaped text and strips `<!--timestamp:N-->`/`<!--edited:M-->` before rendering; `comment-markdown.ts` display pass adds bare urls (stop at `\s<>`, strip trailing `[.,;:?!]+`), parks md-links before the bare-url pass so their inner url isn't re-linked, restricts hrefs to http(s), and pills `#tag`s only at `^|\s`. Rust task-02 (`crates/core/src/models.rs`) already owns marker semantics: digits-only validation, malformed markers kept verbatim, global strip — the TS side must match. Note-id helpers in `notes_markdown.rs` turned out to be an empty stub; the real ones live in `models.rs`.
- **Decisions made:** (1) Hand-rolled single-pass scanner parser, priority per position: hidden-id → md-link → bare-url (word-boundary guard mirrors the old `\b`) → bold → italic → tag (`^|\s` rule), everything unmatched accumulates verbatim text — this makes byte-exact round-trips structural rather than something to patch. (2) Tokens carry raw strings and rendering goes through `createElement` React elements only (auto-escaping, zero HTML strings anywhere — no injection surface by construction); `.ts` extension kept by avoiding JSX. (3) Href charset excludes `"` `'` `<` (stricter than the extension) plus a renderer-side http(s)-only guard, so quote-smuggling URLs like `[click](https://evil.com" onclick="…)` fall through to inert plain text. (4) Link labels are plain text (extension post-processes emphasis inside restored anchor labels — diverging deliberately for safety/simplicity). (5) `***x***` renders literal-star + bold instead of the extension's nested em>strong artifact; round-trip stays exact. (6) Hidden-id values are strings (digits), matching Rust i64 semantics without float risk. (7) Ids tokenize inside emphasis too, so mid-bold markers stay hidden like the extension's pre-strip. (8) `serializeToPlainText` is the exact inverse (round-trip gate); `stripHiddenIds` is the separate editor-prefill helper.
- **Open questions:** (1) `pnpm vitest run` is NOT fully suite-green: `src/routes/Home.test.tsx` (task-04-owned, forbidden to me) fails 4/8 tests **deterministically and in isolation** — verified with and without my files present (my module has exactly one importer: its own test). Needs task-04/orchestrator attention; likely stale mocks/timing (`findByText` timeouts). (2) Task-06/07 integration: import surface is `{ parseNoteMarkdown, renderNoteNodes, serializeToPlainText, stripHiddenIds, NoteNode(+member types) }`; NoteCard should mount `renderNoteNodes(parseNoteMarkdown(md))` and the editor sheet prefill via `stripHiddenIds(md)` then re-append ids on save (or store raw and diff).
- **Progress:** `src/lib/noteMarkdown.ts` + `src/lib/noteMarkdown.test.ts` implemented. Gates: lint ✅ · typecheck ✅ · vitest: noteMarkdown **31/31** (+ all other pre-existing files green; only task-04 Home red, see open questions). Round-trip fixtures: **18** (emphasis combos, `***triple***`, unclosed stars, md-links, bare urls w/ trailing `,.;:?!`, tags `_`/digits/nested path, newlines, multi-space, hidden ids incl. both-markers, malformed markers). XSS cases (`<script>`, `javascript:` link, `<img onerror>`, attribute-injection via quoted url, `<b onmouseover>`) asserted inert via RTL. Edited-badge present / timestamp invisible asserted.
- **Status:** DONE.

