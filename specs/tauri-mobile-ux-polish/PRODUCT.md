# PRODUCT.md — Mobile UX Hardening & Feature Polish

## Summary
Refines the mobile Android experience on phones (including Pixel 6 Pro) by enabling native system share target intents, eliminating top status bar overlaps, suppressing native WebView selection popups that block highlighting, consolidating Google Drive sync settings into a sleek unified card, removing redundant playback settings, and introducing a gesture-driven bottom comments sheet (20% peek / 70% expanded) in Reader mode.

---

## Behavior Invariants

### Group 1: Settings Consolidation & Cleanup
1. **API Key Button Styling**: All API key input rows and action buttons in Settings (e.g. Speech section Groq/Gemini keys) strictly use uniform emerald button tokens (`.btn-emerald` / `bg-accent text-[var(--sc-accent-text)]`) matching the rest of the application.
2. **Unified Google Drive Card**:
   - Google Drive connection status and sync operations are presented in a single, compact, modern card.
   - The card header displays "Google Drive" with an inline connection badge and a small connect/disconnect action in the top-right corner.
   - The card body displays last-synced relative timestamp, pending change count, and a prominent "Sync Now" button.
   - When sync is in progress, the card shows a thin real-time emerald progress bar, a fractional progress counter `(X/Y)`, and the active file/URL being processed directly underneath.
3. **Playback Speed Removal**: The "Default playback speed" preference dropdown is removed from Settings -> Playback, keeping only relevant playback preferences (such as Seek step size).

### Group 2: Android Share Target Intent (Send to Scholiast)
4. **System Share Sheet Availability**: Scholiast appears as a share target in the native Android system share sheet when sharing text or web links from external apps (e.g., YouTube, Chrome, Twitter, Firefox).
5. **Smart Routing on Share**:
   - When a YouTube link is shared to Scholiast, the app immediately opens the Lecture Player (`/player?url=...`) with the shared video.
   - When any non-YouTube web link is shared to Scholiast, the app immediately opens Reader Mode (`/reader?url=...`), automatically fetches and renders the article for reading and annotation.
   - Works consistently whether the app was closed (cold start) or already running in the background (warm start).

### Group 3: Status Bar & Safe Area Padding
6. **No Status Bar Overlap**: The application content and top navigation bars never overlap with or hide behind the mobile status bar (time, battery, Wi-Fi, camera punch-hole).
7. **Exact Minimal Inset**: The app applies exact system status bar insets so no excessive blank space is wasted, maximizing usable vertical reading area while ensuring all top icons and buttons are 100% clickable.

### Group 4: Text Selection Swatch vs Native Action Mode
8. **Native Floating Menu Suppression**: Selecting text in the article view on Android does not summon Android's native floating `Copy | Share | Select all` toolbar that obscures custom UI.
9. **Unobstructed Swatch Popup**: The Scholiast `SwatchPopup` (color highlights, text note, voice note, diagram) appears directly above the text selection without being blocked or occluded by native OS overlays.
10. **In-Popup Copy**: The `SwatchPopup` includes a dedicated Copy button so users can copy selected text to their clipboard with one tap while retaining fast annotation workflows.

### Group 5: Mobile Reader Gesture Comments Sheet
11. **Default Hidden State**: In Reader mode on mobile (`isNarrow`), the comments panel is completely hidden by default (`0%` height). There is no permanent black bar at the bottom; the article occupies the entire screen.
12. **Swipe-to-Peek (20%)**: Swiping upward from the bottom edge of the screen reveals the comments sheet in a compact peek state occupying ~20% of the screen height.
13. **Swipe-to-Expand (70%)**: Swiping upward from the top edge/handle of the 20% peek sheet expands it to ~70% of the screen height for full comment reading and reply composition.
14. **Swipe-to-Dismiss**: Swiping downward from the top edge/handle of the sheet smoothly collapses and dismisses the panel back to the hidden state.
15. **Double-Tap Article Dismiss**: Double-tapping or double-clicking anywhere in the article reading area automatically closes the comments sheet.
16. **Annotation Action Activation**: Creating a comment from the swatch popup or tapping an existing highlight opens the sheet directly to make reading or replying immediate.
