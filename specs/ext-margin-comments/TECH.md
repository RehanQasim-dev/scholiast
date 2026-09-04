# Technical Spec: Margin Comments Architecture

## Context
Comments sit in a shadow DOM container (`#scholiast-root`) docked to the right edge of the webpage. Gutter compensation dynamically adjusts the host document layout to ensure zero overlap with native content.

Key files:
- `src/utils/comment-overlays.ts` @ fed294b
- `src/content.ts` @ fed294b
- `src/utils/highlighter.ts` @ fed294b

## Proposed Changes & Module Seams
- **Gutter Reservation (`src/utils/comment-overlays.ts`)**: Measures `window.innerWidth - mainRect.right` and applies smooth body margin compensation if `< 340px`.
- **Collision Resolution (`src/utils/comment-overlays.ts`)**: Sorts cards vertically and applies `y[i] = max(top[i], y[i-1] + height[i-1] + gap)`.
- **WYSIWYG Composer**: Contenteditable host intercepting markdown shortcuts, image paste events, and tag lookups.

## Testing and Validation
- **Test 1 (Gutter compensation)**: Validates Behavior Invariant 3 (measures clearance and reserves 320-360px gutter).
- **Test 2 (Collision-free card stacking)**: Validates Behavior Invariants 1, 2 (no overlapping cards).
- **Test 3 (Keyboard shortcuts)**: Validates Behavior Invariant 6 (Ctrl+Enter submit, Esc cancel).
- **Test 4 (Tag autocomplete trigger)**: Validates Behavior Invariant 10 (# summons tag index).

## Execution Slicing (Batches)
- Batch 1: Task 01 (Gutter reservation), Task 02 (Collision layout), Task 03 (WYSIWYG editor).
