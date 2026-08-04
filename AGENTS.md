# AGENTS.md — Implemented Architecture & Features

This file is the single source of truth for what is **already implemented** in this fork: the
architecture and the shipped annotation/notes/sync features, at a high level. Update this file
whenever a feature is added or significantly changed (see maintenance rules in `CLAUDE.md`).

---

## 1. Project overview

Browser extension (Chrome MV3 / Firefox / Safari), shipped as **Scholiast** — its own name, icon
(`src/icons/logo.svg`) and homepage, so the fork isn't mistaken for the official Obsidian extension.
Base product clips web pages to Obsidian.
This branch adds **live-webpage annotation** (highlights, comments, freehand drawing), a
**highlights dashboard**, **Google Drive sync**, and **YouTube video frame notes**.

- Language: TypeScript, SCSS. Bundled with webpack → `dist/`, `dist_firefox/`, `dist_safari/`.
- Manifests: `src/manifest.{chrome,firefox,safari}.json`. Permissions in use: `storage`,
  `unlimitedStorage`, `scripting`, `identity`, `alarms`, `commands`, `contextMenus`, `sidePanel`.
- Local feature commits are authored by `rehan` (see `git log --author=rehan`).

### Key files
| File | Role |
|------|------|
| `src/content.ts` | Page entry point. Inits highlighter+pencil, CSS injection, global keydown dispatch, exposes `window.__obsidianHighlighter` API bridge. |
| `src/utils/highlighter.ts` | Highlight CRUD, storage, anchoring, undo/redo, migrations, export grouping. |
| `src/utils/highlighter-overlays.ts` | Text/element rendering (CSS Custom Highlight API), color swatch menu, active-highlight emphasis. |
| `src/utils/comment-overlays.ts` | Comment card layout (right column), threads, truncation, edit/save/delete, WYSIWYG editor. |
| `src/utils/comment-markdown.ts` | The comment markdown subset: markdown ↔ display HTML ↔ editable HTML, formatting commands. Shared by the comment box and the dashboard. |
| `src/utils/pencil-overlays.ts` | Freehand SVG drawing, stroke storage, color switching, marquee select/delete. |
| `src/core/highlights.ts` | Annotation-manager (dashboard) logic: sources tree, tags, collapsible page items + annotation cards, search/export/delete; folds in video annotations. Renders the `designs/code.html` UI (Tailwind + Material Symbols). |
| `src/highlights.html` | Dashboard page markup (Tailwind shell; loads `highlights-tailwind.css` only). |
| `src/highlights-tailwind.scss` | Isolated Tailwind entry for the dashboard (`@tailwind` + self-hosted `@font-face`s + Material Symbols base). Compiled to `highlights-tailwind.css`; fonts in `src/fonts/`. |
| `src/utils/video/` | YouTube video notes: `youtube-detect` (player/SPA), `frame-capture` (canvas + screenshot fallback), `video-annotator` (in-page frame/draw overlay), `video-markup` (draw renderer), `video-storage` (metadata in `chrome.storage.local`), `frame-store` (frame JPEG blobs in IndexedDB; bg-owned, content scripts message in), `video-notes`, `video-transcript` (caption-track fetch/parse), `video-transcript-panel` (the `T` transcript-annotation panel), `video-comments` (per-video conversation comment panel). |
| `src/core/video-highlights.ts` | Dashboard render path for video frame cards + timestamped notes. |
| `src/utils/sync-engine.ts` | 3-way merge sync state machine, tombstones, push/pull (highlights, drawings, video). |
| `src/utils/google-drive.ts` | Google Drive REST + OAuth (implicit grant), appdata file + binary blobs. |
| `src/managers/sync-settings.ts` | Settings UI for connect/disconnect/"Sync now". |
| `src/utils/obsidian-rest.ts` | Local REST API client (config, ping, note/binary PUT/GET). |
| `src/utils/obsidian-export.ts` | Pure serializers: annotations → Markdown (managed region, `<mark>` colors, callouts). |
| `src/utils/obsidian-sync.ts` | Obsidian push orchestrator: dirty queue, offline-aware flush, path map, CSS snippet. |
| `src/managers/obsidian-sync-settings.ts` | Settings UI for the Obsidian REST sync. |
| `src/background.ts` | Message routing, `open_dashboard`, sync alarms + debounced push. |
| `src/types/types.ts` | Shared data types. |

---

## 2. Data model

All annotation data lives in `browser.storage.local`, keyed by **normalized URL** (hash + ephemeral
tracking params like `utm_*`, `fbclid`, `_ga` stripped).

### Per-page sharding (`utils/page-store.ts`)
`storage.local` treats each top-level key as one opaque blob, so a `set` re-serialises the **whole**
value. To avoid O(total-dataset) writes (and cross-tab lost updates) on every comment edit, each page
is stored under its **own key**: `hl:<normalizedUrl>` (highlights), `dr:<…>` (drawings), `va:<…>`
(video). A write touches only that page's record. `page-store` is the single access layer:
`getPage`/`setPage`/`removePage` for one page (the content-script hot path); `getAll`/`getAllUrls`/
`clearAll`/`setAll` reassemble the whole map via `get(null)` + prefix filter for the dashboard, sync,
and Obsidian paths; `listAllPageUrls(kinds)` does that in **one** read for several kinds at once (three
`getAllUrls` calls meant three full-store reads); `changedPages`/`anyPageChanged` interpret `storage.onChanged` batches (a change
arrives as `changes['hl:<url>']`, not `changes.highlights`). **No legacy/monolithic-key migration
exists** — the sharded keys are the only format. The shapes below are the per-page value types.

### Highlights — key `hl:<normalizedUrl>`: `StoredData`
- `StoredData` = `{ url, title, highlights: AnyHighlightData[] }`
- `TextHighlightData` = `{ type:'text', id, xpath, startOffset, endOffset, content, notes[], color, groupId, updatedAt }`
- `ElementHighlightData` = `{ type:'element', id, xpath, content, notes[], color, groupId, updatedAt }`
- **Anchoring**: text → XPath + char offsets; element → XPath only. When XPath breaks, the portable
  text-quote anchor (below) is the safety net.
- **Comments** stored inline in `notes[]` as strings tagged with creation/edit timestamps, which act
  as stable IDs for sync merge.
- **Portable anchor** (`anchor?`): in addition to XPath, each highlight now carries a cross-surface
  anchor (`shared/anchor.ts`) — a universal **text-quote** (`quote` + prefix/suffix context +
  occurrence) plus an optional **structural** anchor tagged with the `surface` ('web' | 'obsidian') it
  was captured on. Stamped at creation (surface 'web') and backfilled for old highlights. Lets a
  highlight be re-found on the rendered Obsidian note, not just the live DOM. See §5.
- **Text-quote resolution is three-tiered** (`findTextQuoteRange`): exact `indexOf` → whitespace-
  insensitive → **fuzzy edit-distance** (`shared/fuzzy-match.ts`, dependency-free since `shared/` is
  bundled by the plugin too). The fuzzy tier is a last resort that tolerates a few changed characters
  (typo fixes, smart-quote/punctuation swaps) so a single edited character no longer orphans a
  highlight. Gated by quality thresholds so a bad guess never displaces an honest "unplaced".
- `groupId` links multi-block highlights (one selection spanning blocks → one highlight per block).
- `color` ∈ {yellow, red, green}. `updatedAt` drives sync conflict resolution.

### Drawings — key `dr:<normalizedUrl>`: `{ url, strokes: PencilStroke[] }`
- `PencilStroke` = `{ id, color, width, points:[x,y,x,y,...], updatedAt? }` (flattened document coords).

### Page sources — key `src:<normalizedUrl>`: `PageSource`
- The readable page captured as Markdown (`{ url, title, markdown, capturedAt }`), for the Obsidian note
  body. **One key per page** for the same reason annotations are sharded, and more urgently: a source is
  the largest record here (tens of KB), so a single `page_sources` map meant capturing page N
  re-serialised all N-1 before it and reading one source deserialised the whole library.
- Written once per page (the source is immutable) and deleted after a successful Obsidian sync.

### Tag index — key `tag_index`: `string[]`
- Every `#tag` ever used in a comment, so the `#` autocomplete can suggest across pages without a
  content script reading the entire library (it used to `get(null)` per tab on first use). Union-only on
  write, so concurrent tabs can't drop a tag.

### Domains — key `domains`: `Record<hostname, DomainSettings>` (custom site name, etc.)

### Diagrams — key `diagrams`: `Record<diagramId, { sceneData?, updatedAt, driveId?, sceneDriveId?, pasted?, pageUrl? }>`
- Excalidraw comment diagrams (see §3.2). `sceneData` = `{ elements, appState, files }` (the editable
  scene, kept in `chrome.storage.local` so the editor can reopen it). The **rendered PNG is NOT here** —
  it lives in the IndexedDB blob store keyed by `diagramId` (see frame-store below), exactly like video
  frames, and is rehydrated on demand for display. No synced JSON ever carries diagram image bytes — only
  the id. (`sceneData.files` may still carry base64 if a raster is pasted into the diagram — minor.)
- Pasted comment images share this map (`pasted: true`, no scene) so they sync on the same path.
- `pageUrl` records which page's comment references the image, so a change routes straight to its page
  instead of scanning every annotation record. Still **one key for all diagrams**, so it is re-serialised
  on every scene save — the remaining known scale limit; shard it if scenes get numerous.

### Video annotations — key `va:<normalizedUrl>`: `VideoAnnotationData`
- Kept separate from `highlights`/`drawings` so the dashboard routes them to their own card
  renderer and the (large) captured frames never bloat the highlight/sync payloads.
- `VideoAnnotationData` = `{ url, videoId, title?, items: VideoItem[] }`.
- `VideoItem` = `{ id, kind:'frame'|'note'|'transcript', videoTime, frame?:{dataUrl,w,h}, markup?, notes[], updatedAt }`.
- **Transcript items** add `{ timeEnd, quote, color, anchor:{startCue,startOffset,endCue,endOffset} }`. `videoTime`
  holds the range start (so the existing time-sort/timeline keep working); `anchor` re-paints the
  highlight against the immutable caption track on reopen (cue index + char offset — no XPath).
- `markup` = `{ strokes, lines, texts }` with all coords **normalized 0..1** of the frame, so they
  repaint correctly over the saved image at any size.
- `notes[]` reuse the same `<!--timestamp--><!--edited-->` chat-message format as highlight comments.
- Frames are downscaled JPEG (~1280px). The frame **metadata + markup + notes + transcript items
  are Drive-synced**; the JPEG itself is stored as a **separate Drive appData blob** (referenced by
  `frame.driveId`) and never inlined into `clipper-sync.json`, so the merge payload stays small.
- **Frame JPEGs are NOT in the `va:` record.** They live locally in **IndexedDB**
  (`utils/video/frame-store.ts`, DB `clipper`, object stores `frames` *and* `diagrams` — the same module
  also backs Excalidraw comment-diagram PNGs, keyed by diagram id), keyed by item id, as real `Blob`s — so
  editing a comment never re-serialises the images, and the metadata record stays small. `frame.dataUrl`
  is a **runtime-only** field, rehydrated on demand for display/export and stripped on every write.
  IndexedDB is per-origin, so the **background owns the DB**: content scripts (page origin) route
  `frameStore{Put,Get,Delete,Has}` messages through it; extension pages (dashboard) use it directly.
  Only the IndexedDB format is supported (no legacy inline-base64 handling).

### Sync state (per-page Drive layout)
- **Drive layout** (all in `drive.appdata`, hidden + app-scoped):
  - `pages/page-<urlhash>.json` — one record per normalized URL (`urlhash` = SHA-256 prefix; the real
    url lives inside). A `PageRecord` = `{ version:2, url, title?, videoId?, highlights[], drawings[],
    videoItems[], diagrams[], tombstones:{highlights,drawings,comments,videoItems,diagrams} }`. **No image
    or scene bytes** — frames carry only `frame.driveId`; diagrams carry only `{id, updatedAt, driveId,
    sceneDriveId}` pointers.
  - `frames/frame-<itemId>.jpg` — video frame image blobs.
  - `diagrams/diagram-<id>.png` (rendered) + `diagram-<id>.scene.json` (editable Excalidraw scene).
- **Per-page bookkeeping** in `storage.local`: `snap:<url>` (the last-reconciled `PageRecord`, = the
  3-way merge base) and `pagemeta:<url>` (`{fileId, headRevisionId}` for CAS + change detection).
- **`shared/merge.mergePageRecord`** reconciles ONE page (base/local/remote) — the merge is never
  whole-dataset. `sync-engine` assembles a `PageRecord` from the sharded local stores + the global
  `diagrams` map, uploads images that lack a blob (or were edited), uploads the image-free page JSON
  with a CAS on the file's `headRevisionId`, then pulls any missing images and writes the merge back.

---

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
  An open comment draft dims the tool buttons (annotation suspended — see §3.2).

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

### 3.2 Commenting & annotation system
- Comments render as floating **cards in a single right-side column**, stacked top-to-bottom in
  document order of their highlights without overlap; if the viewport lacks room, a body margin
  nudges content leftward. (Always-right avoids cards landing over left-side page chrome like a TOC.)
  The column is anchored by an explicit `left` in page coordinates (not `right`), so the reserved
  gutter can't drag the cards back over the text on pages with a positioned body, and the layout is
  recomputed on window `resize` / `visualViewport` resize — which is what keeps it correct across
  **browser zoom**.
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
  - **Serialization**: `utils/comment-markdown.ts` is the single definition of the comment markdown subset — `**bold**`, `*italic*`, `[text](url)`, bare urls, `#tag`, `- item`, `- [ ] task`, `<!--image:ID-->`, `<!--diagram:ID-->` — with three conversions: markdown → display HTML, markdown → editable HTML, and editor DOM → markdown. Every surface (comment box, its editor, the dashboard) goes through it, so a comment reads the same everywhere and stays valid Obsidian markdown. Covered by `comment-markdown.test.ts` (round-trip + escaping).
  - **Backup/sync**: a pasted image is registered in the `diagrams` map on save (`{ updatedAt, pasted: true }` — no scene) so it travels to Drive on the same path as a drawn diagram: PNG blob out, blob pulled back into IndexedDB on another device, map entry dropped (and the remote blob tombstoned) when its comment is deleted.
  - **Keybinds**: `Enter` inserts a new line inside the editor; `Ctrl+Enter` saves/commits the comment.
- **Google Sync Status Icon**: Each reply displays a cloud sync indicator icon in its top-right corner. It is styled with a light/dull gray color when pending sync, turning into a bright purple-bordered icon once successfully merged and synced to Google Drive.
- **Diagrams**: An "Add Diagram" button in the comment editor opens a dedicated, isolated Excalidraw window. The comment is created **only when the editor saves** (the diagram-id→highlight mapping is held pending until the save lands), so closing the editor without saving leaves no orphan comment. The editable **scene JSON** is stored in `browser.storage.local` under the `diagrams` key (`{ sceneData, updatedAt }`); the **rendered PNG is stored as a binary blob in IndexedDB** (frame-store `diagrams` store, keyed by diagram id) and rehydrated on demand — never inline in any JSON. Editing reuses the same diagram id (overwrites in place, no orphan); deleting the comment drops both the `diagrams` entry and the IndexedDB blob.
- **Grouped highlights are one annotation on the live page**: a multi-block selection (e.g. several
  bullet points sharing a `groupId`) shows a **single comment box / thread** anchored to the group's
  first piece — comments save to that representative, and edit/delete map the flattened thread index
  back to the piece that owns each note. Hover-emphasis lights up **all** pieces of the group at once.

### 3.3 Pencil tool (freehand drawing)
- **`P`** activates pencil. Strokes drawn on a full-document SVG overlay.
- **`1` / `2` / `3`** switch between 3 predefined colors; the on-screen nib recolors to match.
- **Selector**: holding **`Ctrl`** (with pencil or normal cursor) turns the cursor into a marquee
  selector. Drag to select strokes, **`Delete`** to remove. Selector ignores text highlights.
- Pencil and highlighter are mutually exclusive (entering one exits the other).

### 3.4 Highlights dashboard (annotation manager)
- **`Alt+E`** opens `highlights.html` in a new tab (content → `open_dashboard` → background creates tab).
- **Rebuilt UI** (`designs/code.html` is the source design): a self-contained **Tailwind** page,
  dark theme, purple accent `#8c73fa`, **Material Symbols** icons, self-hosted **Geist** / **Libre
  Caslon Text** fonts. Tailwind is isolated to its own entry `src/highlights-tailwind.scss`
  (compiled via `postcss-loader` → `highlights-tailwind.css`) so its preflight never touches the
  other extension pages; fonts live in `src/fonts/*.woff2` and are emitted to `dist/fonts/` by a
  webpack `asset/resource` rule. The page loads **only** `highlights-tailwind.css` (no `style.css`).
- **Sidebar sources tree**: domains → pages, favicons (a domain's stored favicon; globe `public`
  fallback), highlight-count badges. Clicking a domain expands it and shows *all its pages'*
  annotations; clicking a nested page scopes to that one page. **`Ctrl`+click** opens the real
  site/page in a new tab.
- **Main pane**: page items are built in batches of 40 across frames (a render token guards against two
  fills interleaving), so a large library paints immediately instead of blocking on one long task.
  Collapsible **page items** — collapsed shows favicon + title + "N Annotations •
  last-edited"; expanded shows a header (favicon, title, source URL) and a list of **annotation
  cards**. Each card: tinted **quote** block(s) (grouped multi-block highlights render stacked,
  separated by a `more_vert` divider), a **comment thread**, a focus-gated **reply** field, and one
  annotation-level **delete** in a right-hand gutter. Comments show relative timestamps, `#tag`
  purple pills, per-comment **edit/delete**, and **Excalidraw diagram** comments render as their
  image (from the IndexedDB blob store; click reopens the editor).
- **Comment bodies match the live page**: display and editing both go through
  `utils/comment-markdown.ts`, so bold/italic/links/bullets/checklists and pasted images render
  here too (they used to show as raw markdown). The reply/edit field is the same **WYSIWYG
  contenteditable** editor with the bullet/checklist/bold/italic bar; `Enter` submits except inside
  a list, where it starts the next item.
- **Video annotations** fold into the same cards, rendered by kind: **frame** (captured image with
  its markup drawings repainted via `renderMarkupSvg`), **transcript** (colored quote + `M:SS–M:SS`
  range chip), or **note** (jump-to-moment chip); every chip links to `…?t=Ns`. Their comment
  threads are fully editable — reply / edit / delete route through the video store
  (`updateVideoItemNotes` / `removeVideoItem`), at parity with the on-page video comments panel.
- **Source search** (sidebar) filters domains by hostname/custom name. **Navigation**: all → domain →
  page, reflected in breadcrumbs and the URL query (`?domain=&url=`).
- Header **Export** (JSON) / **Delete** and footer **Bulk Export / Bulk Delete**, scoped to the
  current selection (all / domain / page).
- **Tags panel** (sidebar): a **nested tag tree** from `#tag` tokens in comment text (nesting via
  slashes, e.g. `#question/important`; a parent matches all descendants). Clicking a tag filters the
  main pane *on top of* the current nav/search scope (click again to clear); counts are scoped to the
  current selection.
- **Tag autocomplete**: typing `#` in a comment editor (live page) pops a dropdown of known tags from
  all pages' comments, filtered by prefix; arrows navigate, Enter/Tab/click inserts, Escape closes
  (without touching the draft).

### 3.5 Google Drive sync (per-page)
- Google OAuth via `browser.identity` (implicit grant); connect/disconnect from settings.
- **Redirect URI is a hosted bridge** (`google-drive.REDIRECT_BRIDGE`): Google allows no wildcard
  redirect URIs, and Firefox's `identity.getRedirectURL()` embeds a random **per-install** UUID that can
  never be pre-registered. So a static page (own repo, GitHub Pages) is the one registered URI for every
  browser and user; the extension passes its own redirect URL in the OAuth `state`, and the page forwards
  the response fragment to it after checking it against the browsers' extension-redirect formats. Chrome's
  id is pinned by the manifest `key`, so its redirect URL is stable too. Distribution steps, ids and the
  Google Cloud setup live in `DISTRIBUTION.md`; the verification submission (so any user can connect, not
  just listed testers) is pre-filled in `GOOGLE_VERIFICATION.md`.
- Syncs highlights + drawings + video (transcript items, notes, frame markup) **and Excalidraw comment
  diagrams** — **one Drive file per page** (`pages/page-<urlhash>.json`), with frame/diagram images and
  diagram scenes as separate blobs (see §2 "Sync state").
- **Per-page 3-way merge** (`shared/merge.mergePageRecord`): newest edit wins per item; comments from both
  devices are kept; deletions tracked as **per-page tombstones** so they don't resurrect. The merge is
  **never** over the whole dataset — always a single page at a time.
- **Push is targeted**: a change enqueues only the affected page URL(s) and reconciles just those files
  (a diagram edit is mapped to its page via `findPagesForDiagrams`, which reads the entry's `pageUrl`
  stamp and only falls back to scanning annotations for un-stamped ids). **Pull/full reconcile**:
  periodic + on startup + **"Sync now"** walks every local page and every remote `pages/` file (the file
  listing is the change-manifest), reconciling each independently. See `GOOGLE_DRIVE_SYNC.md`.
- **Unchanged pages are skipped without network** (`isPageInSync`): a page is only reconciled when the
  Drive file's `headRevisionId` differs from the one recorded in `pagemeta:<url>`, or the local record no
  longer matches its `snap:` (compared on an entity fingerprint that excludes tombstones, which the local
  side never rebuilds). Without this every poll downloaded and re-merged **every** page — O(library)
  network every 5 minutes, which at a few hundred pages never finishes inside the interval and leaves
  sync running permanently. The check is an optimisation only: anything missing or ambiguous reconciles.
- **Live progress in settings**: the engine writes its phase into the `sync_status` record as it goes
  (`progress: { phase, done, total, title, url }` — `discovering` while it works out which pages are in
  play, then one update per page). The Sync section renders it as a card under the status line: state +
  percentage on top, a bar, and the page being synced with a `done / total` count below (writes are
  rate-limited, so a large reconcile doesn't cost a storage write per page). The bar sweeps
  indeterminately during discovery, the card turns red with the message on failure, and it hides when
  idle. The settings page follows the run via a `storage.onChanged` listener, so no polling.
- The Obsidian companion plugin (§5) is the second client of this per-page Drive layout and uses the
  **same** `pages/page-<urlhash>.json` files (`shared/merge.pageFileName` gives both the identical name).

### 3.6 YouTube video frame notes (lectures)
- On a YouTube watch page, **`S`** captures the current frame and the video pauses. The draw step is a
  full **Excalidraw** editor hosted in an iframe (`src/video-excalidraw.tsx` / `.html`), with a native
  top toolbar and a custom bottom **properties bar** (color/fill/stroke/opacity, cycled by keyboard).
- **Layout**: the iframe covers the video's content rect; the paused video behind is **dimmed** and the
  captured frame is placed as a centred card in the **region between a reserved top band and bottom band**,
  so the toolbar and properties bar never overlap the drawing. The frame is positioned by explicit
  zoom/scroll (not `scrollToContent`/`fitToViewport`) so it lands deterministically.
- **Performance**: the Excalidraw iframe is created **once per watch-page session and pooled** — warmed on
  load / `yt-navigate-finish`, parented to the player container (which YouTube fullscreens, so it never
  needs reparenting). Each `S` resets the scene and feeds the new frame via `INIT_FRAME`; the iframe stays
  hidden until it posts `FRAME_RENDERED`, so no blank canvas flashes.
- **`Enter`** saves the frame (Excalidraw exports a baked composite back to `item.frame.dataUrl`) and
  resumes; **`C`/`N`** saves and advances to the comment step; **`Esc`** discards. Host-side keys are
  forwarded to the iframe (`TRIGGER_SAVE`/`COMMENT`/`DISCARD`) so save always runs through the export.
- **Comment step**: the frame animates to a reduced size on the left and a fixed-width **slate chat
  panel** docks on the right (read-only frame). A "reply here" box posts messages (newest at bottom,
  long ones collapse after ~3 lines). One chat thread per frame. **`Esc`** closes and resumes.
- **`N`** = comment-only: pauses, captures the timestamp, opens the chat panel directly (no image).
- Capture uses a canvas draw with a background `captureVisibleTab` screenshot fallback. The overlay
  scopes itself to the `<video>`'s rect and mounts into the fullscreen element, so it works in and out
  of fullscreen. Markup participates in an in-overlay undo (`Ctrl+Z`).
- Saved items appear in the dashboard as a per-video section in video-time order: frame cards (markup
  repainted on top, `M:SS` badge linking to the moment, chat thread beneath) and frameless notes.
- Keys (`S`/`N`) and the on/off toggle are configurable under Highlighter settings.

### 3.7 YouTube transcript annotation (`T`)
- On a watch page, **`T`** pauses the video and docks a scrollable transcript panel on the right,
  auto-scrolled to a fixed **30s** behind the current moment (the spoken cue is marked). The transcript
  comes from YouTube's own caption track (player response → `captionTracks` → `&fmt=json3`); a small
  **language picker** appears when >1 track exists (auto-picks English, then UI language, then first;
  the choice is remembered for the current video session only). **No captions → a toast, feature does
  nothing.**
- Selecting transcript text shows the familiar **color-swatch popup** (yellow/red/green) plus a
  **Comment** button. Each highlight derives its `M:SS–M:SS` range from the covered cues and is stored
  as a `kind:'transcript'` item. Multiple highlights per session; **all** of the video's saved
  transcript highlights are repainted inline while scrolling. **Double-click** a highlight (or the
  popup's **Comment**) opens the comment panel for it. `Esc` saves and resumes.
- **Per-video conversation comment panel** (`video-comments.ts`): the comment panel is now a scrollable
  stack of **grouped thread cards** — one card = one annotation's anchor (transcript quote + range chip,
  a modest frame thumbnail, or a note timestamp) + all its replies — with the focused thread expanded
  and its reply box active (the transcript quote pinned above the input, WhatsApp-style). It loads
  **every** item for the video, so it doubles as the full comment history. The frame (`S`→`C`) and
  comment-only (`N`) flows now open this same panel (the frame draw step is unchanged); `Esc` from it
  returns to the transcript panel when opened from there, otherwise resumes the video.
- Dashboard renders transcript items as a colored quote block + `M:SS–M:SS` badge, in video-time order
  alongside frame/note cards. Transcript items and frames are **Drive-synced** (see §2 / §3.5).

### 3.8 Obsidian sync (Local REST API)
- **Separate pipeline from Drive sync** (Drive = device↔device data backup; this = formatted notes out).
- Transport: the **Local REST API** community plugin over its **insecure HTTP server** (`http://127.0.0.1:27123`)
  — the HTTPS server's self-signed cert can't be validated by an extension `fetch`. User enables that
  server, pastes the API key + base folder in Settings → Sync → Obsidian sync.
- **Two notes per page/video** at `<folder>/<hostname>/`:
  1. **Source note** (`<title>.md`): The immutable page text the plugin renders and anchors against. It carries the `source:` URL frontmatter and NO callouts. Written once.
  2. **Comments note** (`<title>.comments.md`): A human-readable mirror of the annotations. Our content is wrapped in a `%% clipper:start/end %%` **managed region** so re-syncs never clobber the user's own edits; frontmatter (`clip_source`, `domain`, `type`, `captured`, `tags`) is written on create. Regenerated every sync.
- **Format:** each annotation in the comments note is a **semantic callout** carrying its highlight color as callout metadata —
  `clip-hl` (text), `clip-img` (image), `clip-transcript`, `clip-frame`, `clip-note`, with comments as a
  nested `clip-reply` callout. Body is real Markdown (callouts/embeds/`<mark>`) so Obsidian features keep
  working. A grouped selection made **entirely of list items** renders as a real Markdown bullet list
  (one `- ` per `<li>`) inside the callout; other groups stay single inline-marked. **Image** highlights
  embed the resolved remote URL at a capped width (`![alt|480](src)`); YouTube
  items render in video-time order with `M:SS` deep links (`&t=Ns`), frames embed `![[youtube-<videoId>-<itemId>.jpg|480]]`
  with the JPEG PUT to `<folder>/Attachments/`.
- **Themes:** a selectable note style (`cards` = cards + side-by-side media/comments; `document` = minimal
  typographic). The same body renders both ways — frontmatter `cssclasses: [clip, clip-<theme>]` picks the
  theme and a versioned CSS snippet (`obsidian-export.CLIP_CSS`, pushed to `.obsidian/snippets/`) does the
  styling (mono metadata, accent-by-color, the flex split). Switch theme + "Sync all now" to restyle.
- **Triggers:** live on change (per-page/video changes enqueue their URL; ~3 s debounced flush — short so it
  fires before the MV3 service worker idles out, which would otherwise drop the timer) + a manual
  **"Sync all now"** button. **Offline-safe:** if Obsidian/the plugin is unreachable the queue is kept and
  retried on the sync alarm (5 min) and on startup, so pending changes flush automatically once it's back.

### 3.9 Data settings (destructive wipes)
- **Settings → Data** (separate from Sync, sidebar item `data`; `managers/data-settings.ts`). Two
  type-to-confirm actions, each routed to a background handler:
  - **Delete all data on Google Drive** → `wipeDriveData` → `google-drive.wipeAppData()` deletes every
    file in the appData folder (pages/frames/diagrams + any legacy `clipper-sync.json`) and resets local
    sync bookkeeping. Local annotations are untouched.
  - **Delete all local data** → `wipeLocalData` → removes all `hl:`/`dr:`/`va:`/`snap:`/`pagemeta:`/`src:`
    keys plus `diagrams` from `storage.local` and clears both IndexedDB image stores
    (`frame-store.clearAllImages`). Settings, templates, and the Drive connection are kept; Drive data is
    untouched (a later sync may restore it).

### 3.10 Keyboard shortcut reference
| Key | Action |
|-----|--------|
| `H` | Toggle highlighter |
| `P` | Toggle pencil |
| `1` / `2` / `3` | Change pencil (or active highlight) color |
| `Ctrl` (hold) | Selector tool (select/delete pencil strokes) |
| `Ctrl`+highlight | Highlight + open new comment box |
| `Ctrl`+click (highlight) | Open that highlight's comment bar |
| `Ctrl`+`Z` / `Ctrl`+`Shift`+`Z` | Undo / redo highlight |
| `Esc` | Exit highlighter mode |
| `Alt`+`E` | Open Highlights Dashboard |
| `S` (YouTube watch) | Capture frame + draw |
| `N` (YouTube watch) | Comment-only (frameless, timestamped) |
| `T` (YouTube watch) | Transcript annotation panel (highlight spoken lines) |
| `Enter` / `C` / `Esc` (capture overlay) | Save · save+comment · cancel |
| `Ctrl`+click (dashboard list) | Open the real website in a new tab |
| `Ctrl`+`B` / `Ctrl`+`I` (editor) | Bold / italic markdown |

---

## 4. Conventions & gotchas for implementers
- Match surrounding code style (naming, comment density, idioms). TS + SCSS.
- All annotation data is keyed by **normalized URL** — reuse the existing normalizer; don't re-derive.
- Comment IDs = inline HTML-comment timestamps; preserve them or sync merge breaks.
- Highlight anchoring is XPath+offset with no fuzzy fallback — be careful editing anchoring logic.
- `content.ts` owns the single highlighter instance; reader mode delegates via
  `window.__obsidianHighlighter`. Don't instantiate a second copy.
- Sync conflict resolution depends on `updatedAt` being stamped on change — keep stamping it.
- After changes, rebuild for the target browser (webpack) and reload the unpacked extension.

---

## 5. Cross-surface anchoring & the Obsidian companion plugin

A separate **Obsidian plugin** (`clipper-annotations-plugin/`, id `clipper-annotations`, esbuild →
`main.js`) lets you highlight/comment on clipped **source notes in reading view**, with a docked,
linked comments panel — the same swatch popup, colors, and in-context keys (`1`/`2`/`3`, `c`, `Esc`)
as the live-page highlighter, but comments live in a separate panel. It is a **distinct codebase**;
the extension and plugin share logic only through a neutral top-level **`shared/`** folder (neither
imports the other's `src/`).

- **Image annotations (cross-surface):** an image highlight is an `ElementHighlightData`
  (`type:'element'`) carrying the `<img>` in `content`. Its cross-surface bridge is an **image anchor**
  (`anchor.image = { src, alt }`) — the image-equivalent of the text-quote anchor — resolved by
  `resolveImageElement` (exact src → host+path → filename match), so the *same image* is found on the
  live page and in the rendered note regardless of relative/absolute/CDN differences. **No Google Drive
  download** is needed (the image is just a remote URL, present in both the highlight `content` and the
  note's `![](src)`); only YouTube *frame captures* (binary JPEG blobs) use Drive. The extension stamps
  `anchor.image` at creation and paints Obsidian-origin image highlights by matching the page `<img>`
  when xpath fails. The **plugin** treats these as first-class `kind:'image'` annotations: the panel
  shows an image-preview card with its comment thread below, the matching note image gets a colored
  **outline** (hover/click ↔ card), and clicking any note image opens the swatch to create a new image
  annotation. Image annotations + their comments sync bidirectionally just like text (mapped ↔ the
  `type:'element'` highlight in `sync.ts`; ones with no resolvable image are still preserved verbatim).

- **`shared/anchor.ts`** — the dual anchor model (text-quote + per-surface XPath) and the resolver
  (XPath-when-native → text-quote fallback → "unplaced", never silently dropped). The text-quote
  fallback is **whitespace-insensitive** (`findTextQuoteRange`: exact `indexOf` first, then a
  collapsed-whitespace match that reports the real span) — required because Obsidian's rendered
  Markdown is single-spaced while a live web page's text nodes carry raw newlines, indentation, and
  non-breaking spaces; an exact match would never bridge that gap, so highlights made in Obsidian
  wouldn't paint on the live page. Operates on a `RangeLike`; pure + unit-tested (`shared/anchor.test.ts`).
- **`shared/merge.ts`** — the pure 3-way merge (newest-wins, tombstones, comment merge), unit-tested
  (`shared/merge.test.ts`). Exposes `mergePageRecord` (per-page; used by both clients now) and
  `pageFileName` (so both compute the same `pages/page-<urlhash>.json`). **Both** the extension's
  `sync-engine.ts` and the plugin's `sync.ts` import these, so conflict resolution + file naming have a
  single implementation. (The legacy whole-dataset `mergeSyncFiles`/`mergeHighlightsStorage` remain — the
  plugin still uses `mergeHighlightsStorage` to merge a single page's highlight list.)
- **Full page source → Obsidian:** the extension captures the readable page as Markdown
  (`page-source-capture.ts`, Defuddle) on first save and temporarily stores it under `src:<url>`.
  The Obsidian sync writes it below the managed region on note creation (immutable; re-syncs never
  touch it), so the plugin has content to render and re-anchor against. Once successfully synced to Obsidian,
  the stored page source is automatically deleted from local storage to conserve space.
- **Bidirectional Drive sync (per-page):** the plugin is a second client of the same per-page Drive
  layout (`pages/page-<urlhash>.json`) via Google's auth-code OAuth flow (`drive.ts`, per-page
  `listPages`/`pullPage`/`pushPage` with revision CAS). `sync.ts` `reconcilePage` maps annotations ↔ the
  highlight shape and merges **only** each page's highlight list, passing the extension's
  drawings/video/diagrams (pointers only — no image bytes) and their tombstones through from the remote
  record untouched; unrenderable highlights are kept per-page in a `foreign` bucket so nothing is lost.
  Per-page snapshots + foreign buckets persist in the plugin's `data.json`.

- **Reading-view painting (plugin):** Obsidian renders reading view progressively and **virtualizes**
  off-screen sections, so a single post-open repaint paints nothing (text not yet in the DOM) or only
  the top of the note. The plugin therefore watches the preview root with a **`MutationObserver`** and
  repaints highlights (rAF-coalesced, panel untouched) whenever sections render in/out — so highlights
  appear the instant their text exists, on open and on scroll. `resolveAnchor` takes an optional cached
  `rootText` so a full repaint walks the preview text once, not once per annotation.

- **Live-page painting of cross-surface highlights:** the painter (`renderTextHighlight`) resolves a
  text highlight's range with the native xpath+offset path for web-origin highlights, then **falls
  back to `resolveAnchor(anchor, document.body, 'web')`** (text-quote) when that fails — which is what
  makes a highlight *created in Obsidian* (no web xpath) actually paint on the live page, and also
  rescues web highlights whose page shifted. `applyHighlights` no longer gates text highlights on the
  xpath resolving.

**Remaining caveats & checks:**
- The plugin's Drive device-flow OAuth (`drive.ts`) is correct by construction but unverified end-to-end (needs a "TV/Limited Input" Google client + the Obsidian runtime).
- **Vault Gitignore:** For the plugin to work without the extension being open, it acts as a standalone Drive client. This means it stores its own Google login refresh token in `.../.obsidian/plugins/clipper-annotations/data.json` inside the user's vault. If the user uses `obsidian-git` or otherwise version-controls their vault, they **must** add that `data.json` file to their vault's `.gitignore` so the token never gets committed.
