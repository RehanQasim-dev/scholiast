# Product Spec: Tauri YouTube Player & Note Timeline

## Summary
Embedded YouTube lecture player chrome, scrub bar controls, resume position tracking, and chronological note timeline cards.

## Behavior

1. **YouTube videos load inside an embedded player** completely isolated behind custom dark chrome, eliminating native YouTube UI and recommendation end-screens.
2. **The player interface provides custom controls**: play/pause, scrub bar, time display, +/-15s seek buttons, speed selector (0.25x-2.0x), volume, and fullscreen toggle.
3. **Playback position (`resume_at`)** is continuously tracked and automatically restored when returning to a video.
4. **The Notes timeline presents chronological, timestamped cards** (`M:SS` or `HH:MM:SS`); clicking any timestamp instantly seeks playback to that second.
5. **Video notes settings gear** provides quick controls in the notes header for comment font size scaling (`text-xs` to `text-lg`).
6. **Complete third-party chrome suppression**: YouTube watermarks, channel logos, and end-screen recommendation tiles are masked across all screen widths and aspect ratios.
7. **Referrer policy enforcement**: Embedded player requests enforce strict referrer policies preventing YouTube Error 153 playback blocks on Android and desktop webviews.
8. **Study session immersion**: On mobile and tablet landscape viewports, player navigation controls dock into a space-efficient layout without full-width wasted bottom bars.
