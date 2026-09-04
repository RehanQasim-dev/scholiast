### 3.2a Editing a page image in Excalidraw (`utils/image-edit.ts`)
- Highlight an image (the `IMG`/`FIGURE`/`PICTURE` block highlight) and its action bar grows an
  **Excalidraw button** — the same icon as the comment editor's diagram button, since it opens the same
  editor. Shown only when the highlight is (or wraps) an `<img>`.
- The picture is seeded onto the canvas as an image element, and the export **replaces that `<img>` on
  the page**. Clicking the button again re-opens the *same scene*, so a previous edit can be changed and
  re-saved as many times as wanted — the diagram id is derived from the highlight id, so it's stable even
  if the editor was closed without saving.
- The bytes are fetched **in the background** (a cross-origin image is unreadable from the page, and only
  the background has the host permissions) and handed over through a short-lived `diagramSeed:<id>`
  storage key that the editor deletes once loaded. Re-seeding is skipped when a scene already exists,
  which is what makes the edit cumulative rather than starting over on top of the original.
- The edited PNG becomes the **canonical** image for that highlight: the live DOM swap means anything
  clipped from the page carries it (`srcset`/`sizes` are removed, since the browser would otherwise prefer
  them over `src`; the original is stashed in a data attribute), the dashboard card swaps its quote image
  to the edit, and `collectDiagramIds` picks the id up off the highlight so it syncs like any other
  diagram. Deleting the highlight restores the original image and drops the scene + blob.
- Re-applied from `applyHighlights`, so a synced edit, an undo, or a page re-render all land through one
  path.

### 3.3 Pencil tool (freehand drawing)
- **`P`** activates pencil. Strokes drawn on a full-document SVG overlay.
- **`1` / `2` / `3`** switch between 3 predefined colors; the on-screen nib recolors to match.
- **Selector**: holding **`Ctrl`** (with pencil or normal cursor) turns the cursor into a marquee
  selector. Drag to select strokes, **`Delete`** to remove. Selector ignores text highlights.
- Pencil and highlighter are mutually exclusive (entering one exits the other).

