# LOG — task-25-extraction-pipeline

## [2026-08-21 15:05] task-25 agent
- **What I learned:**
  - Read You wires Readability via constructor injection (`Readability.kt`): `Readability4JExtended(uri, html, options=ReadabilityOptions(), regExUtil=RegExUtilExtended(), preprocessor=Preprocessor(regExUtil), metadataParser=MetadataParser(regExUtil), articleGrabber=RYArticleGrabberExtended(options, regExUtil), postprocessor=PostprocessorExtended())`. Mirrored exactly.
  - `android.icu.text.CharsetDetector` is a hidden libcore API — NOT in the public android.jar (compile fails with "Unresolved reference") and absent from the JVM test classpath. Reached it reflectively instead: real platform ICU on-device (minSdk 30 has it at runtime), graceful null → header/UTF-8 fallback on JVM tests. No build-file changes needed (icu4j is not transitive via readability4j 1.0.8 anyway).
  - readability4j 1.0.8 pulls jsoup 1.11.2 + slf4j-api (NOP binding on JVM) — no conflicts with existing deps.
- **Decisions made:**
  - `RYArticleGrabberExtended.kt` vendored byte-for-byte from Ashinch/ReadYou main, only the package changed; GPL-3.0 header + attribution added. Personal/sideloaded posture, same as the FUTO whisper.cpp vendoring.
  - Shell vs Failed split per spec: HTTP ≥400 / IOException / malformed URL → `Failed`; readability returning null content or thin text (<200 chars or <3 `<p>` blocks) → `Shell` (page fetched fine, WebView fallback should take it).
  - 3MB cap truncates the stream and parses what was read (spec says "~3MB"); OkHttp client derived via `baseClient.newBuilder()` so the caller's shared client is never mutated.
  - Charset: declared header charset wins unless it decodes to U+FFFD ("header lies") or is missing → ICU detect → UTF-8 last resort.
- **Open questions:** none.
- **Progress:** Wrote `domain/reader/RYArticleGrabberExtended.kt`, `domain/reader/Extractor.kt`, 4 fixtures under `app/src/test/resources/fixtures/` (clean / div-wrapped / paywall / csr-shell) and `ExtractorTest.kt` (exactly 4 tests). `assembleDevDebug` BUILD SUCCESSFUL; targeted `testDevDebugUnitTest --tests ExtractorTest`: tests=4 failures=0 errors=0 skipped=0.

## [2026-08-21 15:26] task-25 agent — final
- **GPL vendoring note:** `RYArticleGrabberExtended.kt` is GPL-3.0 code copied from Read You (github.com/Ashinch/ReadYou, © Ashinch / Read You contributors). The app as a whole therefore carries GPL-3.0 obligations for that file; acceptable under this project's personal/sideloaded-only distribution posture (same rationale as the vendored FUTO whisper.cpp engine, which is FUTO Source First 1.1). Header comment with source URL and license link kept at the top of the file.
- **Deviations:** ICU CharsetDetector used via reflection instead of a direct import (hidden API, see above) — behavior identical on-device. No other deviations from task.md; signature matches spec exactly (`Success(article: Element, title: String?, byline: String?)`).
- **Status:** DONE — build green, 4/4 fixture tests green.
