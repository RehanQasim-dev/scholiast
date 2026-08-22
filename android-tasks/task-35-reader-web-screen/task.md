# Task 35 — ReaderWebScreen: swap NativeReader for the WebView reader

Status: DONE

## Objective
ReaderScreen stops rendering Compose blocks and hosts a WebView running the `android-reader`
bundle (Task 34). All annotation traffic flows through the bridge into existing Kotlin
persistence (repository → sync), and the voice flow + ThreadSheet remount onto bridge events.

Plan: `../scholiast_web_annot_app_plan.md` Revision B — bridge contract table is there; code
against EXACTLY the window API Task 34 documents in its LOG.md.

## Scope — files you OWN
- NEW `ui/reader/ReaderWebView.kt` — AndroidView wrapping WebView:
  - `loadDataWithBaseURL(pageUrl, rawHtml, "text/html", "utf-8", url)` where rawHtml was fetched
    by the ViewModel via existing OkHttp path (reuse ReaderViewModel fetch chain; cached
    `readerJson` now = cleaned-HTML cache: store RAW html + fetchedAt; readability runs in-page).
  - WebView settings: JS enabled, DOM storage, dark background; Chrome UA not needed (offline
    local render); `addJavascriptInterface(AndroidBridge, "AndroidBridge")`.
  - Inject `android-reader.js` after page load (`onPageFinished` → evaluateJavascript reading
    the asset). Re-inject on nothing else (no SPA navigation — static html).
  - Bridge methods per contract → route: created/updated/deleted → repository.upsert/delete +
    enqueueSyncNow + refresh highlights state + re-call paintHighlights; onReady → paint saved
    highlights + setReaderTheme(current prefs) + restore scrollPct; onScrollPct → debounce save;
    onLinkTap → same-page check stays KOTLIN-side? NO — kernel handles internal scrolling itself;
    bridge only forwards external links to browser. onSelectionState → store latest payload for
    mic/comment targets.
  - evaluateJavascript helpers for every K→JS call.
- `ui/reader/ReaderViewModel.kt` edits: fetch chain unchanged; drop linearize step; readerJson =
  raw HTML string (schema field reuse — document in LOG; no migration needed, TEXT column);
  expose highlights state + mutation helpers it already has.
- `ui/reader/ReaderScreen.kt` edits: replace NativeReader+AnnotationHost block with
  ReaderWebView; keep TopBar (typography now calls setReaderTheme via webview handle),
  Copy-article (via getArticleText), deep-link reveal (revealHighlight), scroll persistence,
  SHEET-SLOT: ThreadSheet + RecolorRow + ReaderVoiceOverlay + ReaderToast — wire their
  create/recolor/reply/delete paths to repository as today AND push updated highlight JSON to
  the webview after each mutation.
- Mic/comment from pill selection state: when kernel reports a fresh selection WITHOUT an
  existing highlight id and user presses mic/comment, Kotlin creates the highlight(s) itself via
  HighlightController? NO — controller is being deleted in T36; instead kernel creates on color
  tap only, while mic/comment carry `{highlightIds, quote}` of an UNCOMMITTED selection: Kotlin
  then asks kernel to commit with default yellow first (`ReaderAndroid.commitPending('yellow')`
  — add this one function to the contract if missing; coordinate via LOG note) and proceeds.
  Document exact resolution in LOG.md.
- MINIMAL TESTS ONLY: ReaderViewModelTest adjustments for the changed load chain (cached html /
  fetch ok / failed) — nothing more.

## Requirements
- No changes to: domain/reader/* (T36 deletes), voice controllers, ThreadSheet internals,
  repository/sync, Home/routing.
- Dark toggle + typography must visibly restyle without reload (CSS vars/class flip only).
- Offline: cached html renders fully offline; images inline remote (load lazily, failures leave
  alt text — acceptable).
- Build green: ./gradlew assembleDevDebug; targeted ui.reader tests pass.

## Acceptance criteria
- Share article → cleaned dark article renders in WebView; select text → pill → color paints +
  badge; mic → bubble → transcribe → preview sheet → Save appends to notes + badge count grows;
  ThreadSheet replies/recolor/delete reflect instantly in painted page; kill/reopen restores at
  scroll %, highlights repainted; Ctrl+A select-all + swatch creates multi-block highlight.
- LOG.md: bridge wiring map, deviations, manual checklist results.

Report progress EVERY response even mid-work — never return empty. Final message MUST include:
build outcome, test counts, files touched, deviations.
