# Task 29 — Selection & highlight layer (paint, pill, anchors, badges)

Status: DONE

## Objective
The annotation engine over `LinearArticle`: text selection with coordinates, the SwatchPill,
synchronous highlight painting, badge chips, grouping, and anchor creation via Task 24's
`AnchorKt`. Standalone + preview-driven so it lands without touching Task 28's files.

Plan: `../scholiast_web_annot_app_plan.md` §4.2, §5.4, §5.9, §6.1–6.2, §6.5 (pill/badge rows).

## Scope — files you OWN (in `../android/`)
- `ui/reader/SwatchPill.kt` — 44dp color swatches 🟡🟢🔴 + mic + 💬 buttons; origin-aware scale-in
  from selection rect (150ms ease-out cubic-bezier(0.23,1,0.32,1), scale .95→1 + fade; exit
  reverse faster); ≥48dp targets; pressed scale(0.97) on touch-down; auto-dismiss callbacks.
- `ui/reader/HighlightPainter.kt` — paints highlights over blocks as `AnnotatedString`
  SpanStyles (hue at 32% alpha fill) + badge count chip inline at range end (`BadgeChip.kt`);
  O(1) repaint via stored `hint {block,start,end}`, falling back to
  `AnchorKt.findTextQuoteRange` over block text when hints miss (then rewrite hint).
  Grouped highlights: all pieces share color; tapping any piece reports the group.
- `ui/reader/SelectionTracker.kt` — wraps `SelectionContainer`'s selection state:
  `onSelectionChange(range)` → map to (blockIndex, start, end) per rendered Text layout results
  (`TextLayoutResult.getBoundingBox(start/end)`), clamp to screen, expose
  `SelectionAnchor(rectPill: Rect, blocks: List<BlockRange>)`. Pill hides on scroll/collapse.
- `ui/reader/HighlightController.kt` — the logic core (JVM-testable):
  - `create(blocks, sel, color): List<PageHighlight>` — trimRange hygiene, multi-block selection
    → one highlight per touched block sharing `groupId`, id = epoch-ms string, canonical
    `anchor = AnchorKt.buildTextQuoteAnchor(blockText…)`, `content` quote, extras `hint`.
    Overlapping/adjacent same-color ranges merge (Task 24's merge helper).
  - `recolor(group, color)`, `delete(group)` producing updated lists.
- Tests: `HighlightControllerTest` (creation shape vs plan §4.2 JSON, grouping, merging, hint
  fallback path) and a `SwatchPill` compose screenshot-less smoke test if the module allows.

## Requirements
- Paint is synchronous on color-tap (span applied in same composition); persistence happens via
  callback AFTER visual commit (latency audit §6.5). Haptic tick hook exposed as callback.
- Pure composables take state + callbacks; NO ViewModel/Room/network access here.
- Reduced-motion: honor existing app setting — transforms become opacity cross-fades.

## Acceptance criteria
- Controller tests pass (`./gradlew testDevDebugUnitTest --tests "…HighlightControllerTest"`).
- A @Preview shows painted multi-color grouped highlights over fixture blocks with badge.
- API documented in LOG.md for Task 30/31/32 wiring (they mount your components).

## Agent notes
- You own ONLY ui/reader/{SwatchPill,BadgeChip,HighlightPainter,SelectionTracker,
  HighlightController}.kt + tests. ReaderScreen/NativeReader integration is Task 32's job —
  do not edit them.
