# Technical Spec: Tauri YouTube Player Architecture

## Context
Video playback host embedded in the companion desktop and mobile app.

Key files:
- `scholiast_tauri/src/player/` @ fed294b
- `scholiast_tauri/src-tauri/src/commands/player.rs` @ fed294b

## Proposed Changes & Module Seams
- **PlayerHost Component**: Wraps YouTube IFrame API with custom dark chrome overlays.
- **Timeline Store**: Subscribes to playback position updates and invalidates queries via TanStack Query.

## Testing and Validation
- **Test 1 (PlayerHost iframe event contract)**: Validates Behavior Invariants 1, 2, 7 (referrer policy).
- **Test 2 (Resume_at persistence debounce)**: Validates Behavior Invariant 3.
- **Test 3 (Timeline sorting and timestamp click seek)**: Validates Behavior Invariant 4.
- **Test 4 (Chrome mask positioning & suppression)**: Validates Behavior Invariant 6.
- **Test 5 (Font size setting persistence)**: Validates Behavior Invariant 5.

## Execution Slicing (Batches)
- Batch 1: Task 01 (Home screen), Task 02 (Player bridge), Task 03 (Timeline).
