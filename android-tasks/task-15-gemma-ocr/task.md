# Task 15 — Gemma OCR at frame save

Status: DONE

## Objective
Gemma vision OCR: after a frame-comment saves, extract the text from the frame image asynchronously and store it on the item — the source data for flashcards (Task 20) and the frame card.

## Scope — files you OWN (in `../android/app/src/main/java/com/scholiast/android/`)
- `domain/ocr/GemmaClient.kt` — Gemini/Gemma vision API client (image + OCR prompt → text)
- `domain/ocr/OcrRunner.kt` — implements Task 14's `OcrHook`; post-save async runner with quota-awareness (skip if no key), retry-once on transient failure
- `domain/ocr/OcrStorage.kt` — stores `ocrText` on the VideoItem (Task 02's repository update) and/or `OcrTextEntity` in Room (Task 02)
- `domain/ocr/GemmaClientTest.kt` — MockWebServer tests

## References (read first)
- `../scholiast_mobile_app_plan.md`: §2 (OCR immediately at frame-comment save; Gemma 4), §5.7.3 (OCR table + the post-save note), §5.9 (OCR in v1.1 — wait, this says v1.1; but the OCR-at-save timing was confirmed and M4 includes it — check the plan and reconcile: OCR-at-save ships with M4), §9 M4
- Task 14's `OcrHook` interface (implement it)

## Requirements
- `OcrHook.run(itemId, imageFile)` implementation: build the Gemma inline-image request (JPEG base64 + "Transcribe all text in this image" prompt, language-neutral), call the API, store the text.
- Storage: update the VideoItem's `ocrText` field (Task 02's repository `updateItem`) and persist `OcrTextEntity(itemId, text, source="gemma", createdAt)` for the flashcard task's lookup.
- Runs **asynchronously** after save (coroutine, Dispatchers.IO, low priority), never blocks the frame save/UI.
- No API key configured → silently skip (logged); transient network error → one retry then log-and-drop (flashcards can re-run OCR on demand in Task 20).
- Offline → skip (item stores `ocrText=null`), surface a subtle "OCR queued" state on the frame card if feasible.

## Acceptance criteria
- MockWebServer test: request shape (inline image + prompt), response parsed, item updated.
- Integration with Task 14's save flow verified (OcrHook invoked with the right itemId/file; if Task 14 isn't built yet, provide the hook interface and a self-test).
- Unit test: skip logic when no key / offline / after retry failure.

## Agent notes
- Gemma model ID comes from settings (`SpeechSettings` in Task 10; default "Gemma 4" per plan — use the concrete model string if known, else the settings default and log it).
- The OCR prompt should be minimal — you want raw transcription, not commentary.
- Write your log to `LOG.md` as you work.