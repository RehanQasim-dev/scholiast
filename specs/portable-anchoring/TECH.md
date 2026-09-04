# Technical Spec: Portable Anchoring Architecture

## Context
Core shared primitive defining how annotations bind to DOM and text positions across different platforms and runtimes.

Key files:
- `shared/anchor.ts` @ fed294b
- `shared/fuzzy-match.ts` @ fed294b
- `scholiast_tauri/src/lib/anchor/` @ fed294b

## Proposed Changes & Module Seams
- **Anchor Representation**: `SerializedAnchor` holding `xpath`, `quote`, `prefix`, `suffix`, `occurrence`.
- **Resolution Pipeline**: Tier 1 exact DOM search -> Tier 2 whitespace normalization -> Tier 3 Levenshtein bounded search.

## Testing and Validation
- **Test 1 (Exact text-quote resolution)**: Validates Behavior Invariant 1.
- **Test 2 (Whitespace and fuzzy match tolerances)**: Validates Behavior Invariant 2.
- **Test 3 (Cross-surface TypeScript & Rust parity)**: Validates Behavior Invariant 3.

## Execution Slicing (Batches)
- Batch 1: Task 01 (Anchor port & test vectors).
