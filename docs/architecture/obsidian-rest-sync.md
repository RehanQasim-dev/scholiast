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
| `Ctrl`+click (dashboard rail) | Open the real website in a new tab |
| `Ctrl`+`B` / `Ctrl`+`I` (editor) | Bold / italic markdown |

Dashboard-only keys (see §3.4): `/` or `⌘K` search · `j`/`k` move · `o` open · `c` comment ·
`y` copy · `e` expand · `x` select · `⌫` delete · `g g` top · `?` shortcuts · `Esc` unwind.

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

