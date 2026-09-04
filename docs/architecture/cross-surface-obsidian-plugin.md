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

---

