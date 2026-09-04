# Technical Spec: YouTube Notes Architecture

## Context
Watches the DOM for YouTube player elements and SPA navigations (`yt-navigate-finish`). Bridges video element events, frame capture, and caption tracks.

Key files:
- `src/utils/video/` @ fed294b
- `src/utils/video/frame-store.ts` @ fed294b
- `src/content.ts` @ fed294b

## Proposed Changes & Module Seams
- **Player Observer**: Detects video element and injects keyboard listeners for `S`, `N`, `T`.
- **Frame Grabber**: Captures canvas frame from `<video>` element, verifies non-black frame, and saves to IndexedDB `scholiast_frames`.
- **Transcript Engine**: Fetches captions via YouTube internal endpoints, formats into timed cues, and supports selection swatches.

## Testing and Validation
- **Test 1 (Hotkeys S/N/T binding and SPA navigation)**: Validates Behavior Invariant 1.
- **Test 2 (Frame capture at 1280px resolution)**: Validates Behavior Invariant 2.
- **Test 3 (Timestamp seek dispatch)**: Validates Behavior Invariant 6.
- **Test 4 (Missing captions toast notification)**: Validates Behavior Invariant 8.

## Execution Slicing (Batches)
- Batch 1: Task 01 (Observer & hotkeys), Task 02 (Frame capture), Task 03 (Transcript panel).
