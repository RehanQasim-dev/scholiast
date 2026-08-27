# Phase 2 & 3 Implementation Plan: Complete UI/UX, Annotation Gestures & Reader Engine

> **Document Purpose**: Definitive technical roadmap and architecture specification for Scholiast Mobile, Tablet, and Desktop. Captures all agreed-upon gesture engines, floating selection swatches, zero-confirmation voice workflows, pressure-sensitive stylus drawing, cloud backup modals, and authentic webview reading.

---

## 1. Ergonomics & Space Philosophy

### 1.1 Overview Screens vs. Study Sessions
* **Overview & Management Screens (`/home`, `/library`, `/settings`)**:
  * **Spacious Layout**: Generous top breathing room (`pt-7 sm:pt-9 px-6 pb-24`) to gracefully accommodate Android system status bars, tablet display bezels, and phone camera cutouts without visual collision.
  * **Desktop / Tablet Sidebar (`Sidebar.tsx`)**: Left-pane header displaying the minimalist purple accent app mark (`Scholiast — Lecture & Reading`) with spacious `h-11` pill navigation links.
* **Study Sessions (`/player`, `/reader`, `/frame`) — Zero Wasted Space**:
  * **Edge-to-Edge Immersion**: Large paddings, top headers, and persistent tab bars are completely suppressed.
  * **Mobile (Pixel 6 Pro)**: 
    * OLED black backdrop (`#000000` / `#0b0d14`) blending seamlessly with hardware borders.
    * Auto-collapsing minimal top bar on scroll down; gently slides back into view on tap or scroll up.
    * No redundant on-screen back arrows—native Android edge swipe handles history popping cleanly.
  * **Tablet (Galaxy Tab S7+)**:
    * Full landscape utilization with persistent 60/40 resizable splitter for Player notes.
    * Reader controls docked in an ergonomic vertical side rail rather than stretched across a 2560px top bar.

---

## 2. Text Selection, Highlighting & Gestures

### 2.1 The Scroll vs. Highlight Conflict Resolution (Zero Tool Toggling)
Eliminates the friction of toggling highlighter tools on and off while reading:
1. **S-Pen / Stylus Hardware Mode (`pointerType === 'pen'`, Galaxy Tab S7+)**:
   * **Direct S-Pen Contact**: Touching the screen with an S-Pen tip **always highlights text immediately** across words with zero delay and zero long-press.
   * **Direct Touch / Finger Contact (`pointerType === 'touch'`)**: Fingers **always scroll the page smoothly**.
   * **Result**: Natural reading where fingers flick and scroll, while the pen highlights instantly.
2. **Touch Vector Disambiguation (Fingers / Pixel 6 Pro)**:
   * **Vertical Motion (Angle $> 40^\circ$, or $> 8\text{px}$ vertical movement in the first 80ms)**: Locks to smooth, native vertical page scrolling.
   * **Horizontal Motion (Angle $< 25^\circ$ along lines of text)**: Engages precise text tracking and selection.
   * Prevents accidental highlights while flicking through articles.

### 2.2 Floating Selection Swatch
Appears immediately above the highlighted text quote upon finger or stylus lift:
* **Color Swatches (Exactly 3 Colors Matching Browser Extension Tokens)**:
  1. **Yellow**: `#d29600` (`var(--sc-hl-yellow)`)
  2. **Red / Coral**: `#dc3c5a` (`var(--sc-hl-red)`)
  3. **Green / Emerald**: `#2da05f` (`var(--sc-hl-green)`)
* **Action Buttons (Custom High-Taste Vector SVGs, Zero Low-Quality Emojis)**:
  1. **Text Comment (`[💬]`)**: Crisp vector speech bubble $\to$ opens clean bottom card composer.
  2. **Voice Note (`[💬🎙️]`)**: Custom composite vector icon with a sleek microphone overlaid on top of a speech bubble $\to$ triggers the Dynamic Aura Voice Flow.
  3. **Diagram / Shapes (`[📐]`)**: Exact 3-shape vector icon from the Clipper extension (`comment-overlays.ts:1626` — triangle on top, square at bottom-left, circle at bottom-right) $\to$ opens stylus/touch drawing canvas.
* **No Tags in Swatch**: The swatch remains minimal and focused. `#tags` live strictly inside the comment card and typing composer.

---

## 3. Instant Voice Notes Workflow (Dynamic Aura Pill & Zero Confirmation)

### 3.1 Visual Speech Feedback: The Dynamic Aura Pill
Tapping `[💬🎙️]` on the swatch smoothly morphs the floating pill into a compact dark-glass audio visualizer (Emil Kowalski / Dynamic Island style):
* **While Speaking**: 4 vertical glowing purple frequency bars bounce in real time to the live microphone decibel level via Web Audio API (`audioContext.createAnalyser`).
* **Silence Detection (2.0-Second VAD)**: Local Voice Activity Detection (VAD) monitors speech. When 2.0 seconds of silence is reached (or when the user taps to finish early), recording completes.
* **Processing State**: The frequency bars morph into a fluid gradient pulse line shimmering left-to-right while Whisper transcribes at `-O3`.

### 3.2 Zero-Confirmation Instant Save
* **No Blocking Confirmation Dialog**: Once transcribed, the text is **immediately committed to SQLite** and rendered as a note card attached to the highlight.
* **Subtle Undo Toast**: A 2-second pill appears at the bottom: `Saved: "[transcribed text]..." [ Undo ]`. If untouched, it fades out.
* **Post-Edit Flexibility**: If the user needs to correct text, tapping or double-tapping the note card in the stream directly opens inline editing.

---

## 4. Mobile Zen-Mode Excalidraw Engine (Fork & Prune `obsidian-excalidraw-plugin`)

Tapping the **Diagram (3 Shapes)** icon in the selection swatch opens the full-featured, mobile-optimized Excalidraw canvas:
* **Architecture Strategy: Fork / Import & Prune**:
  * Instead of cherry-picking individual files, we **import the `obsidian-excalidraw-plugin` codebase as a foundation** and **systematically strip/prune the Obsidian-specific dependencies**:
    * **Prune Obsidian Runtime**: Remove `import { App, Plugin, TFile, Vault, WorkspaceLeaf } from "obsidian"` and Electron desktop IPC.
    * **Strip Markdown Note Transclusion**: Remove complex markdown note transclusions, block references, and vault file tree browsing to keep diagrams lean, fast, and purely focused on visual sketching, shapes, and formulas.
    * **Rewire Persistence**: Connect drawing save/load directly to Scholiast's SQLite database and Google Drive sync engine (`diagrams` store: rendered PNG + `.scene.json`).
  * **Preserve the Full Suite of Rich Features**:
    * **MathJax / LaTeX Formula Rendering**: Direct embedding of mathematical formulas into diagram nodes and labels (`MathjaxToSVG`).
    * **Advanced Stylus & Pen Smoothing**: Full S-Pen pressure curves, smoothing algorithms, and palm rejection heuristics.
    * **Custom Tools, Scripts & Palettes**: Grid alignment, color swatches, laser pointer, and element grouping.
    * **Hand-drawn Architectural Aesthetics**: Clean sketch styling that feels like personal engineering notes.
* **Mobile Zen Mode (Pixel 6 Pro & Touch Screens)**:
  * Strips desktop menus, sidebars, and cluttered headers.
  * Replaces them with a **clean bottom thumb dock**:
    `[ ⏹️ Box ]` `[ ⏺️ Circle ]` `[ ➡️ Arrow ]` `[ ✏️ Pen ]` `[ 🔤 Text ]` `[ 📐 Math/LaTeX ]`.
  * Drops pre-built vector shapes on tap with large finger-friendly resize handles, eliminating clumsy finger-drawing.
* **Tablet Mode (Galaxy Tab S7+)**:
  * Expands to full 12.4" canvas with S-Pen drawing, pressure sensitivity, shape snapping, and grid alignment.
* **One-Tap Save**:
  * Header `[ ✓ Save Diagram ]` button exports a high-resolution PNG blob directly into the highlight's comment thread, syncing via the standard Google Drive pipeline (`diagrams/diagram-<id>.png` & `diagram-<id>.scene.json`).

### 4.1 Dedicated Excalidraw Settings Page (`/settings/excalidraw`)
Because Obsidian-Excalidraw normally presents its rich settings catalog through Obsidian's internal plugin tab, Scholiast provides a **first-class dedicated settings view** in the main app:
* **Pen & Stylus**: S-Pen pressure sensitivity toggle, stroke smoothing level (low/medium/high), palm rejection strictness.
* **Canvas Defaults**: Default stroke color, background style (grid, dots, blank), stroke roughness (architectural vs clean vector).
* **Math & LaTeX**: MathJax font size, default formula template.
* **Export Quality**: Render scale (1x, 2x, 3x retina PNG export).

---

## 5. Cloud Backup & Sync Architecture

### 5.1 Header Cloud Icon (`[ ☁️ ]`) Interaction
* **When Google Drive IS Connected**:
  * 1-tap triggers immediate manual sync ("Sync now").
  * Cloud icon spins smoothly (`RefreshCw`), flashing a green status dot upon completion.
* **When Google Drive IS NOT Connected**:
  * 1-tap opens a **centered setup modal dialog**:
    * **Header**: `Setup Cloud Backup`
    * **Status**: `Google Drive: Not connected` $\to$ prominent `[ Authorize Google Drive ]` button (1-tap OAuth).
    * **Automated Backup Settings**:
      * `[✓] Auto-backup changes every 5 minutes`
      * `[✓] Auto-backup when closing notes or exiting study sessions`

### 5.2 Ecosystem Compatibility
* The sync engine adheres 100% to the Clipper browser extension and Obsidian plugin per-page Drive layout:
  * `pages/page-<urlhash>.json` (version 2, CAS revision tracking, tombstones for highlights/drawings/comments).
  * `frames/frame-<itemId>.jpg` (video frame blobs).
  * `diagrams/diagram-<id>.png` and `diagram-<id>.scene.json` (Excalidraw / drawing image blobs).

---

## 6. Reader Typography & Display Themes

### 6.1 Theme Engine (OLED Black, Warm Sepia & Soft Slate)
Supported across both Reader Readability View and Live Webview (Dark Reader Engine):
* **OLED Pitch Black**: `--bg: #000000; --text: #d4d4d8;` (Pure AMOLED black, zero battery draw on Pixel 6 Pro & Tab S7+).
* **Warm Sepia Paper**: `--bg: #1c1815; --text: #e6dfd5;` (Muted amber-brown, e-ink paperback book feel).
* **Soft Slate Navy**: `--bg: #0f172a; --text: #cbd5e1;` (Muted dark navy for night study).
* **Clean Light Paper**: `--bg: #fbfbfa; --text: #18181b;` (Crisp daytime reading).

### 6.2 Typography Controls
* **Font Sizing**: Stepper `[ A- | 18px | A+ ]` or pinch-to-zoom.
* **Typefaces**:
  * *Modern Sans*: Inter / System Grotesk.
  * *Book Serif*: Literata / Georgia (crafted for extended reading).
  * *Monospace*: JetBrains Mono / Fira Code (technical specs and code blocks).
* **Bionic Reading Toggle**: Bolds the initial letters of each word to facilitate rapid visual fixation points.
* **Tablet Ergonomics (Tab S7+)**: Samsung Notes-style vertical floating pill docked along the left edge for easy thumb access on wide screens.

---

## 7. Mandatory Release Targets & Compiler Optimization

### 7.1 The 4 Release Target Architectures
Always compile **ONLY these 4 targets** for application releases:
1. **`arm64-v8a`** (`aarch64-linux-android`): Modern 64-bit Android devices (Pixel 6 Pro, Tab S7+).
2. **`armeabi-v7a`** (`armv7-linux-androideabi`): Legacy 32-bit ARM Android devices.
3. **`x86_64`** (`x86_64-linux-android`): Waydroid containers and desktop Android emulators.
4. **`.deb`** (`x86_64-unknown-linux-gnu`): Debian/Ubuntu Linux laptops and desktops.

### 7.2 Whisper Optimization (`-O3`)
* `whisper-rs-sys` compiles `whisper.cpp` using CMake in `Release` mode (`-O3 -DNDEBUG`).
* `scholiast_tauri/Cargo.toml` overrides `[profile.dev.package.whisper-rs]` and `[profile.dev.package.whisper-rs-sys]` with `opt-level = 3`.
* Hardware acceleration:
  * **ARMv8 (Pixel 6 Pro, Tab S7+)**: Mandatory ARM NEON SIMD vectorization and FP16 half-precision math.
  * **x86_64 (Laptops)**: High-throughput AVX, AVX2, FMA, and F16C vector extensions.

---

## 8. Phased Implementation Roadmap

### Phase 1: Navigation, Recents & Library Hub (COMPLETED ✅)
- [x] Un-nest settings cards to strictly max 2 layers (`PREFERENCES.md` Section 8).
- [x] Build Unified Library Hub (`/library`) with YouTube Channels & Websites.
- [x] Implement Chronological Recents on Home screen combining lectures and articles.
- [x] Auto-resolve YouTube channels via public oEmbed API (`channelStore.ts`).
- [x] Add minimal header CloudSyncIndicator.
- [x] Increase overview top padding and add sidebar brand header.
- [x] Verify on Waydroid display.

### Phase 2: Cloud Sync Modal & Auto-Backup Scheduler
- [x] Task 2.1: Build centered `CloudSyncModal.tsx` on clicking unconnected `[ ☁️ ]` with 1-tap OAuth and auto-sync toggles.
- [x] Task 2.2: Implement 5-minute periodic dirty sync check and study session exit auto-flush.

### Phase 3: Text Selection, Swatch & Gesture Disambiguation
- [ ] Task 3.1: Implement S-Pen stylus instant highlight vs. finger scroll gesture disambiguation.
- [x] Task 3.2: Build floating selection swatch with exact 3 extension colors (Yellow, Red, Green).
- [x] Task 3.3: Implement custom SVG action icons: Type Comment, Comment+Mic composite, and 3-Shape Diagram.

### Phase 4: Dynamic Aura Pill Voice Flow & VAD Zero-Confirmation
- [x] Task 4.1: Build `DynamicAuraPill.tsx` with Web Audio API 4-bar frequency visualizer.
- [x] Task 4.2: Wire 2.0-second silence VAD auto-stop and shimmering pulse processing animation.
- [x] Task 4.3: Implement zero-confirmation instant save to SQLite with subtle 2-second Undo toast.

### Phase 5: Mobile Zen Excalidraw (Fork & Prune `obsidian-excalidraw-plugin`)
- [ ] Task 5.1: Import `obsidian-excalidraw-plugin` codebase as canvas foundation.
- [ ] Task 5.2: Prune Obsidian-specific runtime wrappers (`import ... from "obsidian"`, Electron IPC, vault file tree).
- [ ] Task 5.3: Strip complex markdown note transclusion/block references to keep canvas lean and focused on visual diagrams, shapes, and formulas.
- [ ] Task 5.4: Rewire canvas persistence to Scholiast's SQLite & Google Drive diagram engine (`diagrams` store).
- [x] Task 5.5: Build dedicated `ExcalidrawSettingsSection.tsx` in Settings exposing stroke roughness, pen sensitivity, grid styles, and export scale.
- [ ] Task 5.6: Implement Mobile Zen Mode bottom thumb dock (`Box`, `Circle`, `Arrow`, `Pen`, `Text`, `Math/LaTeX`) and wire `[ ✓ Save ]` button.

### Phase 6: Reader Typography, Themes & Authentic Webview
- [x] Task 6.1: Implement Reader theme engine (OLED Pitch Black, Warm Sepia, Soft Slate, Clean Light).
- [ ] Task 6.2: Build Samsung Notes-style left-edge vertical dock for tablet and auto-collapsing mobile top bar.
- [ ] Task 6.3: Integrate Authentic Webview container with Dark Reader dynamic dark mode and Brave ad-blocking.

