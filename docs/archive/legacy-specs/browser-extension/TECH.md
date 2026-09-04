# Technical Spec: Scholiast Browser Extension Architecture

## 1. System Architecture
The browser extension is built on Manifest V3 (targeting Chrome, Firefox, Safari) using TypeScript and Webpack.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        BROWSER RUNTIME (MV3)                           │
│                                                                        │
│  ┌─────────────────────────────┐    ┌────────────────────────────────┐ │
│  │   CONTENT SCRIPT            │    │       SERVICE WORKER           │ │
│  │   (src/content.ts)          │    │       (src/background.ts)      │ │
│  │  • DOM Highlighter API      │◄──►│  • Alarm scheduler             │ │
│  │  • Right Gutter Comments    │IPC │  • Google Drive REST Client    │ │
│  │  • SVG Pencil Canvas        │    │  • Obsidian REST Client        │ │
│  │  • Video Observer & Capture │    │  • 3-Way Merge Engine          │ │
│  └──────────────┬──────────────┘    └───────────────┬────────────────┘ │
│                 │                                   │                  │
│                 ▼                                   ▼                  │
│  ┌─────────────────────────────┐    ┌────────────────────────────────┐ │
│  │  PAGE DOM / CANVAS / VIDEO  │    │  STORAGE (chrome.storage.local)│ │
│  │  • ::highlight pseudo-els   │    │  • hl:<url>  (highlights)      │ │
│  │  • #scholiast-root shadow   │    │  • dr:<url>  (drawings)        │ │
│  │  • Gutter margin reserve    │    │  • va:<url>  (video notes)     │ │
│  └─────────────────────────────┘    │  • src:<url> (read body)       │ │
│                                     │  INDEXEDDB (scholiast_frames)  │ │
│  ┌─────────────────────────────┐    │  • frame JPEGs & diagrams      │ │
│  │ HIGHLIGHTS DASHBOARD TAB    │◄───┘                                │ │
│  │ (src/core/highlights/)      │                                       │ │
│  │  • Full-text virtual stream │                                       │ │
│  │  • Multi-filter facet engine│                                       │ │
│  └─────────────────────────────┘                                       │ │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Key Modules & Subsystems

| Module | Source Location | Responsibility |
|---|---|---|
| Content Entry | `src/content.ts` | Page initialization, hotkey binding, toolbar & pencil mounting. |
| Highlighter Overlays | `src/utils/highlighter-overlays.ts` | CSS Custom Highlight API paint, bounding boxes, color swatch popup. |
| Highlighter CRUD | `src/utils/highlighter.ts` | Range sanitization (`trimRange`), storage serialization, undo/redo. |
| Dual Anchoring | `shared/anchor.ts`, `shared/fuzzy-match.ts` | XPath + text-quote dual anchors, 3-tier fuzzy resolution ladder. |
| Comment System | `src/utils/comment-overlays.ts` | Collision-free margin stacking, layout gutter reservation, WYSIWYG editor. |
| Video Notes & Transcripts | `src/utils/video/` | YouTube player observer, 1280px frame capture, cue transcript sync (`T`). |
| Frame Store | `src/utils/video/frame-store.ts` | IndexedDB binary storage for frame JPEGs and diagram PNGs. |
| Diagrams & Pencil | `src/diagram.tsx`, `src/utils/pencil-canvas.ts` | Excalidraw editor iframe and freehand SVG overlay strokes. |
| Highlights Dashboard | `src/core/highlights/` | Standalone full-tab manager (`highlights.html`) with virtualization. |
| Drive Sync & Merge | `src/utils/google-drive.ts`, `src/utils/sync-engine.ts`, `shared/merge.ts` | Google Drive `appDataFolder` sync, CAS revisions, 3-way merge. |
| Obsidian REST | `src/utils/obsidian-rest.ts` | Local HTTP client syncing annotations into Obsidian markdown callouts. |

---

## 3. Storage & Data Schema

### 3.1 Chrome Storage Sharding (`chrome.storage.local`)
To prevent quota exhaustion and ensure fast single-page queries, annotations are sharded by normalized URL hash:
- `hl:<url>`: Stores `HighlightRecord[]` (text/element highlights, coordinates, color, serialized comments).
- `dr:<url>`: Stores `DrawingStroke[]` (pencil freehand vector paths and stroke widths).
- `va:<url>`: Stores `VideoAnnotationRecord` (timestamp notes, frame markup vectors, cue anchors).
- `src:<url>`: Stores cached readable markdown body for article clipping.
- `tag_index`: Global dictionary of tags (`#tag`) for real-time autocomplete across the extension.

### 3.2 Binary Storage (IndexedDB `scholiast_frames`)
- Database: `scholiast_frames`
- Object store: `frames` (keyed by `itemId`) storing raw binary ArrayBuffers/Blobs (JPEG/PNG).
- Blobs are never serialized into `chrome.storage.local` strings or JSON sync payloads.

### 3.3 Portable Anchor Schema
Dual-anchoring format defined in `shared/anchor.ts`:
- `xpath`: DOM tree location for fast O(1) exact-match resolution.
- `quote`: Exact string matched.
- `prefix`: Up to 32 characters preceding the match.
- `suffix`: Up to 32 characters succeeding the match.
- `occurrence`: 0-indexed count of identical quote occurrences within the parent node.

---

## 4. Rendering & Layout Pipelines

### 4.1 CSS Custom Highlight API
Where supported, text highlights register ranges into `CSS.highlights`:
```css
::highlight(scholiast-yellow) { background-color: rgba(210, 150, 0, 0.35); }
::highlight(scholiast-red)    { background-color: rgba(220, 60, 90, 0.35); }
::highlight(scholiast-green)  { background-color: rgba(45, 160, 95, 0.35); }
```
Benefits: Zero DOM mutations, immune to web-framework hydration conflicts (React, Vue, Angular).

### 4.2 Right Margin Gutter Reservation
1. Measure distance from right-most text container to viewport edge: `clearance = window.innerWidth - mainRect.right`.
2. If `clearance < 340px`, compute shift delta `delta = 340 - clearance`.
3. Apply smooth margin/transform compensation to document root/body without breaking fixed elements.
4. Run vertical collision resolution pass: each card `y[i] = max(highlightTop[i], y[i-1] + height[i-1] + gap)`.

---

## 5. Sync Protocol & Conflict Resolution

1. **Authentication**: OAuth 2.0 PKCE via Chrome Identity API / loopback redirect requesting `drive.appdata` scope.
2. **CAS Concurrency**: Every file in Drive stores a `headRevisionId`. Updates include `If-Match: headRevisionId`.
3. **Three-Way Merge (`shared/merge.ts`)**:
   - Compares: `BaseSnapshot` (last synced record), `LocalRecord` (current state), `RemoteRecord` (Drive state).
   - Attributes: Newest `updatedAt` wins.
   - Comments: Union of comment IDs; edits merged chronologically.
   - Deletions: Persistent tombstones (`tombstones: { [id]: deletedAt }`) guarantee deletions are not overwritten by stale nodes.
