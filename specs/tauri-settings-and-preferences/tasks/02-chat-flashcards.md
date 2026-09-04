# 02: Chat & Flashcards Configuration

**What to build:** Chat & Flashcards Configuration

**Blocked by:** 01

**Status:** completed

- [x] RAG and flashcard configuration options (Invariant 1)

## Scope & Implementation Notes
# Task 20: Chat + Flashcards (v1.1)

Status: NOT STARTED (deferred — v1.1)
Wave: deferred
Depends on: task-02, task-13, task-15

## Scope & Owned Files
- `src/routes/Chat.tsx` — chat-with-this-lecture: Gemini RAG over transcript paragraphs + notes of current video; message list UI; citations jump to timestamp/transcript cue
- `src-tauri/src/ai/rag.rs` — context assembly (transcript window around query matches via existing cue store; notes text) — no vector DB in v1.1, keyword+window retrieval
- `src/routes/Flashcards.tsx` — generate Q/A (or cloze) from OCR texts + transcript ranges user selects; markdown export file to chosen path (`.apkg` later)
- Commands: `chat_lecture(videoId,msgs)->reply`, `gen_flashcards(videoId,selection)->cards[]`, `export_flashcards_md(cards,path)`

## Acceptance Criteria
- Retrieval unit tests (window selection determinism)
- Export format golden test

## Notes
Blocked behind OCR (15) landing.


