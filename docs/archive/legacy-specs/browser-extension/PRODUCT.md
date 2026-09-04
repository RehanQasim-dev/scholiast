# Product Spec: Scholiast Browser Extension

## 1. Product Overview
Scholiast is an in-browser live-webpage annotation and research engine (Chrome MV3 / Firefox / Safari). It extends base clipping functionality to allow real-time text and element highlighting, margin-anchored threaded comments, freehand pencil drawing, Excalidraw diagrams, YouTube lecture note-taking with synchronized transcript cues, a unified highlights dashboard, and private cloud sync (Google Drive + local Obsidian REST API).

---

## 2. Numbered Behavior Invariants

### 2.1 Live Highlighting & Selection
- **B1**: Selecting text on any webpage displays a floating circular color swatch popup anchored to the selection endpoint offering Yellow (`#d29600`), Red (`#dc3c5a`), and Green (`#2da05f`).
- **B2**: Prior to highlight creation, selection endpoints are automatically sanitized via `trimRange` to strip leading/trailing whitespace and prevent empty boundary highlights.
- **B3**: Multi-block selections spanning paragraphs, list items, or tables generate individual DOM highlight ranges bound together by a shared `groupId`.
- **B4**: Hovering an existing highlight summons an action bar above the selection providing recoloring, comment trigger, and delete buttons.
- **B5**: Double-clicking an existing highlight opens or focuses its attached comment card in the right-side margin.
- **B6**: Element highlighting permits users to target images, blockquotes, code blocks, or embedded containers with a distinct outline overlay.
- **B7**: Modern rendering utilizes the CSS Custom Highlight API (`::highlight(scholiast-*)`) where supported (Chromium 105+, Firefox 119+, Safari 17.2+), leaving the webpage DOM completely unmutated.
- **B8**: Highlights survive dynamic webpage DOM changes using a 3-tiered resolution ladder: exact text-quote $\to$ whitespace-collapsed quote $\to$ fuzzy edit-distance match.
- **B9**: Highlights load automatically on page load from `hl:<normalizedUrl>` and recalculate bounds upon viewport resize or layout shifts.
- **B10**: `Ctrl+Z` / `Cmd+Z` undoes the most recent highlight creation, recolor, or deletion.

### 2.2 Comment System & Margin Gutter
- **B11**: Triggering a comment creates a card in the right margin vertically aligned with the highlight's top boundary.
- **B12**: If multiple highlights share vertical proximity, comment cards stack downwards in document order without visual collision or overlap.
- **B13**: The extension measures right-hand viewport clearance and automatically applies a 320–360px gutter when space is insufficient, preventing cards from obscuring body text.
- **B14**: Each comment card supports a root note and threaded replies, ordered chronologically.
- **B15**: Comments are authored in a rich WYSIWYG `contenteditable` composer supporting bold (`**`), italic (`*`), inline code (`` ` ``), bullet lists, and `#tags`.
- **B16**: `Ctrl+Enter` / `Cmd+Enter` submits drafts; `Esc` cancels draft changes without deleting saved threads.
- **B17**: Clipboard images pasted into the composer generate inline thumbnails that expand into high-resolution modals upon click.
- **B18**: Clicking a comment card scrolls the viewport to center its highlight; clicking a highlight pulses the corresponding card.
- **B19**: Comments exceeding 3 visible lines are clamped with a "Show more" toggle to maintain gutter density.
- **B20**: Typing `#` opens an inline tag autocomplete dropdown populated from the global tag index.

### 2.3 Excalidraw & Freehand Pencil
- **B21**: Freehand pencil mode captures pointer strokes into smooth SVG paths rendered in an overlay layer and persisted to `dr:<normalizedUrl>`.
- **B22**: Element highlights on images provide an "Edit / Redraw" action that opens an Excalidraw canvas initialized with the selected image.
- **B23**: Excalidraw scenes are saved to storage and can be reopened cumulatively for continuous diagram editing.

### 2.4 YouTube Notes & Transcript Annotation
- **B24**: Extension automatically activates on `youtube.com/watch` pages (including SPA client-side navigations) and arms hotkeys `S`, `N`, and `T`.
- **B25**: Pressing `S` pauses playback, captures the current video frame at 1280px resolution, and displays the drawing/markup canvas over the player.
- **B26**: Pressing `N` pauses playback and opens a comment composer stamped with the current video timestamp (`M:SS` or `HH:MM:SS`).
- **B27**: Pressing `T` pauses playback and docks a transcript panel on the right, auto-scrolled to 30 seconds prior to playback time with an active timeline indicator.
- **B28**: Selecting dialogue text in the transcript panel displays the highlight swatch, enabling cue-anchored highlights with attached comments.
- **B29**: Clicking any timestamp on a note, frame, or transcript highlight instantly seeks playback to that exact second.
- **B30**: In native fullscreen, pressing `Esc` exits the annotation overlay and resumes playback without collapsing YouTube's fullscreen stage.
- **B31**: If a video lacks captions, pressing `T` displays an unobtrusive toast notification: *"No transcript available for this video"*.

### 2.5 Highlights Dashboard
- **B32**: Dedicated full-tab manager (`highlights.html`) opens via toolbar popup, card links, or global hotkey.
- **B33**: Consolidates web highlights, drawings, and YouTube video notes into a single chronological stream grouped by page and video.
- **B34**: Provides real-time filtering by color, comment presence, `#tags`, domain/channel, and full-text search.
- **B35**: Direct card manipulation allows editing comments, modifying tags, or deleting highlights with direct write-through to storage.
- **B36**: Clicking any highlight card navigates to the original webpage, awaits DOM mounting, and smoothly scrolls the highlight into view.
- **B37**: Multi-selection enables batch recoloring, bulk deletion, and formatted Markdown export.

### 2.6 Sync & Integration
- **B38**: Google Drive sync writes exclusively to the sandboxed `appDataFolder` (`pages/page-<urlhash>.json` and media blobs) without touching the user's visible Drive root.
- **B39**: Sync operates per-page: modifying annotations on one URL never forces re-upload of the full library.
- **B40**: Three-way merge engine compares local state, base snapshot, and remote records: highlight metadata uses newest-wins, comment threads merge union-style, and deleted items record persistent tombstones.
- **B41**: Local Obsidian REST client synchronizes annotations into structured markdown notes with callout styling into the user's vault.

---

## 3. UI Design Tokens & Theme
- **Background**: `#000000` / `#0b0d14` (OLED dark default)
- **Panels & Elevated Surfaces**: `#151824`, Border `#232733`
- **Text**: `#ffffff` (primary), `#9aa0a6` (secondary), `#4a4f59` (muted)
- **Accent**: Purple `#8b7cf6`
- **Highlight Hues**: Yellow `#d29600` / `#f9e64d`, Red `#dc3c5a` / `#ff5a5a`, Green `#2da05f` / `#5fe3a0`
