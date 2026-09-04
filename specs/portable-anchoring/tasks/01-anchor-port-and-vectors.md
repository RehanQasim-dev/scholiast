# 01: Anchor Port & Cross-Surface Test Vectors

**What to build:** Anchor Port & Cross-Surface Test Vectors

**Blocked by:** None

**Status:** completed

- [x] Port shared/anchor.ts and fuzzy-match.ts to Tauri frontend with full test vector parity (Invariants 1, 2, 3)

## Scope & Implementation Notes
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


## Execution History & Log
# Task 24 — Anchor Port (TS) — LOG

## 2026-08-24 — COMPLETE

**Files written (all within ownership):**
- `src/lib/anchor/fuzzy-match.ts` — byte-semantic port of `shared/fuzzy-match.ts` (banded DP
  `searchEnds` with run-collapsing, reverse-pass start recovery via `approxMatch`). Identical
  export surface (`ApproxMatch`, `approxMatch`).
- `src/lib/anchor/anchor.ts` — full port of `shared/anchor.ts`: dual anchor model
  (`TextQuoteAnchor` + `StructuralAnchor` + `ImageAnchor`), `buildTextQuote`,
  `findTextQuote`, `findTextQuoteRange` (exact → whitespace-insensitive → fuzzy tiers),
  fuzzy gates `FUZZY_MIN_QUOTE_SCORE = 0.74` / `FUZZY_MIN_SCORE = 0.7` / `<4 char` /
  `maxErrors = min(64, floor(len*0.25))` verbatim, `RangeLike`, `toDomRange`, `buildTextMap`
  (`data-annot-ui` skip, `<br>` space trick), `locateRange`, `offsetsFromRange`,
  `xpathForElement` / `elementFromXPath`, `createAnchor`, `resolveAnchor` (with cached
  `rootText` param), image anchoring (`createImageAnchor`, `imageSrcMatches`,
  `resolveImageElement`). All names/signatures identical to shared/.
- `src/lib/anchor/anchor.test.ts` — all **15** vectors from `shared/anchor.test.ts` ported
  verbatim + **1** added regression case (NBSP page) explicitly requested by the brief
  ("multi-space/newline/NBSP pages"). 16 total; suite reports 16 passed.
- No `range.ts` needed — golden keeps range helpers inside `anchor.ts`; single file mirrors
  upstream for easiest diffs.

**Intentional divergences from shared/ (semantics-neutral, lint-forced):**
1. `(Intl as any)` casts → structurally-typed `SentenceSegmenterLike` cast
   (`@typescript-eslint/no-explicit-any` is on in this repo). Same runtime behavior incl.
   sentence-segmenter context widening + CONTEXT_LEN fallback.
2. `catch (e)` (unused binding) → bare `catch` (repo no-unused-vars gate).
3. Test DOM harness: linkedom `parseHTML` → jsdom global `document` + fresh detached
   container div (linkedom is not a dependency of this app and none were allowed). The
   anchor code is DOM-generic and runs unchanged under jsdom.

**Gates:**
- `pnpm lint` — PASS (whole repo).
- `pnpm typecheck` — FAILS at `src/lib/store.ts:53`, a sibling wave's file created mid-task
  (not mine; my dir untouched by it). Proved my module clean with a scoped strict
  `tsc --noEmit` over `src/lib/anchor/**` only → CLEAN. Integration task should fix store.ts.
- `pnpm vitest run` (full suite) — PASS: 14 files / 107 tests, including
  `src/lib/anchor/anchor.test.ts` 16/16. Scoped `pnpm vitest run src/lib/anchor` also green.

**Vector count:** 16 ported/total vs 15 original (15 verbatim + 1 requested NBSP regression;
the NBSP string initially shipped with plain spaces — caught by grepping for `\xc2\xa0` and
fixed to explicit `\u00a0` escapes before gating).

**Consumers:** task-29 imports `createAnchor` / `resolveAnchor` from `src/lib/anchor/anchor`.

