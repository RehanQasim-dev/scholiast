# Task 26 — Linearizer (article Element → `LinearArticle`)

Status: DONE

## Objective
Flatten a cleaned article DOM (Task 25's `Success.article` Jsoup `Element`) into the app's
`LinearArticle` block model (Task 23's contract) — the exact text surface that highlighting,
anchors, and rendering all index into. Feeder's `HtmlLinearizer.kt` is the proven shape.

Plan: `../scholiast_web_annot_app_plan.md` §3.2, §4.2, §5.2. Evidence: Feeder
`model/html/HtmlLinearizer.kt` (flat blocks + char-offset annotations + truncation valve).

## Scope — files you OWN (in `../android/`)
- `app/src/main/java/com/scholiast/android/domain/reader/Linearizer.kt`:
  ```kotlin
  class Linearizer(private val maxChars: Int = 400_000) {
    fun linearize(article: org.jsoup.nodes.Element, baseUrl: String,
                  title: String?, byline: String?, fetchedAt: Long): LinearArticle
  }
  ```
- Tag handling (mirror Read You `HtmlToComposable.kt`'s coverage, but emit blocks):
  `p → "p"`; `h1..h6 → kind`; `blockquote → "blockquote"`; `pre/code → "code"` (text verbatim);
  `ul/ol li → one "li" block each` (bullet prefix NOT baked into text — renderer styles it);
  `img → "img"` block (`imgUrl` absolute via `abs:src`, `srcset` ignored beyond first candidate,
  `imgAlt`); `figcaption → "figcaption"`; `a → link annotation` (char offsets within block text,
  `abs:href`); `strong/b → bold`, `em/i → italic`, inline `code → code` annotations.
  Skip: nav/header/footer/aside/script/style/iframes/forms.
- Whitespace hygiene: collapse runs of whitespace inside block text to single spaces, trim ends —
  block `text` is what anchors index into, so it must be clean and stable.
- Truncation valve: stop emitting blocks once cumulative chars exceed `maxChars`; set
  `truncated = true`. Word count = whitespace-separated tokens across blocks.
- `app/src/test/java/.../reader/LinearizerTest.kt` with fixture Elements built from small HTML
  strings (no network): mixed formatting, nested lists, images, links spanning partial text,
  truncation behavior.

## Requirements
- Pure JVM (Jsoup only), no Android imports.
- Deterministic output for identical input (stable block order = document order).
- Annotations' start/end are char offsets into the FINAL cleaned block text — verify in tests.

## Acceptance criteria
- `./gradlew testDevDebugUnitTest --tests "com.scholiast.android.domain.reader.LinearizerTest"` passes.
- A round-trip test proves: concatenating block texts with "\n\n" contains every visible sentence
  of the fixture exactly once.

## Agent notes
- Task 28 renders your blocks; Task 29 paints spans over them; Task 24's anchors compute over the
  same text. The contract is `LinearBlock.text` — never mutate it after linearization.
- Own ONLY Linearizer.kt + its test. Do not touch Extractor/models/UI.
