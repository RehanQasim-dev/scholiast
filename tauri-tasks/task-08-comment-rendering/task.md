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
