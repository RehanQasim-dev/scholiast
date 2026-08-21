# LOG — task-24-anchor-port

## [2026-08-21 00:00] task-24 agent
- **What I learned:** `shared/anchor.ts` three-tier resolution (exact indexOf → collapsed-whitespace with real-span mapping → fuzzy edit-distance) ports cleanly to pure Kotlin; the fuzzy tier is a banded DP (`shared/fuzzy-match.ts` searchEnds + reverse-pass start recovery), not Levenshtein-on-substrings. JS `\s` ≠ `Character.isWhitespace` (JS includes NBSP `\u00A0`, U+FEFF etc.), so AnchorKt ships its own `isJsWhitespace` matching the JS class exactly — using the Kotlin builtin would break cross-surface NBSP cases.
- **Decisions made:**
  - JVM has no `Intl.Segmenter`; sentence-extension in `buildTextQuoteAnchor` uses a deterministic scan for `.!?` terminator runs followed by whitespace (plus blank-line paragraph breaks). For sentences shorter than CONTEXT_LEN=32 the result is byte-identical to TS's fixed-width context, which is what all fixtures exercise. Long-sentence extension (>32 chars up to 200 cap) is heuristic, not Segmenter-exact.
  - `findTextQuoteRange` returns inclusive `IntRange?` (Kotlin idiom); internal `Span(start, endExclusive)` mirrors the TS `{start, end}` shape to avoid off-by-one drift.
  - `trimRange` returns `IntRange.EMPTY` for an all-whitespace span instead of throwing RangeError like the TS DOM version (total function; Task 29 consumers check isEmpty).
  - Added one compact smoke test for `trimRange`/`mergeOverlappingRanges` beyond the ported fixtures — deliberate deviation from "fixtures only": these two have no TS test and Task 29 consumes their exact contract.
- **Open questions:** none.
- **Progress:** `AnchorKt.kt` + `AnchorKtTest.kt` written; `./gradlew testDevDebugUnitTest --tests ...AnchorKtTest` green (9/9); `./gradlew assembleDevDebug` green.

## [2026-08-21 00:05] task-24 agent — final summary
- **What I learned:** two compile fixes needed on first build: data classes required for destructuring (`EndMatch`/`ApproxMatchResult`), and `minOf(Int, Double)` has no Kotlin overload → `minOf(64.0, len*0.25).toInt()`. One test-side miscount fixed ("hello world" ends at index 12).
- **Discrepancies vs TS:** (1) sentence segmentation heuristic replaces `Intl.Segmenter` (see above); (2) DOM-dependent fixture groups in `anchor.test.ts` (linkedom `buildTextMap`/`resolveAnchor`/image anchoring) are out of scope for this pure-string module — their string-core essence (messy-whitespace resolution reporting the real span) is covered by `whitespaceInsensitiveMatchReportsRealSpan`; (3) `trimRange` returns EMPTY rather than throwing.
- **Progress:** Status set to DONE in task.md. Tests: **9 run, 9 passed, 0 failed**. Build: `assembleDevDebug` OK.
