# Technical Spec: Tauri Foundation Architecture

## Context
Foundational workspace and database container for `scholiast_tauri/`.

Key files:
- `scholiast_tauri/src-tauri/` @ fed294b
- `scholiast_tauri/crates/core/` @ fed294b
- `scholiast_tauri/src/styles/tokens.css` @ fed294b

## Proposed Changes & Module Seams
- **Workspace**: Cargo workspace containing `src-tauri`, `crates/core`, and `crates/server`.
- **Database**: SQLite initialized with WAL mode and schema v1 migrations.
- **URL Normalization**: Canonical URL parsing, hash generation, and YouTube video ID extraction.

## Testing and Validation
- **Test 1 (Cargo workspace clippy and test suite)**: Validates Behavior Invariant 2.
- **Test 2 (SQLite schema migration and WAL mode)**: Validates Behavior Invariant 3.
- **Test 3 (URL normalization test vectors)**: Validates Behavior Invariant 1.

## Execution Slicing (Batches)
- Batch 1: Task 01 (Scaffold), Task 02 (Models & DB), Task 03 (URL normalization).
