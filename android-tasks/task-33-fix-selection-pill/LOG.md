# LOG — task-33-fix-selection-pill

## [2026-08-22 00:59] task-33 agent
- **What I learned:**
  - The selection defects traced to `ReaderSelectionState.updateTo`'s strict
    `rootBounds.contains(root)`: padding gaps between blocks were dead zones, so the
    focus stuck on a stale block or collapsed to offset 0 → whole-neighbor-block and
    1-char selections. `SwatchPill.kt` used 48dp targets/44dp dots, 24dp corners,
    centered-on-center placement — nothing like plan §6.2/§6.5.
  - Spec A1's "block whose vertical span center is closest to root Y" is ambiguous;
    center-distance picks the WRONG block when the finger is inside a tall paragraph
    (its center is far away while a nearby one-line heading's center is close).
    Implemented vertical distance-to-span (inside ⇒ 0) instead — satisfies every case
    in the defect report; logged here as a deliberate deviation per AGENTS.md §6.
  - `snapToWords`: whitespace-only spans must return an empty range (caller cancels),
    so trimming precedes expansion; punctuation joins words because whitespace is the
    only separator. First test draft expected `(note)` → `note` — wrong per spec
    ("punctuation counts as part of the word"); implementation was right, test fixed.
  - Pre-existing crash risk fixed en route: `onDragStart` coerced into
    `0..len-1`, which throws `IllegalArgumentException` for empty blocks.
  - Audit findings already implemented by earlier tasks (verified, not rewritten):
    pill scroll-dismiss (`ReaderScreen` watches `listState.isScrollInProgress`),
    badge-over-link tap priority (`ReaderAnnotationMount.onTap` checks painter hits
    first), RehintWriter path executes (`LaunchedEffectRewrite` → `onHintRewrite` →
    `RehintWriter.apply` writes `extras.hint` → `persistUpsert`), back unwind order
    (selection BackHandler composed before sheet handler, so sheet wins while open).
- **Decisions made:**
  - Word snapping lives in ONE place — `spans()` — which feeds both the live preview
    styling and the commit path, so preview and commit can never disagree (A3 "both").
  - Touch-slop gate inside `TextWithGestures`: system `ViewConfiguration.scaledTouchSlop`
    from `LocalContext`; below slop nothing reaches `updateTo`, so release cancels via
    the existing degenerate-spans path. First past-slop position is fed immediately.
  - Min-length gate at commit only (A5): <2 snapped chars across all spans → `clear()`,
    pill never raised.
  - `start()` now clears `committed`/`commitPill` — without it a new drag showed the
    PREVIOUS selection's pill while dragging (stale-pill audit item; Ctrl+A made this
    reachable since select-all sets `committed` with no anchor/focus drag).
  - Ctrl+A (C7): `selectAll(article)` builds word-snapped spans over every non-empty
    text block; pill rect from the first span's block; handled on KeyUp in
    `onPreviewKeyEvent` on the reader root, inert while the sheet is open so the
    comment field keeps its own select-all.
  - SwatchPill (B): ≤52dp strip = 40/36dp buttons + 4dp v-padding (10dp h-padding,
    26dp corners, SurfaceElevated + 1dp Hairline + 8dp shadow); swatches 36dp targets
    with 24dp dots (2dp white ring appears on press — no active-color prop exists, so
    "active ring" is interpreted as pressed feedback); icons 40dp targets, 20dp
    onSurface icons; 6dp gaps. Placement helper `placePill` (pure, internal): center-x
    on selection start-x, bottom 8dp above selection top, flip to 8dp below bottom when
    no room above, clamped ≥8dp edges; entrance pivot = top-center of the selection rect
    (= pill bottom-center above / top-center flipped). Cross-file edits logged:
    `NativeReader.AnnotationHost` gained `onLinkTap` (default `{}`, threaded into the
    annotated branch replacing the no-op lambda); `ReaderScreen` passes
    `runCatching { uriHandler.openUri(target) }` and adds the key-event modifier.
- **Open questions:** none blocking; pressed-ring-instead-of-selected-ring needs a
  product look if a persistent "current color" indicator is wanted later.
- **Progress:** all of A/B/C/D implemented; `assembleDevDebug` BUILD SUCCESSFUL;
  targeted tests `com.scholiast.android.ui.reader.*` green — 21 tests, 0 failed,
  0 skipped (incl. new `SnapToWordsTest`, 4 cases); APK installed to Waydroid
  (`waydroid app install app-dev-debug.apk`, silent success).

## [ORCH] Task 33 follow-up — user retest round 2 (orchestrator-implemented)
- **What I learned:** Root cause of "selects many far lines": LazyColumn DISPOSES off-screen blocks but SelectionTracker never dropped entries — stale bounds at old scroll positions poisoned nearest-block focus. Also: Coil 3 ships without any network fetcher (no coil-network-okhttp) → every remote image failed silently (blank article images AND favicons).
- **Decisions made:** (1) Tracker hygiene: removeBlock() from each block's DisposableEffect; nearest-block now only sees live blocks. (2) Tap on plain text clears pending selection/pill (stuck-selection fix). (3) Scroll NO LONGER clears a pending selection — pill hides during motion, re-anchors from fresh layouts on settle, clears only if anchor block was disposed. (4) Ordered lists: LinearBlock.listOrdinal (+anchorId) added (nullable → stored readerJson stays compatible); linearizer numbers <ol> items per list, nested lists restart; renderer prints "n." instead of "•". (5) Same-page #fragment links scroll to the block with matching anchorId (element/ancestor id), toast if missing; cross-page links still open browser. (6) "Copy article" in top-bar overflow → clipboard plain text + toast. (7) coil-network-okhttp 3.2.0 added.
- **Open questions:** none
- **Progress:** assembleDevDebug green; ui.reader + Linearizer tests pass; APK installed to Waydroid.
