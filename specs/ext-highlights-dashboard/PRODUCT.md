# Product Spec: Highlights Dashboard

## Summary
Dedicated full-tab manager (`highlights.html`) providing a high-density stream of all web highlights, drawings, and YouTube video notes with real-time filtering, search, and batch operations.

## Behavior

1. **Dedicated full-tab manager (`highlights.html`)** opens via toolbar popup, card links, or global hotkey.
2. **Consolidates web highlights, drawings, and YouTube video notes** into a single chronological stream grouped by page and video.
3. **Provides real-time filtering** by color, comment presence, `#tags`, domain/channel, and full-text search.
4. **Direct card manipulation** allows editing comments, modifying tags, or deleting highlights with direct write-through to storage.
5. **Clicking any highlight card** navigates to the original webpage, awaits DOM mounting, and smoothly scrolls the highlight into view.
6. **Multi-selection enables batch operations**: recoloring, bulk deletion, and formatted Markdown export.
