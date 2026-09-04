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

