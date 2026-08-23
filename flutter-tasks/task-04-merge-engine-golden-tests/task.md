# Task 04: 3-Way Merge Engine & Golden Tests

Status: DONE
Wave: 1
Depends on: task-02-core-domain-models

## Scope & Owned Files
- `scholiast_flutter/lib/core/algorithms/merge_page_record.dart` (Port of `MergePageRecord.kt` / `shared/merge.ts`)
  - `mergeKeyed`
  - `mergeNotes` (timestamp/edited comment markers)
  - `mergePageRecord` (reconciling base, local, remote with tombstones)
- `scholiast_flutter/test/core/merge_page_record_test.dart`

## Acceptance Criteria
- Golden tests comparing Dart output against `shared/fixtures/` or Kotlin `MergePageRecordTest.kt`.
- 100% byte/order parity with TypeScript source of truth.
- `dart test test/core/merge_page_record_test.dart` passes.
