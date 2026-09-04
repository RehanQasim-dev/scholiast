# Task 24: Anchor Port (TS) — text-quote anchoring

Status: DONE
Wave: 6
Depends on: task-01

## Scope & Owned Files
- `scholiast_tauri/src/lib/anchor/anchor.ts` + `fuzzy-match.ts` (+ `range.ts` helpers) — TS ports of `../shared/anchor.ts` and `../shared/fuzzy-match.ts`:
  - dual anchor model: text-quote (`quote`, prefix, suffix, occurrence) + optional structural/surface xpath
  - resolver: native-range capture → quote serialization; resolution: exact indexOf → whitespace-insensitive → fuzzy edit-distance with the same quality thresholds/gates (never displaces honest "unplaced")
  - operates on a minimal `RangeLike` interface so it stays DOM-testable in vitest/jsdom
- Port the test vectors from `shared/anchor.test.ts` verbatim

## Acceptance Criteria
- All ported vectors green; no behavior drift documented where intentionally divergent
- Zero dependencies beyond dev-types (pure module)

## Notes
Task-29 consumes this for painting/creation. Keep function signatures identical to shared/ to ease future upstream diffs.
