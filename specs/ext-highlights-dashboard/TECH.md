# Technical Spec: Highlights Dashboard Architecture

## Context
Standalone web extension page (`src/core/highlights/`) with a virtualized card stream that reads sharded storage records across all known URLs.

Key files:
- `src/core/highlights/` @ fed294b
- `src/utils/highlighter.ts` @ fed294b

## Proposed Changes & Module Seams
- **Storage Shard Aggregator**: Queries `chrome.storage.local` keys (`hl:*`, `va:*`, `dr:*`) to assemble page-grouped items without memory exhaustion.
- **Filtering & Search Engine**: Real-time multi-facet filtering over colors, tags, domains, and text queries.
- **Card Actions & Batch Operations**: Direct mutations write to sharded storage keys and emit change events.

## Testing and Validation
- **Test 1 (Sharded storage aggregation)**: Validates Behavior Invariants 1, 2.
- **Test 2 (Multi-facet filter engine)**: Validates Behavior Invariant 3.
- **Test 3 (Batch selection and markdown export)**: Validates Behavior Invariant 6.

## Execution Slicing (Batches)
- Batch 1: Task 01 (Dashboard stream), Task 02 (Filtering & search), Task 03 (Batch actions).
