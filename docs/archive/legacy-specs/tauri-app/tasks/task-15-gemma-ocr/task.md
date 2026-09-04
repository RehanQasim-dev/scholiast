# Task 15: Gemma OCR at Frame-Save (v1.1)

Status: NOT STARTED (deferred — v1.1)
Wave: deferred
Depends on: task-14

## Scope & Owned Files
- `src-tauri/src/ai/gemma.rs` — frame JPEG → Gemini vision endpoint (Gemma-class model id pref) → text
- Command `ocr_frame(itemId)`; invoked async low-priority immediately after a frame-comment save (both original and edited-frame paths)
- Stores into `ocr_texts` + `ocrText` on the item; quota-aware single-flight per item; silent-fail with retry chip on the NoteCard
- NoteCard shows OCR text section when present

## Acceptance Criteria
- wiremock test: happy path + failure path; no double-enqueue
- Frame cards for note/transcript kinds never trigger OCR

## Notes
Plan §6.7.3 table is authoritative on which paths OCR.
