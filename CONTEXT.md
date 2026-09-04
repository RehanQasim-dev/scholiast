# Context

The project's ubiquitous language for Scholiast (Obsidian Web Clipper fork). Use these terms consistently in specs, tickets, tests, and agent prompts.

## Annotation
A user-authored mark, highlight, comment, or freehand drawing anchored to web or video content.

## Highlight
A visual emphasis over text or a DOM element on a webpage.
- **Text Highlight**: A highlight over a continuous or multi-block text range, anchored by XPath and a portable text-quote.
- **Element Highlight**: A highlight placed over a whole DOM element or media container (e.g. an image or blockquote).
- **Group ID**: A shared identifier linking multiple distinct DOM highlight spans created from a single continuous user selection.
- **Color**: One of three canonical highlight colors: `yellow`, `red`, or `green`.

## Action Bar
The floating toolbar hovering above an active highlight providing color changing, commenting, and deletion actions.

## Annotation Mode
The explicit editing state per page (toggled via toolbar or `H`/`P` keys) permitting creation of new annotations. Viewing existing annotations is always active regardless of mode.

## Comment
A persistent textual or rich-media note attached to a highlight or video timestamp.
- **Comment Card**: The floating visual container rendering a comment thread, stacked in document order in the right-side margin.
- **Comment Gutter**: The viewport-reserved right-hand margin measured to ensure comment cards never overlap page text.
- **Thread**: A chronological stack consisting of an initial root note and subsequent replies linked to one anchor.
- **Note Format**: A markdown comment stored inline in `notes[]` tagged with creation and edit timestamps (`<!--timestamp--><!--edited-->`).

## Anchor
A location pointer binding an annotation to its source content.
- **XPath Anchor**: A structural DOM address locating an element or text node.
- **Portable Anchor**: A cross-surface text-quote anchor (`quote` + prefix/suffix context + occurrence) capable of resolving across DOM changes or exported markdown.
- **Three-Tiered Resolution**: The anchor fallback hierarchy: exact match $\to$ whitespace-insensitive match $\to$ fuzzy edit-distance match.

## Pencil Stroke
A freehand vector stroke (`id`, `color`, `width`, `points[]`) drawn on the webpage canvas.

## Video Annotation
A timestamped annotation linked to a YouTube video.
- **Frame Note**: An annotation capturing a downscaled video player frame at a specific timestamp, optionally annotated with vector markup.
- **Transcript Note**: An annotation over spoken dialogue, anchored to caption track cues by cue index and character offset.
- **Cue**: A discrete caption segment in a video caption track carrying start time, end time, and text.
- **Normalized Markup**: Scaled drawing coordinates (0..1) overlaid on a captured video frame so drawings scale losslessly at any resolution.

## Frame Store
The background-owned IndexedDB database storing binary JPEG blobs of captured video frames and PNG diagram renders, keeping them out of `storage.local` JSON records.

## Diagram
An editable Excalidraw vector illustration attached to a comment or redrawn over a highlighted page image.
- **Scene Data**: The editable Excalidraw JSON (`elements`, `appState`, `files`) stored in storage.
- **Rendered PNG**: The binary image render stored in IndexedDB.

## Sharded Page Store
The storage partitioning scheme storing annotations under per-page keys (`hl:<url>`, `dr:<url>`, `va:<url>`, `src:<url>`) to prevent O(total-dataset) re-serialization on every write.

## Tombstone
A deletion marker recording an item's ID and deletion timestamp, ensuring deleted items are not resurrected during multi-device sync.

## Sync Engine
The 3-way merge engine reconciling local storage, base snapshot (`snap:<url>`), and remote Google Drive appData (`PageRecord`).
- **PageRecord**: The image-free per-page JSON record stored on Google Drive (`pages/page-<urlhash>.json`).
- **Head Revision ID**: The Google Drive file revision identifier used for Compare-And-Swap (CAS) optimistic concurrency control.

## Normalized URL
A canonical web URL stripped of URL fragments (`#`) and ephemeral tracking query parameters (`utm_*`, `fbclid`, `_ga`).

## In-Situ Note Composer
An inline, full-width note card materialized inside the chronological notes feed at the active video timestamp, featuring autofocus, 5-line auto-expansion, and instant commit (`Enter`) / discard (`Esc`).

## Surface-Adaptive Ergonomics
The interaction model calibrating annotation triggers to device form factor: Desktop is keyboard-first (`N`, `S`, `V`), Tablet provides a split-view FAB speed-dial, and Mobile employs an STT-first bottom action bar.

## Smart Playback Memory (`wasPlaying`)
The playback state tracking mechanism recording whether media was actively playing prior to note initiation, ensuring playback only resumes if it was not previously paused.

