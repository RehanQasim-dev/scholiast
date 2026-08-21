# Task 25 — Extraction pipeline (fetch → Readability4J)

Status: DONE

## Objective
Turn a URL into a cleaned Jsoup `Element` (the article DOM), with honest failure detection. This
is the exact stack Feeder and Read You ship (verified in their sources): OkHttp fetch + ICU
charset detect → `Readability4JExtended` → article content element.

Plan: `../scholiast_web_annot_app_plan.md` §5.2, §7, §10. Evidence: Read You
`infrastructure/html/Readability.kt` wires the grabber via constructor injection — mirror that
pattern; Feeder `model/FullTextParser.kt` shows fetch+charset handling.

## Scope — files you OWN (in `../android/`)
- `app/src/main/java/com/scholiast/android/domain/reader/RYArticleGrabberExtended.kt` — VENDORED,
  copied from Read You (`me.ash.reader.infrastructure.html.RYArticleGrabberExtended`, 86 lines).
  Keep the GPL-3.0 header, repackage to our package. It subclasses the library's own
  `ArticleGrabberExtended` and overrides `prepareNodes`.
- `app/src/main/java/com/scholiast/android/domain/reader/Extractor.kt`:
  ```kotlin
  sealed interface ExtractResult {
    data class Success(val article: org.jsoup.nodes.Element, val title: String?, val byline: String?) : ExtractResult
    data class Shell(val reason: String) : ExtractResult      // CSR/garbage → WebView fallback
    data class Failed(val error: String) : ExtractResult      // network/HTTP → error card
  }
  class Extractor(okHttpClient: OkHttpClient) {
    suspend fun extract(url: String): ExtractResult   // Dispatchers.IO
  }
  ```
- Fetch details: browser User-Agent string, 15s timeouts, follow redirects, charset detection via
  ICU `CharsetDetector` when the response header lies (Feeder pattern), size cap ~3MB.
- Shell detection: extracted text < 200 chars OR < 3 text blocks → `Shell`. HTTP ≥ 400 or IO
  error → `Failed`.
- `app/src/test/java/.../reader/ExtractorTest.kt` + fixture HTML files under
  `app/src/test/resources/fixtures/`: a clean article, a DIV-wrapped-paragraphs page
  (mobile-Slate style), a paywalled stub, a CSR shell (empty body script-only).

## Requirements
- Use `Readability4JExtended(uri, html, options, regExUtil, preprocessor, metadataParser,
  articleGrabber = RYArticleGrabberExtended(...), postprocessor)` exactly like Read You's
  `Readability.kt`; return `articleContent` as the Element plus parsed title/byline metadata.
- Pure JVM-testable: no android.util.Log in the extractor path (use println or inject a logger).
- LOG.md must record the GPL vendoring note (personal/sideloaded posture, same as FUTO whisper).

## Acceptance criteria
- Targeted tests pass: `./gradlew testDevDebugUnitTest --tests "com.scholiast.android.domain.reader.ExtractorTest"`.
- Each fixture produces the expected result kind; DIV-wrapped fixture yields many `<p>` blocks.

## Agent notes
- Task 26 consumes your `Success.article` Element — keep the signature exactly as specified.
- Do NOT implement linearization yourself; do NOT touch Room/UI/SyncEngine files.
