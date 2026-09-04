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
- `imageEdit?` = `{ diagramId, updatedAt }` on an **element highlight over an image** whose picture has
  been redrawn in Excalidraw (§3.2). The edit's scene + PNG live in the shared `diagrams` stores under
  `diagramId`, so it re-opens for further editing; the edited PNG then stands in for the original on the
  live page, in the dashboard, and in anything clipped from the page.

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
- Pasted comment images share this map (`pasted: true`, no scene) so they sync on the same path, as do
  **Excalidraw-edited page images** (`imageForHighlight: <highlightId>`, id derived from the highlight).
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

