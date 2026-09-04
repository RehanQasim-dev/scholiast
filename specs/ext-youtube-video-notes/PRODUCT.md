# Product Spec: YouTube Video Notes & Transcript Annotation

## Summary
Synchronized YouTube lecture note-taking, keyboard hotkeys (`S`, `N`, `T`), high-resolution video frame capture, and transcript cue highlighting.

## Behavior

1. **Extension automatically activates** on `youtube.com/watch` pages (including SPA client-side navigations) and arms hotkeys `S`, `N`, and `T`.
2. **Pressing `S`** pauses playback, captures the current video frame at 1280px resolution, and displays the drawing/markup canvas over the player.
3. **Pressing `N`** pauses playback and opens a comment composer stamped with the current video timestamp (`M:SS` or `HH:MM:SS`).
4. **Pressing `T`** pauses playback and docks a transcript panel on the right, auto-scrolled to 30 seconds prior to playback time with an active timeline indicator.
5. **Selecting dialogue text in the transcript panel** displays the highlight swatch, enabling cue-anchored highlights with attached comments.
6. **Clicking any timestamp** on a note, frame, or transcript highlight instantly seeks playback to that exact second.
7. **In native fullscreen**, pressing `Esc` exits the annotation overlay and resumes playback without collapsing YouTube's fullscreen stage.
8. **If a video lacks captions**, pressing `T` displays an unobtrusive toast notification: *"No transcript available for this video"*.
