### 3.2 Commenting & annotation system
- Comments render as floating **cards in a single right-side column**, stacked top-to-bottom in
  document order of their highlights without overlap; if the viewport lacks room, a gutter is reserved
  and the page's content is pushed leftward. (Always-right avoids cards landing over left-side page
  chrome like a TOC.) The column is anchored by an explicit `left` in page coordinates (not `right`), so
  the reserved gutter can't drag the cards back over the text on pages with a positioned body, and the
  layout is recomputed on window `resize` / `visualViewport` resize.
- **The gutter is derived from the column, then measured** (`reserveCommentGutter`). The column's left
  edge is the single source of truth: content must end a gap short of it. A body `margin-right` is
  applied and the result **re-measured** (up to 3 passes) rather than computed from one pre-reflow
  reading, because how far content actually moves is up to the page — a centred `max-width` wrapper
  moves half as far as the margin, and a body whose width doesn't come from its margins (flex,
  `width: 100vw`, a positioned wrapper) doesn't move at all. When the body margin turns out to be inert,
  padding on `<html>` takes over (its `clientWidth` includes that padding, so the column's position is
  unaffected). Card width is also capped at a **share of the viewport** (`COMMENT_COLUMN_MAX_SHARE`),
  since a fixed 384px column swallows most of the window once **browser zoom** shrinks the viewport in
  CSS pixels. Together these are what stop cards from overlapping text at high zoom.
- **Empty comment editors are discarded on click-away**: the box disappears (the highlight stays)
  instead of lingering as an empty field.
- **`Ctrl`+click** an existing highlight opens its comment bar for typing.
- **Threaded replies**: a reply bar at the bottom of each card adds replies to the thread. Each reply
  has its own delete button; the **delete-whole-thread** button only appears (on the first reply) once
  the thread holds 2+ replies, since with one reply the two buttons would do the same thing.
- **Smart truncation**: replies longer than 3 lines collapse; 4th line fades/blurs out.
- **Seamless Expansion & Edit**: clicking a collapsed reply expands it immediately in a single step, in the *same* render that reveals the thread's reply field (both are applied on mousedown, so neither appears a frame ahead of the other). Clicking away — on the page or on another card — collapses the reply and hides the reply field together. Double-clicking any reply enters edit mode in a **single paint**: a render only replaces the comment items whose markup actually changed (per-item diff, not the card's innerHTML — a full rebuild re-created every image in the thread and blinked), the reply field stays mounted and is hidden by CSS (`is-editing-note`) so the card's height and the column's stacking don't change, and the caret is placed synchronously in the same task as the render.
- **WYSIWYG contenteditable Editor**: Replaced the traditional `<textarea>` with a `contenteditable` `div` for comment editing.
  - **Inline Pasted Images**: Pressing `Ctrl+V` pastes images directly into the cursor location in the editor, showing a visual preview rather than raw markdown.
  - **Image Gallery Layout**: Pasted images wrap into rows of up to 2 side-by-side images (50% width), forcing any subsequent text below them.
  - **Auto-linking pasted URLs**: Pasting or typing a URL (or opening an existing link) displays a blue clickable `<a>` link inline in the editor, opening in a new tab when clicked.
  - **Formatting bar**: the editor's bottom row holds **bullet list / checklist / bold / italic** on the left, with the diagram + send buttons on the right. That row is always its own line (the buttons never float into the text), so the space beside them is used rather than left blank. Buttons light up for whatever applies to the caret, `Ctrl+B`/`Ctrl+I` do the same thing, and formatting is applied through the browser's own editing commands so undo and caret behaviour stay native.
  - **Real formatting while editing**: bold, italic, bullets and checkboxes render as themselves in the editor — never as raw `**` markers. Checklist items can be ticked in a *saved* comment too, which rewrites and saves the comment's markdown (so the state syncs).
  - **`#tag` pills while writing**: tags render as pills in the editor as well as in the saved comment
    (`refreshTagPills`, shared by the comment box and the dashboard editor). The token the caret is
    inside is left as plain text — pilling it mid-word would trap the next keystroke inside the pill — so
    a tag becomes a pill once it's finished (a space, or the caret moving away). Pills need no special
    serialization: a `<span>` serializes to its own text, which is exactly `#tag`.
  - **LaTeX**: `$inline$` and `$$block$$` render in the comment (both surfaces) via **KaTeX in MathML
    mode** — the browser typesets it, so there are no font files to ship, no KaTeX stylesheet for a host
    page's CSS to fight, and nothing for the extension CSP to block. Math is pulled out of the text
    *before* escaping and the inline-markdown passes (TeX is full of `*`, `_`, `\`, `<`) and substituted
    back afterwards. Edit mode keeps the raw `$…$` source, and the stored markdown is unchanged, so the
    same comment renders in Obsidian. Prose about money is safe: an opening `$` must not be followed by
    whitespace and the content must not end in it.
  - **Checklist caret enforcement**: the caret can never land before or inside a task item's
    `<span class="ob-md-check">` checkbox — typing, clicks, selection changes, `Home` **and `ArrowLeft`**
    all clamp at the first character after the box. Pressing `Backspace` there clears the checkbox and
    **lifts the line out of the list entirely**, as a plain text line (it used to leave the `<li>` behind,
    so clearing a checkbox silently turned the item into a bullet).
  - **Serialization**: `utils/comment-markdown.ts` is the single definition of the comment markdown subset — `**bold**`, `*italic*`, `[text](url)`, bare urls, `#tag`, `- item`, `- [ ] task`, `<!--image:ID-->`, `<!--diagram:ID-->` — with three conversions: markdown → display HTML, markdown → editable HTML, and editor DOM → markdown. Every surface (comment box, its editor, the dashboard) goes through it, so a comment reads the same everywhere and stays valid Obsidian markdown. Covered by `comment-markdown.test.ts` (round-trip + escaping). Checklist editing keeps the caret
    *after* the (uneditable) checkbox: applying the format resolves the new list without relying on
    the browser's reported selection, and `repairTaskList` re-adds the box the browser drops when
    Enter splits an item.
  - **Backup/sync**: a pasted image is registered in the `diagrams` map on save (`{ updatedAt, pasted: true }` — no scene) so it travels to Drive on the same path as a drawn diagram: PNG blob out, blob pulled back into IndexedDB on another device, map entry dropped (and the remote blob tombstoned) when its comment is deleted.
  - **Keybinds**: `Enter` inserts a new line inside the editor; `Ctrl+Enter` saves/commits the comment.
- **Google Sync Status Icon**: Each reply displays a cloud sync indicator icon in its top-right corner. It is styled with a light/dull gray color when pending sync, turning into a bright green-tinted icon (`#6fcf97`) once successfully merged and synced to Google Drive.
- **Diagrams**: An "Add Diagram" button in the comment editor opens a dedicated, isolated Excalidraw window. The comment is created **only when the editor saves** (the diagram-id→highlight mapping is held pending until the save lands), so closing the editor without saving leaves no orphan comment. The editable **scene JSON** is stored in `browser.storage.local` under the `diagrams` key (`{ sceneData, updatedAt }`); the **rendered PNG is stored as a binary blob in IndexedDB** (frame-store `diagrams` store, keyed by diagram id) and rehydrated on demand — never inline in any JSON. Editing reuses the same diagram id (overwrites in place, no orphan); deleting the comment drops both the `diagrams` entry and the IndexedDB blob.
- **The diagram save path is explicit, not inferred.** The editor commits any in-progress text element
  (it lives in an overlay textarea until it loses focus, so saving straight from the button left the last
  thing written out of the PNG), writes the blob, **reads it back to confirm** it landed, then publishes
  the metadata, then messages the page **with the PNG attached** — relayed by the background to every
  tab. The page never has to read the blob store back, and `storage.onChanged` is now only the fallback
  (it still covers a diagram that arrived from a sync pull). Both paths funnel into the idempotent
  `applyDiagramUpdate`. A failed save keeps the window open and says why rather than closing on a lost
  drawing. The pending diagram-id→highlight mapping is also **mirrored into storage** and swept on page
  load, so a drawing that takes a while and is saved after the tab reloaded still gets its comment.
- **Grouped highlights are one annotation on the live page**: a multi-block selection (e.g. several
  bullet points sharing a `groupId`) shows a **single comment box / thread** anchored to the group's
  first piece — comments save to that representative, and edit/delete map the flattened thread index
  back to the piece that owns each note. Hover-emphasis lights up **all** pieces of the group at once.

