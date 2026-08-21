# Task 33 — Fix selection accuracy + SwatchPill visuals

Status: DONE

## Objective
User-tested defects from the first on-device run (screenshot reviewed):
1. **Selection inaccuracy** — highlighting swallows whole neighboring blocks (even above the
   anchor) and sometimes collapses to one word/a few characters.
2. **SwatchPill is visually absurd** — enormous circles/icons floating over the text instead of
   a compact strip anchored just above the selection.

Root causes identified in code review:
- `ReaderSelectionState.updateTo` (ui/reader/ReaderAnnotationMount.kt) resolves the focus block
  via STRICT `rootBounds.contains(root)` — vertical padding gaps between blocks are dead zones,
  and when the finger leaves a block the stale focus or a collapsed local offset (<0 y → offset→0)
  selects block prefixes. Offsets are never snapped to word boundaries.
- `TextWithGestures` commits any drag, however tiny; no touch-slop gate, no minimum length.
- `SwatchPill.kt` ignores plan §6.2 sizing discipline (44dp *targets*, compact pill ≤52dp tall)
  and plan §6.5 placement (origin-aware, above the selection start, clamped, flip below when
  no room).

Plan: `../scholiast_web_annot_app_plan.md` §5.4, §6.2, §6.5.

## Scope — files you OWN
- `android/app/src/main/java/com/scholiast/android/ui/reader/ReaderAnnotationMount.kt`
- `android/app/src/main/java/com/scholiast/android/ui/reader/SelectionTracker.kt`
- `android/app/src/main/java/com/scholiast/android/ui/reader/SwatchPill.kt`
- `android/app/src/test/java/com/scholiast/android/ui/reader/` (a small pure-helper test if you
  extract word-snapping into a testable function — MINIMAL, see mandate)

Do NOT touch ReaderScreen/NativeReader/HighlightPainter/controller files unless a signature must
change — keep diffs surgical and log every cross-file edit.

## Requirements

### A. Selection accuracy
1. **Nearest-block resolution**: replace strict contains with nearest-block-by-vertical-distance:
   among `tracker.rootBounds`, pick the block whose vertical span center is closest to the root Y
   (handles inter-block gaps, heading paddings, image dead zones).
2. **Clamp offsets**: computed char offset per block coerced into `0..block.text.length`.
3. **Word-boundary snapping** at BOTH preview and commit: snap start → first char of the word
   containing it; end → last char of its word (`isWhitespace` scan; punctuation counts as part of
   the word). Extract as pure fun `snapToWords(text, start, endExclusive): IntRange` so it's
   unit-testable.
4. **Touch-slop gate**: ignore drag until movement exceeds `ViewConfiguration.get(context).touchSlop`
   (~8dp) from the long-press point; below that, treat as cancel-on-release.
5. **Minimum selection**: after snapping, if total selected chars across all spans < 2 → cancel
   (clear state, never show the pill).
6. Keep cross-block semantics (full intermediate blocks) but verify ascending order when dragging
   upward (anchor below focus) — spans() must normalize identically both directions.

### B. SwatchPill visual redesign (plan §6.2/§6.5 values)
- Pill container: height ≤ 52dp, horizontal padding 10dp, corner radius 26dp, surface color +
  1dp Hairline border + subtle elevation shadow (8dp blur). Total width should be ~5 buttons.
- Swatches: 36dp circular buttons (visual dot 24dp with 2dp white active ring), 6dp gap.
- Mic + comment icon buttons: 40dp touch target, 20dp icons tinted onSurface.
- Enter animation unchanged (150ms origin-aware scale .95→1 + fade) but ORIGIN = top-center of
  the selection rect.
- Placement: horizontally centered on the selection rect's start-x, clamped ≥8dp from screen
  edges; positioned so its bottom sits 8dp ABOVE selectionRect.top; flip BELOW (+8dp) only when
  insufficient room above. NEVER overlapping the first selected line.

### C. Additional user-reported defects (same pass)
6. **Hyperlinks don't open**: NativeReader passes `onLinkTap = { }` in its annotated path — wire
   it through AnnotationHost → `LocalUriHandler.openUri(target)` (runCatching) so links open in
   the browser again. Verify taps still prefer highlight-hits when overlapping.
7. **Ctrl+A select-all**: with hardware keyboard connected, Ctrl+A inside the Reader must select
   the whole article: build full spans (every text block 0..len) into `selection.committed` +
   pill rect from first touched block, so the pill offers highlight/mic/comment across all.
   Hook via `Modifier.onKeyEvent`/`onPreviewKeyEvent` on the reader root (Ctrl+A, also Meta/A).

### D. Interaction audit (fix silently, list in LOG)
- Pill dismisses on scroll (currently may persist while list scrolls).
- After createFromSelection the pill must never reappear for stale spans.
- Badge tap opens sheet even when badge sits at block end adjacent to a link.
- Rehint persistence actually writes extras.hint (verify RehintWriter path executes).
- Back gesture unwind still: sheet → pill/selection → exit.

### E. Verify
1. `cd /home/rehan-10xe/Documents/obsidian-clipper/android && ./gradlew assembleDevDebug` green.
2. Targeted tests incl. new snap helper cases (word edges, whitespace-only range, clamped ends).
3. `waydroid app install app/build/outputs/apk/dev/debug/app-dev-debug.apk`.
4. LOG.md entry documenting each fix + deviations; set "Status: DONE".

IMPORTANT: Report progress every response — NEVER return empty. Final message: build outcome,
test counts, what changed per file, Waydroid status.
