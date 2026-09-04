# Product Spec: Margin Comments & Gutter Layout

## Summary
Margin-anchored comment cards with threaded replies, collision-free vertical stacking layout, dynamic viewport gutter compensation, tag autocomplete, and WYSIWYG rich-text editing.

## Behavior

1. **Triggering a comment** creates a card in the right margin vertically aligned with the highlight's top boundary.
2. **If multiple highlights share vertical proximity**, comment cards stack downwards in document order without visual collision or overlap.
3. **The extension measures right-hand viewport clearance** and automatically applies a 320–360px gutter when space is insufficient, preventing cards from obscuring body text.
4. **Each comment card supports a root note and threaded replies**, ordered chronologically.
5. **Comments are authored in a rich WYSIWYG `contenteditable` composer** supporting bold (`**`), italic (`*`), inline code (`` ` ``), bullet lists, and `#tags`.
6. `Ctrl+Enter` / `Cmd+Enter` submits drafts; `Esc` cancels draft changes without deleting saved threads.
7. **Clipboard images pasted into the composer** generate inline thumbnails that expand into high-resolution modals upon click.
8. **Clicking a comment card** scrolls the viewport to center its highlight; clicking a highlight pulses the corresponding card.
9. **Comments exceeding 3 visible lines** are clamped with a "Show more" toggle to maintain gutter density.
10. **Typing `#` opens an inline tag autocomplete dropdown** populated from the global tag index.
