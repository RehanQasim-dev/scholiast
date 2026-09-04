# Technical Spec: Tauri Settings Architecture

## Context
Preference management and configuration interface.

Key files:
- `scholiast_tauri/src/routes/Settings.tsx` @ fed294b
- `scholiast_tauri/src-tauri/src/commands/` @ fed294b

## Proposed Changes & Module Seams
- **Preference Store**: `tauri-plugin-store` serializing non-sensitive preferences into `prefs.json`.
- **Keyring Store**: Secure OS credential storage via the `keyring` crate.
- **Confirmation Modals**: UI safeguards for destructive data wipe operations.

## Testing and Validation
- **Test 1 (Preference serialization roundtrip)**: Validates Behavior Invariant 1.
- **Test 2 (Keyring secure secret storage)**: Validates Behavior Invariant 2.
- **Test 3 (Typed confirmation dialog verification)**: Validates Behavior Invariant 3.

## Execution Slicing (Batches)
- Batch 1: Task 01 (Settings screen), Task 02 (Chat & flashcards config).
