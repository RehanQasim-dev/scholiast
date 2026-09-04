# Technical Spec: Live Web Highlighting Architecture

## Context
Highlighter engine built inside the browser extension content script runtime. Interacts with the host DOM using the CSS Custom Highlight API to prevent hydration errors and styling interference.

Key files:
- `src/content.ts` @ fed294b
- `src/utils/highlighter.ts` @ fed294b
- `src/utils/highlighter-overlays.ts` @ fed294b
- `shared/anchor.ts` @ fed294b

## Proposed Changes & Module Seams
- **Highlight Engine (`src/utils/highlighter.ts`)**: Manages highlight CRUD, selection sanitization (`trimRange`), storage persistence, and the undo/redo stack.
- **Overlays & Presentation (`src/utils/highlighter-overlays.ts`)**: Paints highlights using `CSS.highlights` or falls back to canvas bounding boxes. Manages floating color swatch popup anchored to selection endpoints.
- **Anchor Binding (`shared/anchor.ts`)**: Encodes and restores highlights via XPath and text-quote representations.

## Testing and Validation
- **Test 1 (`trimRange` sanitization)**: Validates Behavior Invariant 2 (strips leading/trailing whitespace).
- **Test 2 (`anchor.ts` 3-tier fallback)**: Validates Behavior Invariant 8 (exact match -> collapsed whitespace -> fuzzy Levenshtein).
- **Test 3 (Swatch popup mounting)**: Validates Behavior Invariant 1 (anchored to selection endpoint with 3 color options).
- **Test 4 (CSS Highlight API registration)**: Validates Behavior Invariant 7 (`::highlight(scholiast-*)` leaves DOM unmutated).
- **Test 5 (Undo/Redo stack)**: Validates Behavior Invariant 10 (Ctrl+Z / Cmd+Z reverts creation, recolor, deletion).

## Execution Slicing (Batches)
- Batch 1 (Core & Overlays): Task 01 (CSS Highlight API), Task 02 (Swatch popup & actions), Task 03 (Sanitization & Undo).
