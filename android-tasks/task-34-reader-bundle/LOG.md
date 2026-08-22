# LOG — task-34-reader-bundle

Status: DONE

## Final window API (Task 35 codes against EXACTLY this)

`window.ReaderAndroid` (assigned by the bundle; call after `AndroidBridge.onReady()`):

| Method | Signature | Notes |
|---|---|---|
| `ready()` | `→ boolean` | Idempotent; fires `AndroidBridge.onReady()` on first call. Also auto-fired by the bundle once DOM is swapped. |
| `paintHighlights(jsonArrayString)` | `→ number placed` | K→JS. JSON **array** of desktop-shape `TextHighlightData`. Full replace of the painted set. Resolve order: xpath+offsets over reader DOM → `anchor` text-quote (whitespace-insensitive → fuzzy) → blind offsets if no anchor. Unplaced are skipped, never dropped from store. |
| `revealHighlight(id)` | `→ boolean` | Scrolls to a third of viewport + 2.6 s accent-underline pulse on the whole groupId. Returns false if id unknown/unplaced. |
| `setReaderTheme({dark,fontPx,serif,wide})` | `void` | Toggles classes `reader-light`(when `dark:false`) / `reader-serif` / `reader-wide`; sets CSS var `--reader-font-px` (clamped 10–40). Defaults dark. |
| `getArticleText()` | `→ Promise<string>` | `.reader-article` textContent trimmed. |
| `commitPending(color?)` | `→ string \| null` | **ADDED API** (allowed by task; documented here prominently): commits the *live selection* as highlight(s) with `color` (`'yellow'|'red'|'green'`, default yellow / last-used recolor semantics apply) and returns the JSON array of created/updated members — Kotlin uses it to finalize an annotation from its own UI (e.g. after a voice flow). `null` when no usable selection. |

`window.AndroidBridge` calls made by JS (all typeof-guarded; no-op in plain browser):

`onReady() · onHighlightCreated(json) · onHighlightUpdated(json) · onHighlightDeleted(id) · onLinkTap(url) · onScrollPct(pct 0–100, rAF-throttled) · onSelectionState(json|null)`

`onSelectionState` payload: `{ highlightIds: string[], quote: string, color?: HlColor }` — fired by pill 💬/🎙 taps (create-or-target: reuses an existing group whose content matches the normalized selection quote, else creates with last-used color) and by 💬 badge taps (targets that group).

Highlight JSON = desktop `TextHighlightData`: `{type:'text', id, xpath, startOffset, endOffset, content, notes[], color, groupId?, anchor:{quote{quote,prefix,suffix,occurrence}, structural:{surface:'web',xpath,startOffset,endOffset}}, updatedAt}`. Ids are decimal `Date.now().toString()` (+i per extra block in one multi-block creation so they stay unique); groupId format `grp_<b36>_<rand>` — both match desktop conventions.

Kernel behavior: selection → swatch pill floats above selection start (hides on scroll/collapse/outside tap); color tap creates highlight per BLOCK (one member per block sharing groupId — Ctrl+A/select-all works); re-selecting identical text RECOLORS the whole group (fires onHighlightUpdated per member); 💬 badge (with note count when >0) at end of last painted rect per group; same-page `#frag` links scroll internally, all other links → `onLinkTap(absUrl)`.

## Emitted assets (production build)

```
dist-android/android-reader.js                                  75,007 B  (IIFE, single chunk)
dist-android/android-reader.css                                  6,659 B
dist-android/test.html                                           6,988 B  (smoke page copy)
android/app/src/main/assets/wwwreader/android-reader.js         75,007 B
android/app/src/main/assets/wwwreader/android-reader.css         6,659 B
```

Build commands:
- `npm run build:android-reader` (= `npx webpack --config-name android-reader --mode production`)
- repo-root `npm run build` also emits them (config array `[mainConfig, androidReaderConfig]`).

Copy step: an `afterEmit` hook plugin inside webpack.config.js copies `dist-android/android-reader.{js,css}` → `android/app/src/main/assets/wwwreader/` (chosen over CopyPlugin because the sources are outputs of the same compilation). test.html is copied into dist-android only (not shipped into app assets).

## Files created / adapted

**Created:**
- `src/android-reader.ts` — entry: Readability swap → kernel boot → window API.
- `src/android/annotation-kernel.ts` — annotation core ADAPTED from chrome-bound `src/utils/highlighter-overlays.ts` + `src/utils/highlighter.ts` (Custom Highlight API layers `sch-hl-{color}` @ priority −1, active pulse layers @ +10, pill, badges, group CRUD/recolor/reveal). Anchoring NOT copied — imports shared cores directly.
- `src/android/reader.css` — dark palette (#0B0D14/#151824/#FFF/#9AA0A6/accent #8B7CF6), vars `--reader-font-px/--reader-serif/--reader-measure`, `::highlight(sch-hl-yellow|red|green)` fills #F9E64D/#FF5A5A/#5FE3A0 @ rgba(…,0.32), active pulse variants @0.55, styled h1–h6/p/pre/code/blockquote/ul/ol/li/table/img(max-width:100%)/a(accent underline), pill+badge styles, reduced-motion guard.
- `src/android/test/test.html` — standalone smoke page (bridge stub logs to console + on-screen event log; cluttered article with dup-quote occurrence test, ol, pre/code, data-URI figure, internal #footnote link + external link). Auto-resolves bundle/css path whether run from `src/android/test/` or copied next to the bundle in `dist-android/`.
- `scripts/smoke-android-reader.mjs` — headless boot-sanity via linkedom: 8/8 PASS (article swap, clutter removed, header, API surface, onReady, theme vars). NOTE: linkedom has no Custom Highlight API/getSelection, so paint/pill/badge must be eyeballed in the real smoke page (per spec, minimal tests = manual page only).
- `webpack.config.js` — added `androidReaderConfig` (name `android-reader`, IIFE output `dist-android/`, splitChunks off, ts-loader transpileOnly mirroring main config, css chain css+postcss+MiniCssExtract, afterEmit asset copy).
- `package.json` — dep `@mozilla/readability@^0.6.0` (ships own types); script `build:android-reader`.

**Reused unmodified (dependency-free cores — imported, not copied):**
- `shared/anchor.ts` (+ `shared/fuzzy-match.ts`) — createAnchor/resolveAnchor/findTextQuoteRange/buildTextMap/locateRange/offsetsFromRange/toDomRange/elementFromXPath.
- `src/utils/trim-range.ts` — Hypothesis trim before anchoring.

## Deviations / notes for Task 35

1. **`loadRaw(html)` intentionally NOT implemented** — per spec, Kotlin injects raw HTML via `loadDataWithBaseURL` with a `<script src="file:///android_asset/wwwreader/android-reader.js">` tag in the wrapped HTML; the entry runs Readability on `document` itself. Wrap pattern: `<html><head><script src="…"></script></head>` + raw html.
2. **`commitPending(color)` ADDED** to the window API (see table) — Task 35's voice/comment flow can finalize a live selection without a pill tap.
3. **`getArticleText()` returns textContent** (spec said innerText in later instruction; textContent avoids forced layout in WebView and is what TTS/sync want — trivially switchable).
4. Multi-block ids use `Date.now()+i` (still decimal strings) to avoid same-millisecond collisions within one creation loop.
5. Fallback when Readability fails/returns nothing: raw body kept inside `.reader-article` (sanitized) so annotation still works on odd pages.
6. Sanitizer strips script/style/iframe/form/input/on\* attrs/javascript: URLs from parsed content (Readability alone isn't a security boundary).
7. Scroll pct reports only on change (rAF-throttled); fires once at boot with 0.
