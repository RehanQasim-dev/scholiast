# Technical Spec: Google Drive Sync Architecture

## Context
Shared cloud storage integration. Implemented in TypeScript for the browser extension (`src/utils/google-drive.ts`, `shared/merge.ts`) and Rust for the Tauri companion app (`crates/core/src/merge.rs`, `src-tauri/src/commands/drive.rs`).

Key files:
- `src/utils/google-drive.ts` @ fed294b
- `src/utils/sync-engine.ts` @ fed294b
- `shared/merge.ts` @ fed294b
- `scholiast_tauri/crates/core/src/merge.rs` @ fed294b

## Proposed Changes & Module Seams
- **OAuth PKCE Client**: Manages authorization tokens via Chrome Identity API (extension) or ephemeral loopback listener and OS keyring (Tauri).
- **Three-Way Merge Engine**: Pure functional merge logic taking `Base`, `Local`, and `Remote` to produce `Merged` state and updated tombstones.
- **Sync Scheduler & Queue**: Debounced change queue triggering per-page reconcile on idle and intervals.

## Testing and Validation
- **Test 1 (3-way merge golden vectors)**: Validates Behavior Invariant 3 (newest-wins for highlights, union for comments, tombstones for deletions).
- **Test 2 (Per-page isolation)**: Validates Behavior Invariant 2 (urlhash sharding).
- **Test 3 (Offline queue recovery)**: Validates Behavior Invariant 5.
- **Test 4 (Debounce push timer & interval pull)**: Validates Behavior Invariant 6.
- **Test 5 (Sync now on-demand reconcile)**: Validates Behavior Invariant 7.
- **Test 6 (OAuth PKCE redirect exchange)**: Validates Behavior Invariants 1, 8.

## Execution Slicing (Batches)
- Batch 1: Task 01 (OAuth & Keyring), Task 02 (Sync engine & merge), Task 03 (Scheduler & status).
