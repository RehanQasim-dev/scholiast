# Task 20 — Chat with lecture + flashcards (v1.1)

Status: CANCELLED (user: no chat flashcards in v1)

## Objective
The v1.1 AI study features: chat with the lecture (Gemini RAG over transcript + notes) and flashcard generation from OCR/transcript text, exported as markdown (`.apkg` later).

## Scope — files you OWN (in `../android/app/src/main/java/com/scholiast/android/`)
- `domain/study/ChatClient.kt` — Gemini chat: conversation state per video, system prompt embedding the transcript + notes context, streaming responses
- `domain/study/ChatScreen.kt` + `ChatViewModel.kt` — the chat UI (message list, input, streaming)
- `domain/study/FlashcardGenerator.kt` — Gemini Q/A (or cloze) card generation from OCR text + transcript text near timestamps
- `domain/study/FlashcardExport.kt` — markdown exporter (vault-friendly format), `.apkg` stub (interface + doc for later)
- `domain/study/FlashcardsScreen.kt` + `FlashcardsViewModel.kt` — pick video/notes → generate → review → export
- `domain/study/StudyTest.kt` — MockWebServer tests for both clients, prompt-template tests

## References (read first)
- `../scholiast_mobile_app_plan.md`: §5.9 (chat + flashcards, markdown now/.apkg later), §2 (v1.1), §9 v1.1 — note: session summary + TTS were removed; don't build them
- Data sources: Task 15's `OcrTextEntity` (OCR text per item), Task 12's transcript (text near timestamps), Task 02's repository (notes)

## Requirements
- **Chat**: per-video conversation; system context built once per video from the transcript paragraphs + all notes (windowed/chunked to fit context); user messages sent with that context; streaming responses via SSE/streamGenerateContent if available (else non-streaming fallback); context refreshed when the video's notes change.
- **Flashcards**: user picks a video (and optional item range) → Gemini generates N cards (default 10, configurable) from OCR text of frame items + transcript text around each item's timestamp + note text; each card = front/back (or cloze), with the source timestamp; review UI (flip, next, mark known/again) → export.
- **Export**: markdown file (e.g. `# Flashcards — <video title>` + `## Card 1` blocks) written to `Downloads/` or app storage with a share-sheet affordance (system share sheet — Samsung Notes export was skipped); `.apkg` = documented stub only.

## Acceptance criteria
- MockWebServer: chat request shape (context + message), flashcard generation request/parse, error mapping.
- Prompt-template unit tests (the context assembly + card schema).
- Manual: chat answers from the video context; flashcards generated from a real OCR'd frame + transcript text; markdown export opens in a markdown editor.

## Agent notes
- This is v1.1 — build it after the v1 tasks are green; it must degrade gracefully if OCR text or transcript is absent (generate from whatever context exists).
- The chat context assembly is the product: make the system prompt reference the transcript by timestamp so answers can cite moments.
- Write your log to `LOG.md` as you work.