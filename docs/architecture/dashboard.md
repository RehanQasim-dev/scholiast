### 3.4 Highlights dashboard (annotation manager)
- **`Alt+E`** opens `highlights.html` in a new tab (content → `open_dashboard` → background creates
  tab). Navigation is all → domain → page, mirrored into `?domain=&url=` so a tab survives a reload.
- **Design system, not utility classes.** The page is styled by `src/styles/_dashboard.scss`: CSS
  variable tokens (surfaces, hairlines, text, accent, radii, easings) plus one named component class
  per thing (`.sc-ann`, `.sc-quote`, `.sc-group`, `.sc-menu`…). Tailwind is present only for its
  preflight reset and the self-hosted fonts (Geist for chrome, **Libre Caslon Text for quoted source
  text**, Material Symbols for icons). The three highlight hues are the *same* values the highlighter
  paints on the page, so an annotation is never one colour live and another here.
- **One text column.** Rail (264px) → header (52px) → a 736px reading column. Hero titles, page
  titles, quotes, card metadata and comments all measure from the same left edge; the 22px gutter to
  their left holds the annotation's colour rail and the page favicon. Numbers use tabular figures.
- **Rail**: sources → pages (both newest-first, matching the stream), then a tag tree that only
  appears when tags exist. `Ctrl`+click a source or page opens the real site.
- **Header**: breadcrumb, **annotation search** (matches quote text, comment text and url; matches are
  marked in place and counted), **sort** (newest / oldest / page order / by colour — applied to both
  page order and the annotations inside a page), **filter** (colour, date range, only-with-comments)
  surfaced as removable chips, and an overflow menu holding Export ▸ JSON/Markdown, Copy all as
  Markdown, density, the shortcut sheet, and a scope-labelled **Delete…**.
- **Stream**: a flat feed of annotation cards under **sticky page headers** (favicon, cleaned title —
  the CMS's ` | Site` tail is dropped — url, count, open, page menu). Scoped to one page, that header
  becomes a hero with counts, date span and the page's tags. Cards are **reused by content signature**
  and pages **build their cards lazily** when they scroll near the viewport, so a storage event never
  resets scroll, hover or focus, and a large library paints immediately.
- **The card**: a full-height rail in the highlight's colour, a tinted quote set in the serif face
  (clamped to 8 lines with *Show more*), then a metadata line — select, hybrid timestamp (`14:02`
  today, `3d ago` this week, `Aug 4` beyond, exact date on hover), colour, comment count — and the
  actions: **open the page at this annotation**, copy, and a menu with copy-as-Markdown, recolour
  (writes back to the `hl` store, so the live page follows) and delete.
- **Deep link back to the page.** The open action points at `<url>#sc-hl=<highlightId>`; the content
  script reads that hash on load and on `hashchange`, paints the highlights, scrolls the annotation a
  third of the way down the viewport and flashes it with the existing active-highlight emphasis
  (`revealHighlight` in `utils/highlighter-overlays.ts`, retried briefly for lazy-loading pages).
  Video cards keep their `?t=` chip instead; drawings just open the page.
- **Order and dates come from when an annotation was *made*** (`createdOf`: the numeric highlight id,
  or the base-36 timestamp inside a video item id), never from `updatedAt`. Sorting by last-modified
  made the annotation you were commenting on jump out from under the cursor. Grouped highlights (one selection across blocks) render as one
  card whose parts are joined through the rail. Quote HTML is sanitised to inline tags only, with
  `style`/`class` stripped and page images re-based on the source url (falling back to a labelled chip
  instead of a broken image).
- **Comments** sit in an indented thread; each comment's own metadata is directly under its text
  (never in a right-hand column), with edit/delete on hover. Every thread ends with a permanent
  *Add a comment* row. Display and editing share one set of type metrics, so entering edit mode does
  not move the text. Bodies go through `utils/comment-markdown.ts` — bold/italic/links/bullets/
  checklists/`#tag` pills/pasted images/diagrams — with the same WYSIWYG editor as the live page.
- **Video annotations** fold into the same cards by kind: **frame** (image with its markup repainted),
  **transcript** (quote + `M:SS–M:SS` chip) or **note** (jump chip); replies/edits/deletes route
  through the video store.
- **Freehand drawings** now appear too: a per-page card that renders an SVG thumbnail from the stored
  stroke bounding box, so a page you only drew on is no longer invisible here.
- **Bulk actions**: select cards (click, `x`, Shift for a range, or select-all from a page menu) and a
  floating bar offers copy-as-Markdown or delete.
- **Nothing blocks and nothing is silent**: deletes are optimistic and offer **Undo** (the page record
  is snapshotted first); only library- or domain-wide deletes ask first, with a dialog that names the
  exact count and, for the whole library, requires typing `delete`. No native `confirm()` or `title`
  tooltips anywhere — menus, tooltips, toasts and dialogs are the page's own, keyboard operable.
- **Home** (All sources, unfiltered): a stat strip, a 13-week activity heatmap, most-annotated sources,
  then the newest-first stream.
- **Keyboard**: `/` or `⌘K` search · `j`/`k` move · `o` open · `c` comment · `y` copy · `e` expand ·
  `x` select · `⌫` delete · `g g` top · `?` shortcuts · `Esc` unwinds selection → search → filters.
  The stream is patched in place (never emptied and refilled), so nothing scrolls or reorders while
  you write.
  Everything is a real button/link with visible focus, mutations are announced, and
  `prefers-reduced-motion` drops every transform.
- **Tag autocomplete**: typing `#` in a comment editor (live page) pops a dropdown of known tags from
  all pages' comments, filtered by prefix; arrows navigate, Enter/Tab/click inserts, Escape closes
  (without touching the draft).

