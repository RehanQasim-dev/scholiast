# Task 34 — `android-reader` bundle: Readability.js + annotation kernel + reader CSS

Status: DONE

## Objective
One self-contained asset pair the Android WebView loads: a JS bundle that (1) runs Mozilla's
Readability.js on the raw page HTML, (2) replaces the document with cleaned article DOM styled
by our reader stylesheet, and (3) carries the desktop extension's annotation kernel (quote-anchor
create/resolve, Custom Highlight API painting, selection swatch pill, 💬 badges) behind a small
window API. This is the desktop extension's proven code, repackaged.

Plan: `../scholiast_web_annot_app_plan.md` Revision B. Your kernel sources live in THIS repo:
`../shared/anchor.ts`, `../src/utils/highlighter-overlays.ts` (painting/active-highlight),
`../src/utils/trim-range.ts`, and the swatch popup inside highlighter-overlays — reuse them;
strip `chrome.*` dependencies behind a host interface.

## Scope — files you OWN
- NEW webpack entry `src/android-reader.ts` (+ any thin adapter modules it needs under `src/android/`)
- Webpack config addition mirroring the existing entries in `webpack.config.js` → output IIFE,
  single file, no chunk splitting: `dist-android/android-reader.js` (name pinned; check how
  existing config emits, add CopyPlugin step if assets need copying to
  `android/app/src/main/assets/wwwreader/android-reader.js` + `.css`)
- `android-reader.css` (or SCSS compiled): the reader stylesheet — dark palette from
  `android/app/src/main/java/com/scholiast/android/ui/theme/Color.kt` (bg #0B0D14-ish surfaces,
  text #FFF/#9AA0A6, accent #8B7CF6, highlight fills yellow #F9E64D / red #FF5A5A / green
  #5FE3A0 at ~32% alpha), typography via CSS variables (`--reader-font-px`, `--reader-serif`,
  `--reader-measure`), images max-width 100%, pre/code styling, blockquotes, ordered lists.
- Build output copied into `android/app/src/main/assets/wwwreader/`.

## Window API (the bridge contract — Task 35 codes against EXACTLY this)
```
ReaderAndroid.ready()                                  // JS→K: DOM swapped, painted; fires AndroidBridge.onReady()
ReaderAndroid.loadRaw(html)                            // called once by Kotlin after loadDataWithBaseURL? NO —
                                                       // Kotlin injects raw html via loadDataWithBaseURL; the entry script
                                                       // runs Readability itself on document.
ReaderAndroid.paintHighlights(jsonArrayString)         // K→JS: paint saved highlights (anchor resolve incl. fuzzy)
ReaderAndroid.revealHighlight(id)                      // K→JS: scroll into view + 2.6s emphasis pulse
ReaderAndroid.setReaderTheme({dark,fontPx,serif,wide}) // K→JS: flips CSS vars/class
ReaderAndroid.getArticleText(): string                 // K→JS via evaluateJavascript promise
ReaderAndroid.onScroll(pct)                            // JS→K throttled scroll position
Kotlin side (AndroidBridge, @JavascriptInterface):
  onReady(), onHighlightCreated(json), onHighlightUpdated(json), onHighlightDeleted(id), onLinkTap(url),
  onScrollPct(pct), onSelectionState(json|null)   // selection metadata for mic/comment targets
```
Kernel behavior notes:
- Selection → swatch pill floats above selection start (reuse desktop popup logic; hide on
  scroll/collapse). Color tap → kernel creates highlight (existing merge/recolor semantics) AND
  calls `AndroidBridge.onHighlightCreated(json)` with the SAME JSON shape as desktop
  TextHighlightData (`type:'text'`, xpath+offsets over READER dom, content quote, anchor{quote,prefix,suffix,occurrence,surface:'web'}, color).
- Mic button on pill → `AndroidBridge.onMicPressed(id)` equivalent via onSelectionState carrying
  `{highlightIds:[...], quote}` so Kotlin can create-or-target then run its voice flow.
- Comment button → same payload.
- Same-page links (`#frag`) scroll internally; other links → `onLinkTap(url)` (Kotlin decides
  browser vs internal).
- Ctrl+A works natively; select-all + swatch = bulk highlight path (kernel already supports
  multi-range creation).

## Requirements
- Reuse TS sources by import where possible; where a module is chrome-bound, extract its pure
  core into `src/android/` adapters rather than editing the original files (log every copy).
- No React/DOM framework — vanilla TS, IIFE output.
- Smoke-check the bundle loads in a plain browser fixture page (a small `test.html` you may add
  under `scripts/` or `src/android/test/`) — readability swap + paint + pill visible.
- NO Kotlin/Gradle changes in this task. MINIMAL tests: none beyond the manual smoke page
  (kernel logic already covered by shared/anchor.test.ts).

## Acceptance criteria
- `npx webpack --config-name <your-config>` (or the repo's build command) produces
  `android/app/src/main/assets/wwwreader/android-reader.js` (+ css).
- test.html demonstrates: raw cluttered HTML → cleaned dark article → select → colored
  highlight paints → badge appears.
- LOG.md documents: files created/copied/adapted, exact window API, asset paths, deviations.

IMPORTANT: Report progress EVERY response even mid-work — never return an empty final message.
Final message MUST include: bundle sizes, file list, API recap, deviations.
