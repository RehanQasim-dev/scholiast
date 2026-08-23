# Task 03: Anchoring & Fuzzy Matcher Port

Status: DONE
Wave: 1
Depends on: task-02-core-domain-models

## Scope & Owned Files
- `scholiast_flutter/lib/core/algorithms/anchor.dart` (Port of `AnchorKt.kt` / `shared/anchor.ts` & `shared/fuzzy-match.ts`)
  - `TextQuoteAnchor`
  - `buildTextQuoteAnchor`
  - `findTextQuoteRange` (exact -> whitespace-insensitive -> banded dynamic programming fuzzy match)
  - `trimRange` & `mergeOverlappingRanges`
- `scholiast_flutter/test/core/anchor_test.dart`

## Acceptance Criteria
- 100% test parity with `android/app/src/test/java/com/scholiast/android/domain/reader/AnchorKtTest.kt`.
- `dart test test/core/anchor_test.dart` passes completely.
