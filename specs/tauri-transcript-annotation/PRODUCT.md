# Product Spec: Tauri Spoken Transcript Annotation

## Summary
Internal YouTube caption track fetching without cloud scrapers, karaoke-style auto-scrolling, dialogue text selection, and swatch popup highlighting.

## Behavior

1. **Transcripts load directly via YouTube's internal caption tracks** without requiring third-party cloud scrapers, gracefully falling back across available languages.
2. **Active transcript lines follow playback via karaoke-style auto-scrolling**, keeping the active spoken cue ~30% from the top of the viewport.
3. **Selecting dialogue text in the transcript opens the 3-color swatch popup** (`yellow`, `red`, `green`) to create cue-anchored highlights with attached comment threads.
4. **If a video has no available captions**, the transcript tab displays an empty state notification: *"No transcript available for this video"*.
