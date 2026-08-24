# Task 27: Pages Sync Spine

Status: DONE
Wave: 7
Depends on: task-23

## Scope & Owned Files
- Extend `assemble_local_page` (task-17 engine) to include Reader data: `highlights[]` (from pages/highlights/comments tables mapped into extension `HighlightData` shape incl. portable `anchor` JSON), `drawings[]`, `diagram` pointers, tombstones — video fields empty for article pages
- Reverse mapping on pull: merged remote highlights → upsert rows (preserve comment IDs), tombstone application deletes locally
- Round-trip tests: local assemble → merge with synthetic remote → write-back produces expected rows (fixture-based)
- Enqueue article pages in sync queue on every reader mutation (task-18 consumes transparently)
- Cross-client acceptance target documented in LOG.md: after this task, an article annotated here must appear in the extension dashboard's store layout when pulled by it (manual verification scripted in task-32)

## Acceptance Criteria
- Engine round-trip golden-green including reader-shaped records
- No schema drift: assembled PageRecord validates against task-02 serde types

## Notes
This is the task that makes Reader annotations first-class citizens of the existing Drive layout.
