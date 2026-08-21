# Task 24 — Quote-anchor engine in Kotlin (`AnchorKt`)

Status: DONE

## Objective
Port the desktop's cross-surface text-quote anchoring to pure Kotlin: create an anchor from a
selection over a text corpus, and resolve an anchor back to a range with the same three-tier
fallback (exact → whitespace-insensitive → fuzzy). This is what makes highlights made in the
Reader paint on the live web page / Obsidian note, and vice versa.

Plan: `../scholiast_web_annot_app_plan.md` §4.2, §5.9. Source of truth: `../shared/anchor.ts`
(read ALL of it first) and its tests `../shared/anchor.test.ts`.

## Scope — files you OWN (in `../android/`)
- `app/src/main/java/com/scholiast/android/domain/reader/AnchorKt.kt` — pure functions:
  - `data class TextQuoteAnchor(val quote: String, val prefix: String, val suffix: String, val occurrence: Int)`
  - `fun buildTextQuoteAnchor(fullText: String, start: Int, end: Int): TextQuoteAnchor`
    (CONTEXT_LEN = 32; sentence-extension logic for short context — mirror anchor.ts lines ~90–130)
  - `fun findTextQuoteRange(anchor: TextQuoteAnchor, fullText: String): IntRange?`
    (exact indexOf → collapsed-whitespace match reporting real span → fuzzy edit-distance with the
    SAME quality gates/scores as TS: 0.6 quote + 0.2 prefix + 0.2 suffix, thresholds identical)
  - helpers: `collapseWs`, `commonPrefixLen`, `commonSuffixLen`, occurrence disambiguation.
- `app/src/test/java/com/scholiast/android/domain/reader/AnchorKtTest.kt`

## Requirements
- **Golden-test against the TS fixtures**: port every case in `shared/anchor.test.ts`
  (creation fields incl. prefix/suffix/occurrence; repeated-quote disambiguation; whitespace
  collapse; fuzzy tolerance; below-threshold rejection → null).
- Pure Kotlin, zero Android dependencies (runs on JVM).
- Deterministic: no regex where TS uses indexes; match TS behavior byte-for-byte on fixtures.
- Also port two small semantics used by highlighting (Task 29 consumes):
  `trimRange(text, start, end)` (tighten to nearest non-whitespace) and
  `mergeOverlappingRanges(ranges: List<IntRange>): List<IntRange>` (merge overlapping/adjacent).

## Acceptance criteria
- All ported fixture cases pass: `./gradlew testDevDebugUnitTest --tests "com.scholiast.android.domain.reader.AnchorKtTest"`.
- A doc comment maps each function to its TS counterpart line range.

## Agent notes
- You own ONLY the files listed. Do not touch models, Room, or UI.
- If a TS behavior is ambiguous, prefer matching the test expectations; note discrepancies in LOG.md.
