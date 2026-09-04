# Technical Spec: Tauri Transcript Architecture

## Context
Fetches and aligns caption cues with video playback time in the companion app.

Key files:
- `scholiast_tauri/crates/core/src/cue.rs` @ fed294b
- `scholiast_tauri/src-tauri/src/commands/transcript.rs` @ fed294b
- `scholiast_tauri/src/player/transcript/` @ fed294b

## Proposed Changes & Module Seams
- **Innertube Client (`src-tauri/src/commands/transcript.rs`)**: Queries YouTube player endpoints for caption tracks.
- **Cue Parser (`crates/core/src/cue.rs`)**: Parses JSON3 caption payloads and groups cues semantically.
- **Transcript Panel Component**: Virtualized cue list with auto-scroll and selection swatch popup.

## Testing and Validation
- **Test 1 (Cue parsing and semantic grouping)**: Validates Behavior Invariant 1.
- **Test 2 (Karaoke auto-scroll index computation)**: Validates Behavior Invariant 2.
- **Test 3 (Cue highlight creation and swatch popup)**: Validates Behavior Invariant 3.

## Execution Slicing (Batches)
- Batch 1: Task 01 (Transcript core), Task 02 (Transcript panel).
