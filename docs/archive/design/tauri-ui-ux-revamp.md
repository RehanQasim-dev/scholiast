# Scholiast — Complete Application UI/UX Revamp Specification

> **Target Platforms**: 
> - **Mobile Phones** (Android / iOS): One-handed portrait ergonomics, bottom-sheet interactions, fast inline thought capture without full-panel intrusion.
> - **Tablets** (Android / iPad): Landscape (60/40 resizable persistent splitter), Portrait (adaptive single-column with bottom sheet), S-Pen / stylus-native frame drawing.
> - **Desktop** (Linux / macOS / Windows): Keyboard shortcuts, collapsible sidebar, mouse hover states, resizable dual-pane workspace.
>
> **Guiding Principle**: High information density, zero wasted space, voice-first touch ergonomics, immediate actions, and complete visual restraint across every form factor.

---

## 1. Executive Summary: Forensic Audit of All Discovered Issues

A thorough audit of the frontend codebase (`scholiast_tauri/src/`) revealed systemic design and architectural flaws across every screen and component. These issues fall into seven major categories:

### 1.1 Navigation & Information Architecture Failures
* **Dead-End Viewer Tabs (`BottomTabs.tsx`, `Sidebar.tsx`)**:
  `Player` and `Reader` are hardcoded in the primary bottom navigation and sidebar. Tapping them without active content loads dead, empty black screens (*"Open a video from Home..."* and *"Pick an article from the library rail..."*). Viewers are content sessions, not navigation spaces.
* **Competing Settings Implementations (`Home.tsx` vs `App.tsx` vs `Sidebar.tsx`)**:
  In `Home.tsx`, the settings gear icon opens a full-screen modal `<div role="dialog">`. In `BottomTabs.tsx` and `Sidebar.tsx`, tapping Settings navigates to the route `/settings`. Two completely conflicting paradigms exist for opening the exact same settings page.
* **Non-Functional Back Navigation**:
  - Android's native system back-swipe gesture does nothing because `MainActivity.kt` lacks `onBackPressedDispatcher` wiring.
  - The in-app touch swipe handlers (`Reader.tsx:186`, `Player.tsx:158`) require touches to start at `< 32px` or `< 24px`—a microscopic 2mm margin at the extreme bezel edge that fails to trigger during normal use.

### 1.2 Article Reader & Extraction Failures (`Reader.tsx`, `extract.rs`, `sanitize.rs`, `ThreadCard.tsx`)
* **Why Pages Don't Render Correctly (The Firefox Readability Question)**:
  - The app currently uses `dom_smoothie`, which is a pure-Rust port of Mozilla's `Readability.js` (the engine behind Firefox Reader View).
  - However, Mozilla Firefox's Reader Mode does extensive pre-cleaning and post-formatting that `dom_smoothie` does **not** do by itself.
  - In our current pipeline:
    1. `dom_smoothie` extracts raw HTML containing complex nested layout tables, Wikipedia infoboxes, and cladograms.
    2. Our Rust sanitizer (`crates/core/src/sanitize.rs`) strips all CSS classes and attributes, turning `<table class="infobox">` into a generic unstyled `<table>`.
    3. Our CSS (`reader-typography.css`) sets `table-layout: fixed; overflow-wrap: anywhere;` on all tables.
    4. **The Disaster**: A 10-column cladogram or infobox is squeezed into the narrow column, forcing every single word to wrap letter-by-letter vertically (`o-t-h-e-r  F-e-l-i-n-a-e`).
* **3-Column Desktop Layout Crammed into Tablet**:
  `useIsNarrow` is hardcoded to `max-width: 900px`. On a landscape tablet (>900px), the app assumes a 32-inch desktop monitor and pins:
  - Left: 240px `LibraryRail`
  - Right: 320px `ThreadPanel`
  - Center: The actual article, squashed into a 300px column.
* **Top Bar Collisions & Overlaps (`ReaderTopBar.tsx`)**:
  Every button and chip has `minWidth: 48px` or fixed padding: `ArrowLeft`, `Library` link, `Sync` chip, `A-`, `Aa 16px`, `A+`, `Serif`, `Column width`, `Delete`. On tablet widths, they collide: the word **`Library`** and the **`Sync`** badge literally print on top of each other.
* **Radioactive Neon Green Cards (`ThreadCard.tsx:153`)**:
  Cards use CSS `color-mix(in srgb, var(--sc-hl-green) 12%, transparent)`. In WebKit/Android WebView, this fails to alpha-blend CSS variables and renders **solid 100% neon green (`#5fe3a0`)**, blinding the reader.
* **Truncated Quote Text**:
  Highlight range extraction clips leading letters (e.g. the word `"called"` was sliced into `"lled a tom..."`).

### 1.3 Lecture Player Failures (`Player.tsx`, `StudyDock.tsx`, `NoteCard.tsx`, `Chrome.tsx`)
* **Full-Width Bottom Bar Wastage (`StudyDock.tsx`)**:
  `StudyDock` floats across the entire screen, stealing ~60px of vertical video height in landscape mode for just three lonely, spaced-out icons (`Mic`, `Camera`, `Plus`).
* **Empty Note Creation Bug**:
  Tapping `+` calls `addNote({ urlHash, videoTime })` directly, creating a completely empty note in the database without opening an editor.
* **Childish Emoji & Bloated Cards (`NoteCard.tsx`)**:
  Hardcoded emojis (`📝`, `🎞`, `🖍`) next to timestamps; oversized 48px trash buttons permanently visible on every note; unclickable empty notes; bloated padding.
* **Full-Screen Modal Interruption (`CommentEditorSheet.tsx`)**:
  Editing or typing a comment summons a giant dark modal covering the entire screen, blocking both the video and the notes stream, backed by a confusing double-cancel confirmation flow.
* **Leaking YouTube Branding & Recommendation Tiles**:
  `.sc-yt-mask` has `hidden lg:block`, turning off the watermark mask on tablets (<1024px); pause and video-end trigger YouTube's recommendation tiles.

### 1.4 Home & Library Failures (`Home.tsx`, `RecentGrid.tsx`, `OpenLinkField.tsx`)
* **Articles Masquerading as Videos (`RecentGrid.tsx`)**:
  The query is named `listRecentVideos` and treats everything as a "video". Articles render with an empty video placeholder (a 16:9 box with a Play icon) instead of an article reading card.
* **Zero Search for Saved Library Items**:
  The input only accepts new URLs ("Paste YouTube or URL..."), with no way to filter or search through already saved lectures and articles.
* **No Content Segmentation**:
  Videos and reading articles are dumped into a single unsorted grid without any tab/filter distinction.

### 1.5 Settings Screen Failures (`Settings.tsx`, `AppearanceSection.tsx`)
* **8 Massive Stacked Boxes**:
  Eight giant rectangular cards stacked vertically on top of each other with heavy padding (`p-4 sm:p-10`).
* **Comically Oversized Inputs**:
  In `AppearanceSection.tsx`, a select dropdown with `h-14` (56px high) containing just two options: "Comfortable" and "Compact".
* **Dead Settings**:
  Static text stating: *"Scholiast is dark-only for now."*

### 1.6 Touch, Stylus & Virtual Keyboard Ergonomics
* **Virtual Keyboard Hijacking**:
  Focusing any input box immediately pops open the OS virtual keyboard, taking over half the screen and destroying the video or reading layout.
* **Inconsistent Touch Targets**:
  Buttons swing wildly between 48px colliding giants and microscopic 20px format buttons.

---

## 2. Multi-Device Adaptive Architecture: Mobile, Tablet & Desktop

The application adapts fluidly across three distinct device profiles:

```
┌─────────────────────────┬─────────────────────────┬─────────────────────────┐
│     MOBILE (PHONES)     │    TABLETS (PORT/LAND)  │         DESKTOP         │
├─────────────────────────┼─────────────────────────┼─────────────────────────┤
│ • Portrait-first layout │ • Landscape: 60/40      │ • Windowed / Fullscreen │
│ • Bottom bar navigation │   resizable split       │ • Collapsible sidebar   │
│ • Bottom 30% sheet for  │ • Portrait: Single col  │ • Full dual-panel split │
│   browsing comments     │   with slide sheet      │   with persistent ratio │
│ • Quick inline float-   │ • S-Pen & stylus canvas │ • Keyboard shortcuts    │
│   card for adding notes │ • Voice-first tablet    │   (`H`, `P`, `Esc`,     │
│   (no sheet opening!)   │   typing with [⌨️] opt  │   `Cmd+K`, `j/k` nav)   │
└─────────────────────────┴─────────────────────────┴─────────────────────────┘
```

### 2.1 Navigation Architecture Across Form Factors
* **Primary Spaces vs. Focused Viewers**:
  - **Spaces**: Home/Library (`/home`) and Settings (`/settings`).
  - **Viewers**: Lecture Player (`/player`) and Article Reader (`/reader`).
  - `Player` and `Reader` are **never persistent navigation tabs** on any device.
* **Device-Specific Shells**:
  - **Mobile**: Minimal bottom navigation (`[ 🏠 Library ]` and `[ ⚙️ Settings ]`). Tapping any content opens viewer full-screen with top-left `[ ← ]` back target and Android back gesture support.
  - **Tablet**: Clean edge-to-edge view. In Library, sleek top bar with segment chips. In Viewers, full-height workspace.
  - **Desktop**: Left vertical sidebar (collapsible via `Cmd+B` / `Ctrl+B`) containing Library, Tags, Settings, and Sync indicator.

---

## 3. Mobile Phone UX Specifications (Smart, Fluid & Non-Intrusive)

### 3.1 Mobile Article Reading & The Bottom 30% Sheet
On a phone screen, reading text must never be squeezed into side-by-side columns:
1. **The Pure Reading View**:
   - The article occupies 100% of the screen width with comfortable reading margins.
   - The header auto-hides on downward scroll and reappears on scroll-up or top-tap.
   - At the bottom of the screen, a subtle, unobtrusive **Comments Indicator Pill** floats:
     `[ 💬 3 comments  ▲ ]`
2. **Browsing Past Comments (Swipe Up Gesture)**:
   - Swiping upward from the bottom of the screen (or tapping the indicator pill) smoothly slides up a **Bottom Sheet covering only the bottom 30% to 40% of the screen**.
   - **The Article Remains Visible**: You can still see and scroll the article text in the top 60% of the screen while reviewing your notes below!
   - Dragging the handle down snaps the sheet closed.

### 3.2 Adding a Comment on Mobile: Fast Floating Dialog (No Sheet Opening!)
When you are reading an article on mobile and want to jot down a quick thought or speak a voice note, **you do NOT want a giant bottom sheet covering your screen**.

```
┌─────────────────────────────────────────────────────────────┐
│ Cat (Felis catus) is a small carnivorous mammal...          │
│                                                             │
│ [Selected text highlighted in yellow]                       │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🟡 🔴 🟢  |  💬 Comment  |  🎙️ Speak                     │ │ ← Selection Swatch
│ └─────────────────────────┬───────────────────────────────┘ │
│                           │ Tap "🎙️ Speak" or "💬 Comment"   │
│                           ▼                                 │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 💬 "Important family lineage..."                        │ │ ← Compact Floating Card
│ │ [🎙️ Recording... 0:04]        [⌨️ Type] [Cancel] [✓ Save] │ │   (NO full sheet!)
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ It is the only domesticated species in the family Felidae...│
└─────────────────────────────────────────────────────────────┘
```

1. **Step 1 — Selection**: Select text in the article. A minimal swatch bar floats directly above/below the selection with:
   `[ 🟡 Yellow ] [ 🔴 Red ] [ 🟢 Green ] [ 💬 Comment ] [ 🎙️ Speak ]`
2. **Step 2 — Immediate Capture**:
   - **Voice Note (`🎙️ Speak`)**: Tap mic. A compact, lightweight floating card docks directly near the highlight. Recording starts instantly. Speak your thought. Transcription streams into the preview card. Tap `✓ Save` (or tap outside) to commit.
   - **Text Note (`💬 Comment`)**: Tap comment. The compact floating card opens with an auto-focused text field. Type your thought, tap `Save`.
3. **Zero Context-Switch**:
   - The bottom comments panel is **never opened**.
   - You stay 100% in your reading flow.
   - Once saved, a subtle badge appears in the margin next to the line.

### 3.3 Mobile Lecture Player
- **Vertical Stack**: Video pinned at top (16:9 ratio).
- **Below Video**: Segmented bar `[ Notes (3) ] [ Transcript ]`.
- **Bottom Composer**: Sleek chat composer docked directly above the phone's navigation safe area.

---

## 4. Tablet UX Specifications (Landscape 60/40 Splitter & S-Pen)

### 4.1 Resizable 2-Panel Splitter (60/40 Default, Persistent)
For both 2-panel surfaces on tablet (**Player**: Video Stage + Study Panel; and **Reader**: Article Canvas + Annotations Inspector when opened in landscape):

1. **Default Ratio**: `60%` left panel (Video / Article) / `40%` right panel (Notes / Annotations).
2. **Draggable Divider Handle**:
   - A sleek vertical divider line (`w-2` hit area with a centered subtle 2px bar).
   - Shows a subtle accent highlight and `col-resize` affordance on touch/hover.
   - Real-time dragging using `PointerEvent` with `setPointerCapture` (ensures dragging over YouTube iframes never stutters or drops).
3. **Double-Tap / Double-Click to Reset**:
   - Double-tapping the divider instantly resets the layout to the default **60 / 40** ratio.
4. **Range Clamping**:
   - Left panel minimum: `35%`.
   - Right panel minimum: `25%`.
5. **Persistence Across Sessions**:
   - The custom ratio is saved to `store.ts` (`playerSplitRatio`, `readerSplitRatio`).
   - Reopening any lecture or article immediately restores the user's preferred layout.

### 4.2 S-Pen & Stylus Integration (`FrameDraw.tsx`)
- High-precision S-Pen drawing directly over captured 16:9 video frames and article figures.
- Clean header without emojis (`💬`).
- Auto-palm rejection on touch devices.

---

## 5. Desktop UX Specifications (Mouse, Shortcuts & Multi-Window)

1. **Collapsible Left Sidebar (`Sidebar.tsx`)**:
   - Sleek desktop rail with `Library`, `Tags`, `Sync Status`, and `Settings`.
   - Toggleable with `Cmd+B` / `Ctrl+B` or hover collapse.
2. **Desktop Keyboard Shortcuts**:
   - `Space`: Play/Pause video lecture.
   - `J` / `K`: Seek -10s / +10s in video, or jump to previous/next highlight in Reader.
   - `H`: Toggle text highlighter tool.
   - `C`: Open note composer for current playback time or selected highlight.
   - `Cmd+K` / `Ctrl+K`: Global library search.
   - `Esc`: Dismiss popovers, dialogs, or active tool.
3. **Window Resizing**:
   - Seamlessly scales between full 2-panel split and single-column stack as window is resized.

---

## 6. Lecture Player Screen Overhaul (`/player`)

### 6.1 Layout Anatomy (Landscape Resizable Split)
```
┌──────────────────────────────────────┬─┬────────────────────────┐
│                                      │ │ Notes (3)   Transcript │
│                                      │ │────────────────────────┤
│                                      │ │0:15                    │
│                                      │ │Key concept introduced. │
│             VIDEO STAGE              │ │                        │
│       (Airtight YouTube Mask)        │D│1:42  [🖼️ 16:9 Frame]   │
│                                      │R│Important diagram.      │
│                                      │A│                        │
│                                      │G│                        │
│ [▶] [↺ 15] [↻ 15] ──●── 1:42 / 14:20 │ │                        │
│ ──────────────────────────────────── │ │────────────────────────┤
│                                      │ │[⏱️ 1:42] Speak...[⌨][🎙]│
└──────────────────────────────────────┴─┴────────────────────────┘
  ◄──────── 60% (Resizable) ────────► ◄── 40% (Resizable) ──►
```

### 6.2 Removal of Full-Width Bottom Bar
- **Delete `StudyDock.tsx` entirely**.
- The video stage extends to 100% of the container height. No persistent bottom dock steals vertical space.

### 6.3 Chat-Style Composer (Right Pane Bottom)
Positioned at the foot of the notes stream (like WhatsApp or Telegram):
1. **Live Timestamp Chip `[⏱️ 1:42]`**:
   - Live-tracks playback time.
   - One tap toggles timestamp off (`[⏱️ None]`) for general notes.
2. **Voice-First Input**:
   - Placeholder: `"Speak or write a note..."`.
   - **Soft Keyboard Suppression**: Tapping the text area focuses it without summoning the OS keyboard.
   - **Dedicated Keyboard Toggle `[⌨️]`**: Tapping this explicitly summons the software keyboard.
   - **Microphone Button `[🎙️]`**: Tap to record. Transcribed text lands in the composer with instant save or 1-tap confirmation.
3. **Snapshot Attachment `[📷]`**:
   - Captures current video frame and docks a compact 16:9 thumbnail preview directly inside the composer:
     ```
     ┌────────────────────────────────────────────────────────┐
     │ [ 🖼️ Frame Preview  ✕ ] [⏱️ 1:42]                      │
     │ Add caption or speak...                  [⌨️] [🎙️] [➤] │
     └────────────────────────────────────────────────────────┘
     ```
   - Send with caption, or send immediately as a standalone frame capture. Tapping the preview opens the stylus drawing canvas.

### 6.4 High-Density Notes Stream (`NoteCard.tsx`)
- **Remove all emojis**: Eliminate `📝`, `🎞`, `🖍`.
- **Compact Padding**: `py-1.5 px-2.5` with a subtle hairline divider.
- **Timestamp Badge**: Sleek, high-contrast monospace pill `0:15`.
- **Inline Fast Editing**: Tapping the note body immediately turns the text into an inline input with `Save` / `Cancel` (or `Enter` to commit).
- **Secondary Actions**: Swipe left or hover to reveal delete; no permanent 48px trash buttons.

### 6.5 Airtight YouTube Chrome & Watermark Shield
- **Fix Watermark Mask**: Remove `hidden lg:block` from `.sc-yt-mask` in `Player.tsx`. Ensure it permanently anchors to the bottom-right across all DPRs and aspect ratios.
- **End-Screen / Pause Shield**:
  - Listen to `onStateChange` for `PAUSED` and `ENDED`.
  - Display an opaque black/freeze backdrop over the player iframe so YouTube's related video tiles and recommendation cards are never visible.

---

## 7. Article Reader Screen & Extraction Engine Overhaul (`/reader`)

### 7.1 Extraction & Sanitization Engine Overhaul
To achieve true Firefox Reader Mode / Pocket quality:
1. **Pre-Sanitization Filter (in `extract.rs` & `sanitize.rs`)**:
   - Strip non-content layout elements before Readability or during sanitization:
     - `table.infobox`, `.infobox`, `.sidebar`, `.vertical-navbox`
     - `.navbox`, `.navigation`, `.hatnote`, `.reflist`, `.mw-editsection`
     - Citation markers: `sup.reference`, `[citation needed]`
     - Interactive widgets: `.thumbcaption .magnify`, audio players, search boxes.
2. **Responsive Table Container**:
   - Legitimate data tables are wrapped in `<div class="sc-table-container">`.
   - **CSS Fix**: Remove `table-layout: fixed` and `overflow-wrap: anywhere` from `.sc-article-body table`!
   - Replace with:
     ```css
     .sc-table-container {
       width: 100%;
       overflow-x: auto;
       margin: 1.5em 0;
       border-radius: var(--sc-radius-md);
       border: 1px solid var(--sc-hairline);
       -webkit-overflow-scrolling: touch;
     }
     .sc-article-body table {
       width: 100%;
       border-collapse: collapse;
       table-layout: auto;
       white-space: normal;
       overflow-wrap: normal;
       word-break: normal;
     }
     ```
   - Tables now scroll horizontally on touch/stylus without squeezing cells into vertical single characters!

### 7.2 Layout Anatomy: Clean Reading Canvas
```
┌─────────────────────────────────────────────────────────────┐
│ [← Library]                       [aA]  [📑 Annotations (2)]│  ← Auto-hides on scroll
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                            Cat                              │
│                                                             │
│   The cat (Felis catus), commonly referred to as the        │
│   domestic cat, is a small carnivorous mammal. It is the    │
│   only domesticated species in the family Felidae.          │
│                                                             │
│   [Highlighted passage in warm amber] ──────► [💬 Note]     │
│                                                             │
│   Domestic cats are valued by humans for companionship      │
│   and their ability to kill rodents.                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 7.3 Removal of Pinned Library Rail
- The 240px `LibraryRail` is **never pinned** during reading.
- Reading gets 100% of the screen width.
- Accessing other articles is done via the `[ ← Library ]` button or an on-demand slide-over drawer.

### 7.4 Minimalist, Auto-Hiding Top Bar
- **Replace the 10-button header** with a clean header:
  - Left: `[ ← ]` Back to Library.
  - Right: `[ aA ]` Formatting popover and `[ 📑 Annotations (count) ]` toggle.
- **Auto-Hide Motion**: Scrolling down smoothly hides the header (`transform: translateY(-100%)`). Scrolling up or tapping near the top reveals it instantly.
- **Unified `[ aA ]` Popover**:
  ```
  ┌──────────────────────────────┐
  │ Text Size      [ A− ] [ A+ ] │
  │ Typeface       [Sans] [Serif]│
  │ Column Width   [Narrow|Wide] │
  │ Theme          [OLED | Sepia]│
  └──────────────────────────────┘
  ```

### 7.5 On-Demand Annotations (Adaptive by Device)
- **Mobile**:
  - Browsing: Swipe up from bottom edge to open bottom **30% sheet**.
  - Creating: Floating compact card near highlight without opening bottom sheet.
- **Tablet / Desktop**:
  - Closed by default when article has 0 annotations.
  - Opens as right-side panel with **60/40 resizable splitter**.
- **Card Styling Fix**:
  - Replace `color-mix` with explicit alpha: `rgba(95, 227, 160, 0.12)`.
  - Fix range extraction leading-letter clipping bug.
  - Subtle highlight tint; zero neon solid backgrounds.

---

## 8. Home / Library Screen Overhaul (`Home.tsx`, `RecentGrid.tsx`)

### 8.1 Content Segmentation (Lectures vs. Articles)
- Add a sleek segmented filter bar at the top of the library:
  `[ All ] [ Lectures (YouTube) ] [ Articles (Reader) ]`
- Filter items instantly with zero network delay.

### 8.2 Dual-Purpose Search / Ingest Field
- If input matches a URL: Show primary `"Open / Ingest"` action.
- If input is text: Live-filter the saved library by title and domain.

### 8.3 Dedicated Card Visuals
- **Lectures**: 16:9 thumbnail with scrub progress line, video duration, and note count badge.
- **Articles**: Domain badge / favicon, clean typography snippet, reading progress percentage, and annotation count. No video play-icon placeholders for articles.

### 8.4 Unified Settings Access
- Remove the inline modal dialog `<SettingsPage />` in `Home.tsx`.
- The gear icon in Home navigates directly to `/settings`.

---

## 9. Settings Screen Overhaul (`Settings.tsx`)

### 9.1 Modern Grouped Structure
- Replace 8 heavy stacked boxes with a clean, cohesive list (iOS/Material 3 settings style).
- Groups:
  1. **Account & Sync**: Google Drive status, sync frequency, manual sync trigger.
  2. **Voice & AI**: Transcriber engine (Groq / Gemini / Local Whisper), language selection, custom prompt templates.
  3. **Reading & Playback**: Default font step, typeface preference, auto-pause on note creation.
  4. **Data & Storage**: Cache size, export data, storage wipe.

### 9.2 Streamlined Controls
- Replace comically large `h-14` (56px) select boxes with sleek segmented pickers and native toggle switches.

---

## 10. Android System Back Gesture & Tablet Ergonomics

### 10.1 Native Android `onBackPressedDispatcher`
In `scholiast_tauri/src-tauri/gen/android/app/src/main/java/app/scholiast/app/MainActivity.kt`:
- Wire Android's native back dispatcher:
  ```kotlin
  onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
          // Dispatches back event to WebView / React Router
          triggerRouterBack()
      }
  })
  ```
- Physical edge-swipes on Samsung Galaxy Tabs and Android phones now reliably navigate back: `Player → Home`, `Reader → Home`, `Settings → Home`.

### 10.2 Deletion of Fragile In-App Swipes
- Delete brittle `x < 24` and `x < 32` touch listeners in `Reader.tsx` and `Player.tsx`.
- Standardize on the native Android back gesture and prominent `[ ← ]` header targets.

---

## 11. Design System Tokens & Polish Checklist

| Area | Current Anti-Pattern | Revamped Standard |
|---|---|---|
| **2-Panel Split** | Hardcoded `lg:w-[65%]` and `w-[320px]` | Draggable persistent splitter (default 60/40, double-tap reset) |
| **Mobile Notes** | Forces full-screen sheet or modal | Swipe up for bottom 30% sheet; floating card for quick note creation |
| **Table Layout** | `table-layout: fixed; overflow-wrap: anywhere` | Horizontal scroll container `<div class="sc-table-container">` |
| **Pre-Clean** | Dumps raw infoboxes / cladograms | Strips `.infobox`, `.navbox`, `sup.reference` |
| **Padding** | 24px+ bloated card paddings | `py-1.5 px-2.5` tight, sleek density |
| **Borders** | Bulky nested borders | `1px border-hairline` (`rgba(255,255,255,0.08)`) |
| **Iconography** | Emojis (`📝`, `🎞`, `🖍`) | Understated Lucide SVG vector icons (16–20px) |
| **Typography** | Colliding 48px touch targets | Clean monospace timestamp badges, legible hierarchy |
| **Colors** | Neon green annotation cards | Dark OLED surfaces (`#0b0d14`), subtle accent highlights |
| **Keyboard** | Auto-opening virtual keyboard | Opt-in keyboard toggle (`[⌨️]`), voice-first STT |
| **Chrome** | Pinned sidebars everywhere | Viewers focused on content; sidebars on-demand |

---

## 12. Phased Implementation Roadmap

### Phase 1: Navigation & System Back Gesture
- [ ] Wire `MainActivity.kt` `onBackPressedDispatcher` to support Android system edge-back swipes.
- [ ] Remove `Player` and `Reader` from `BottomTabs.tsx` and `Sidebar.tsx`.
- [ ] Add "Continue Studying" active session banner to `Home.tsx`.
- [ ] Remove duplicate settings modal dialog in `Home.tsx`.

### Phase 2: Resizable 2-Panel Splitter Component
- [ ] Build reusable `SplitterPane` component with touch/pointer drag, 60/40 default, and double-tap reset.
- [ ] Persist ratios (`playerSplitRatio`, `readerSplitRatio`) in `store.ts`.

### Phase 3: Player Screen Overhaul
- [ ] Remove `StudyDock.tsx` completely.
- [ ] Wire `SplitterPane` for Video Stage vs. Study Panel (Tablet & Desktop).
- [ ] Implement responsive vertical stack for Mobile.
- [ ] Build chat-style composer in `NotesTab.tsx` (Voice mic, keyboard toggle, timestamp chip, snapshot attachment).
- [ ] Redesign `NoteCard.tsx` (strip emojis, high-density padding, inline editing).
- [ ] Fix `.sc-yt-mask` on tablet and implement pause/ended recommendation shield.

### Phase 4: Reader Screen & Extraction Overhaul
- [ ] Pre-clean article HTML in `extract.rs` & `sanitize.rs`: strip infoboxes, navboxes, sidebars, citation links.
- [ ] Fix table typography in `reader-typography.css`: wrap in horizontal scroll container, remove `overflow-wrap: anywhere`.
- [ ] Unpin `LibraryRail` from `Reader.tsx`; make it an on-demand slide-out drawer.
- [ ] Build minimalist auto-hiding header with single `[ aA ]` popover in `ReaderTopBar.tsx`.
- [ ] Implement Mobile reading ergonomics:
  - Bottom 30% sheet on upward swipe for viewing comments.
  - Floating lightweight dialog near highlight for immediate voice/text note creation (zero sheet intrusion).
- [ ] Wire `SplitterPane` for Tablet/Desktop annotations panel.
- [ ] Fix `ThreadCard.tsx` colors (replace `color-mix` with explicit alpha) and fix quote clipping.

### Phase 5: Home & Settings Polish
- [ ] Add segmented filter (`All` | `Lectures` | `Articles`) and library keyword search to `Home.tsx`.
- [ ] Style articles in `RecentGrid.tsx` with dedicated reading card layout.
- [ ] Redesign `Settings.tsx` into clean grouped sections with compact segmented controls.
