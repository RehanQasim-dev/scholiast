## 3. Implemented features

### 3.0 Annotation mode & toolbar
- **Two-stage popup**: clicking the extension icon opens a compact quick-actions popup (action
  icons + a "Clip this page" button) with **no content extraction**. The full clipper UI — and the
  expensive page-to-markdown conversion — loads only when "Clip this page" is pressed (or a quick
  clip is triggered). Side panel and embedded iframe skip the quick state and load the full clipper
  immediately, as before. Boot cost is kept to what that first strip needs: settings and the active
  tab load in parallel, `getActiveTab` returns the tab **url and highlighter state** with the tab id
  (one service-worker round trip instead of three, which matters on a cold worker), icons are built
  in a single pass, and templates / triggers / vault list / property skeleton load with the clipper
  rather than at open (`loadClipDependencies`).
- Annotating is an explicit, opt-in **annotation mode** per page: entered via the extension's
  highlighter toggle (or the `H`/`P` keys), never during normal browsing. Stored highlights and
  comment boxes still render on page load regardless of mode — mode only gates *creating/editing*.
- While the mode is on, an **Excalidraw-style toolbar** floats top-center
  (`src/utils/annotation-toolbar.ts`): **Select** (browse/manage), **Highlighter** (`H`),
  **Pen** (`P`), and **×** (exit mode). Tools change only when the user changes them; the active
  tool is always visibly marked. Last-used tool is remembered (storage `annotationLastTool`) and
  restored on mode entry.
- The toolbar doesn't own the tools — it syncs to the existing body-class toggles via a
  MutationObserver, so every entry path (keys, popup, messages) stays consistent, and any tool
  activation auto-shows the toolbar. It is the **only** on-page tool UI: the old bottom
  "Clip highlights" menu bar was removed entirely (its actions live elsewhere — clip via the
  popup, undo/redo via `Ctrl+Z`/`Ctrl+Shift+Z`, exit via the toolbar ×).
- **`Esc` steps down one level**: active tool → Select; already on Select → exit annotation mode.
- **YouTube Frame Annotator UI**: Reused Excalidraw iframe (`video-excalidraw.tsx` / `video-excalidraw.html`) uses solid dark backdrop (`#070d0a`) masking background video bleed-through, Excalidraw `theme="light"` (preventing element color inversion on the transparent video canvas) styled with dark-mode glass chrome and light `#e3e3e8` icons, hides native hamburger menu (`≡`), hides canvas hint banners. All floating control bars are unified to a sleek `30px` height with `24px` buttons, `12px` icons, and `8px` rounded glass pills at `6px` viewport margin (top toolbar and top-right action buttons aligned at `top: 6px`; undo/redo, properties dock, and Dim slider aligned at `bottom: 6px`). Reserving `TOP_BAND = 38; BOTTOM_BAND = 38` scales the captured video frame to the maximum possible region between the top and bottom toolbars with zero overlap over the snapshot. Pressing `S` automatically closes any active sidepanel (comments/transcript) immediately and captures the full-bleed player; pressing `C` in snapshot mode saves the annotated frame and immediately opens the comments panel with the snapshot thumbnail attached and the reply input focused. Fullscreen Escape isolation runs via MAIN world `vps-scrubber-patch` with `navigator.keyboard.lock(['Escape'])` and `window.postMessage` bridge, intercepting `Esc` in fullscreen to close the active overlay/panel without dropping fullscreen, with clean fallback teardown if fullscreen is exited.

### 3.1 Text highlighting (Marker)
- **`H`** toggles the highlighter tool (entering annotation mode if needed).
- Smart cursor: hovering an annotation/comment card disables the highlighter (reverts to normal
  cursor) to avoid accidental highlights; restores on leave.
- Hovering a highlight floats its **action bar** (colors / comment / delete) just above the text.
  The strip of empty space between text and bar counts as part of the bar, so reaching for a button
  doesn't flicker the highlighter cursor back or retarget the bar. Leaving a highlight hides the bar
  and restores the cursor **in the same frame**, unless the pointer is measurably closing in on the
  bar (two-sample distance check) — in which case it lingers ~400ms so it can be reached.
- Selecting text shows a floating **color-swatch popup** (circular swatches above the selection).
  Picking a color recolors the whole linked group.
- **`Ctrl`+highlight** → creates the highlight and immediately opens a new comment box for it.
- Works inside code blocks and stays clear of images during navigation.
- **Selection hygiene** (ported from the Hypothesis client): before a selection becomes a highlight
  the range is passed through `trimRange` (`src/utils/trim-range.ts`), which tightens both boundaries
  to the nearest non-whitespace character so a triple-click's trailing newline doesn't get baked into
  the anchor's quote/offsets. Selections inside an editable context (input / textarea /
  contenteditable / ARIA textbox) are ignored via `isEditableContext` (`src/utils/dom-utils.ts`) so
  text picked in a page search box or rich-text editor never turns into a highlight.
- **Support for DIV/Callout Block Highlights**: Restructured text block container matching to support selecting and highlighting text inside callouts and box components built using nested `DIV`, `ARTICLE`, `SECTION`, `MAIN`, `ASIDE`, `HEADER`, or `FOOTER` elements (previously these collapsed or failed to highlight).
- Undo/redo: `Ctrl+Z` / `Ctrl+Shift+Z`. `Esc` drops to the Select tool (see §3.0).

