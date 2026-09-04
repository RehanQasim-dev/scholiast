# Technical Spec: Tauri Comment System Architecture

## Context
Handles comment authoring and rich text presentation in the companion app.

Key files:
- `scholiast_tauri/src/player/` @ fed294b
- `scholiast_tauri/src/lib/noteMarkdown.ts` @ fed294b

## Proposed Changes & Module Seams
- **Comment Editor Sheet**: Floating card/bottom sheet with textarea and inline autocomplete dropdown.
- **Note Markdown Parser**: Lightweight parser rendering formatted HTML without external markdown bloat.

## Testing and Validation
- **Test 1 (Markdown parser fixture tests)**: Validates Behavior Invariant 1.
- **Test 2 (Composer timestamp latching & modal non-intrusion)**: Validates Behavior Invariants 1, 2.
- **Test 3 (Tag autocomplete trigger)**: Validates Behavior Invariant 1.
- **Test 4 (Card rendering hierarchy & SVG icon assertions)**: Validates Behavior Invariants 4, 5.
- **Test 5 (Escape key & backdrop dismissal handler)**: Validates Behavior Invariant 6.

## Execution Slicing (Batches)
- Batch 1: Task 01 (Comment editor sheet), Task 02 (Comment rendering).
