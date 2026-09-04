# Technical Spec: Obsidian REST Sync Architecture

## Context
Direct sync mechanism writing annotations to markdown files within a user's active Obsidian vault over a secure local HTTPS connection.

Key files:
- `src/utils/obsidian-rest.ts` @ fed294b

## Proposed Changes & Module Seams
- **REST Client (`src/utils/obsidian-rest.ts`)**: Handles local HTTPS certificate bypass, auth headers, ping checks, and note PUT requests.
- **Callout Formatter**: Formats highlights and notes into demarcated regions (`<!-- scholiast:start -->` ... `<!-- scholiast:end -->`).

## Testing and Validation
- **Test 1 (Rest client authentication and ping)**: Validates Behavior Invariant 1.
- **Test 2 (Callout markdown serialization)**: Validates Behavior Invariant 2.
- **Test 3 (Managed region preservation)**: Validates Behavior Invariant 3.

## Execution Slicing (Batches)
- Batch 1: Task 01 (REST client), Task 02 (Markdown serializer).
