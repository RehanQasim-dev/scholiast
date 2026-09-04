# Technical Spec: Tauri Reader Mode Architecture

## Context
Complete article extraction and reading environment inside the companion app.

Key files:
- `scholiast_tauri/src/reader/` @ fed294b
- `scholiast_tauri/crates/core/src/readability.rs` @ fed294b
- `scholiast_tauri/src-tauri/src/commands/reader.rs` @ fed294b

## Proposed Changes & Module Seams
- **Extraction Pipeline**: Fetches article HTML via `reqwest`, parses main text through `readability`, and stores clean HTML.
- **Reader Shell & Styling**: Single-column view with theme CSS variables and font controls.
- **Pointer Handler**: Discriminates pen vs touch events for instant stylus highlighting.
- **Anchor Binding**: Integrates `anchor.ts` and CSS Custom Highlight API.

## Testing and Validation
- **Test 1 (Readability extraction and HTML sanitation)**: Validates Behavior Invariants 1, 6 (table sanitization).
- **Test 2 (Reader display theme tokens)**: Validates Behavior Invariants 2, 7, 8 (themes, font sizes, column width).
- **Test 3 (Pointer pen vs touch discriminator)**: Validates Behavior Invariant 3.
- **Test 4 (CSS Highlight API rendering & quote snapping)**: Validates Behavior Invariants 4, 9.
- **Test 5 (Header auto-hide on scroll)**: Validates Behavior Invariant 5.

## Execution Slicing (Batches)
- Batch 1: Tasks 01-05 (Foundation, anchors, extraction, renderer, sync).
- Batch 2: Tasks 06-10 (Shell UI, selection highlights, voice comments, threads, integration).
