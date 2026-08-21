# Task 28 — Reader shell: routing, Home Pages tab, native renderer

Status: DONE

## Objective
The Reader surface end-to-end for READING (no annotation yet): share-intent/open-link routing,
`Routes.READER`, ReaderScreen with auto-hide translucent top bar, the NativeRenderer LazyColumn
consuming `LinearArticle`, typography controls, scroll persistence, extraction error card, and
the Home segmented Videos|Pages tab with favicon rows.

Plan: `../scholiast_web_annot_app_plan.md` §5.1–5.3, §6.1–6.3, §6.5 (top-bar row). Design rules:
`android/AGENTS.md` §3; motion values from plan §6.5.

## Scope — files you OWN (in `../android/`)
- `ui/navigation/Routes.kt` (+`READER?url=…`) and the new composable branch in
  `ui/navigation/ScholiastApp.kt`.
- `ui/home/HomeScreen.kt` + `ui/home/HomeViewModel.kt`: segmented tabs; Pages rows via
  `PageHighlightRepository.pagesWithHighlights()` (Coil favicon `https://<domain>/favicon.ico`
  with letter-avatar fallback); tap → Reader at saved scroll; long-press → remove-from-list.
  Extend open-link/share parsing: YouTube → Player, other URL → Reader, invalid → existing toast.
- `MainActivity.kt`: route share text by URL type (minimal edit — reuse HomeViewModel entry).
- `ui/reader/ReaderScreen.kt`, `ui/reader/ReaderViewModel.kt`,
  `ui/reader/NativeReader.kt`, `ui/reader/ReaderTopBar.kt`, `ui/reader/TypographyPopover.kt`,
  `ui/reader/ExtractErrorCard.kt`.
- Loading chain in ViewModel: cached readerJson? render : Extractor.extract → Linearizer.linearize
  → saveReaderArticle → render. Shell result → fallback state (read-only WebView of the URL +
  toast "Showing original — can't annotate this page yet"); Failed → ExtractErrorCard (retry /
  open in browser).
- Renderer: LazyColumn of blocks per kinds from Task 26 (`li` gets bullet styling; `img` = Coil
  item with `DisableSelection`; links annotated, clickable where target resolves; headings styled
  by level). Max-width 640dp centered on wide screens; fontStep/serif/wideWidth from ReaderPrefs;
  scroll position persisted per url on debounce (~500ms), restored on reopen.
- Top bar: back · ellipsized title · sync dot · overflow (typography popover, open original,
  delete page data w/ typed confirm reusing existing dialog pattern). Translucent surface;
  hides on scroll-down / returns on scroll-up tracking the finger 1:1 (offset tied to scroll
  delta, no independent animation).
- Leave clearly-marked integration stubs for later tasks: `/* ANNOTATION-SLOT */` region in
  NativeReader (where Task 29's painter + pill mount) and `/* SHEET-SLOT */` in ReaderScreen
  (Task 30 voice / Task 31 sheet). Do NOT build annotation UI.

## Requirements
- Motion: top bar per §6.5; content list has NO entrance animations (high-frequency rule).
- Offline: cached articles read fine; fresh fetch failure shows error card (no spinner loops).
- Targeted build check: `./gradlew assembleDevDebug` compiles; add `ReaderViewModelTest` for the
  load-chain states using fakes (no network): cached / fetch-ok / shell / failed.

## Acceptance criteria
- Share a normal article URL → clean native read; kill+reopen → instant from cache at saved scroll.
- Share a YouTube URL → Player (unchanged behavior); Home tabs switch; Pages row opens Reader.
- CSR/paywall fixtures → fallback/error paths verified in ViewModel tests.

## Agent notes
- Tasks 24/25/26/27 land before you start: use their real APIs (Extractor, Linearizer,
  PageHighlightRepository impl). Read their LOG.md entries first.
- You do NOT touch domain/reader/* files (consumed read-only), SyncEngine, or Room schema.
