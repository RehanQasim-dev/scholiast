# Product Spec: Tauri Margin-Anchored Comment Cards

## Summary
Replace the Reader's separate-scroll annotations panel with extension-style
margin cards: each annotation renders as a collapsed card beside its source
line, scrolling with the article in a single scroll container. Clicking a card
expands its thread + reply box; an invisible splitter resizes the card column
page-wide; the column can be hidden. Ships first for extracted Reader mode,
then for web (authentic/iframe) mode. Dark + green app theme throughout.

## Behavior

1. **Margin column replaces the separate-scroll panel at widths above 900px**
   (`!isNarrow`: desktop + landscape tablet). Phones keep the bottom sheet;
   web/authentic mode keeps `ThreadPanel` until batch 2.
2. **Each annotation is one card anchored beside its source line** (grouped
   highlights share one card on the group's first piece, extension semantics).
   Cards order top-to-bottom by anchor position and never overlap (min 12px
   gap); anchors that cannot be placed stack after placed cards.
3. **One shared scroll**: cards live inside the article's scroll container, so
   paging the article carries the cards with it. The margin layer has no
   scrollbar of its own.
4. **Collapsed by default**: quote clamped to 3 lines + relative time + reply
   count only. Clicking a card expands the full thread and its reply box;
   clicking the page or another card collapses it again.
5. **Reply lives in the expanded card** (same markdown subset, formatting
   buttons, `#tag` autocomplete, `Ctrl+Enter` send as the panel composer).
   No separate reply surface.
6. **Invisible splitter**: a near-invisible full-height grab line between
   article and cards resizes the card width for the whole page, persisted per
   `reader.margin_width` pref; double-click resets to default. Hover/drag
   shows the accent tint, same as `SplitterPane`.
7. **Hide/show**: the existing annotations toggle (top bar + tablet dock)
   hides the margin column and the article reclaims the width. State is
   session-only, same as today.
8. **Theme**: cards reuse `ThreadCard` + app tokens (`--sc-*`, accent green);
   no extension styles leak in. Touch divider hit area is wider on coarse
   pointers (tablet).
9. **Keyboard + a11y**: `j/k` walks annotations, `aria-expanded` on cards,
   `role="separator"` on the splitter, `prefers-reduced-motion` respected.
10. **No data-model change**: threads, marker strings, optimistic patches and
    undo flow through the same query cache + IPC as `ThreadPanel` (batch 1
    extracts them into a shared hook; panel render output is unchanged).
11. **Batch 2 (web mode)**: same cards beside iframe content, anchors measured
    through the same-origin `srcDoc` document, overlay tracks iframe inner
    scroll. Requires painted highlights + stored anchors in web mode first.
