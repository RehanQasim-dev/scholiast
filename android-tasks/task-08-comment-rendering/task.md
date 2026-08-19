# Task 08 — Comment rendering (markdown → display)

Status: DONE

## Objective
Render the comment-markdown subset as rich display text everywhere: comment threads (Task 06), transcript comments (Task 13), frame comments (Task 14). Pure, well-tested, no Android UI dependencies beyond Compose text.

## Scope — files you OWN (in `../android/app/src/main/java/com/scholiast/android/`)
- `ui/notes/render/CommentRenderer.kt` — markdown → `AnnotatedString` (+ link/color/tag styles), and the `CommentText` composable wrapper
- `ui/notes/render/CommentRendererTest.kt` — unit tests (round-trips + escaping)

## References (read first)
- `../scholiast_mobile_app_plan.md`: §5.4 (thread rendering: bold/italic/links/bare URLs/`#tag` pills), §5.7.4 (frame card surface), §6.2 (`NoteCard`)
- Desktop source to port: `../src/utils/comment-markdown.ts` (the subset: `**bold**`, `*italic*`, `[text](url)`, bare urls, `#tag`, `- item`, `- [ ] task`) and `../src/utils/video/video-notes.ts` (`renderNoteHtml` — the video-note flavor, including `<!--image:ID-->`/`<!--diagram:ID-->` placeholders which must render as inline image chips here)

## Requirements
- Parse the subset to `AnnotatedString`: bold, italic, links (clickable → open in browser), bare URLs auto-linked, `#tag` as colored pills (tap → filter callback, optional), `- [ ] task` as checklist items that can be toggled (toggle rewrites the markdown via callback), `- item` bullets.
- `<!--image:ID-->` and `<!--diagram:ID-->` render as small inline image chips (placeholder icon + tap opens the full image if available — image store interface only, Task 14/16 own the stores).
- Preserve `<!--timestamp:N--><!--edited:M-->` markers invisibly (never render them); edited comments show a small "edited" label if `edited` present.
- Escaping: literal `*`, `_`, `\` in prose must not trigger formatting (match the TS escaping behavior); `$…$` LaTeX: **do NOT render math** in v1 (desktop-only; plain text fallback).
- Empty text → collapse to a muted "No text" placeholder? NO — an empty comment is discarded at save; render nothing.
- Provide `CommentText(markdown: String, onOpenLink, onToggleTask, onTapTag)` composable and the pure `renderComment(markdown): CommentSpans` used by tests.

## Acceptance criteria
- Unit tests mirroring `../src/utils/comment-markdown.test.ts` cases: round-trip (markdown → spans → back), escaping of `*`/`_`/`\`, bare URL linking, task toggle rewriting, tag pill detection, timestamp markers hidden, image chips.
- Checklist toggling rewrites the stored markdown correctly (`- [ ]` ↔ `- [x]`).
- The same renderer output is used by Task 06's threads (interface: `CommentRenderer`).

## Agent notes
- Keep it pure: no repository/network access in the renderer; all callbacks injected.
- If Task 02's note helpers (timestamp parse) are absent, implement the parse locally and log it.
- Write your log to `LOG.md` as you work.