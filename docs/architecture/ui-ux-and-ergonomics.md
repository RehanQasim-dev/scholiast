# UI/UX, Design Principles & Ergonomics Architecture

This document defines the core UX, design standards, and ergonomic gesture systems for Scholiast across mobile phones, tablets, desktop, and browser extensions.

---

## 1. General Design Principles (Universal Standards)

### 1.1 Space Efficiency & High Information Density
- **Zero Wasted Space**: Avoid bloated cards, giant empty boxes, and excessive padding.
- **Sleek, Compact Layouts**: Minimal, purposeful padding (`py-1.5` to `py-2`, `px-2.5` to `px-3`). Content feels tight, intentional, and clean.
- **Maximize Visible Content**: The viewport displays as many notes, transcripts, or list items as possible without requiring unnecessary scrolling.
- **Subtle Visual Boundaries**: Prefer hairline borders (`1px border-hairline`) or background elevation shifts over heavy shadows or nested boxes.

### 1.2 Iconography & Visual Restraint
- **No Functional Emojis**: Never use raw emojis (`📝`, `🎞`, `🖍`) as status indicators, type markers, or category badges. They render inconsistently across OSs and create visual clutter.
- **Understated Vector Icons**: Use geometric vector icons (Lucide / Material Symbols, line weight 1.5–2, size 16–20px) only where an icon clarifies meaning or saves space.
- **Typography Over Decoration**: Self-explanatory text (e.g. written notes) relies on clear typography and timestamps rather than decorative redundant icons.

### 1.3 Fast Actions & Friction Minimization
- **1-Tap Action Paths**: Note-taking, voice recording, and frame capture are reachable in 1 tap or 0 taps.
- **Zero Modal Disruption**: Routine editing happens inline or in lightweight bottom sheets, never full-screen modal takeovers.
- **Motion Restraint**: Frequent daily productivity transitions are instantaneous or subtle (`<150ms ease-out`). No slow bouncy animations.

### 1.4 Chat-Style Ergonomics
- **Bottom-Anchored Composers**: Input fields anchor to the foot of the relevant content pane (e.g., foot of the notes stream), not stretched across the screen.
- **Integrated Control Pills**: Media snapshot, voice dictation, and text entry coexist in a single sleek input pill.
- **Visual Proximity**: The composer sits directly adjacent to where the resulting note appears.

### 1.5 Anti-Nesting & Flat Hierarchy (Maximum 2 Layers)
- **No "Card Inception"**: Never nest cards inside cards inside cards.
- **Strict 2-Layer Hierarchy**:
  - **Layer 1**: Page/canvas background (`bg-base`).
  - **Layer 2**: Content card or list group (`bg-surface` or `bg-elevated`).

### 1.6 Complete Chrome Suppression & Immersion
- **No Third-Party Branding Leaks**: YouTube watermarks, channel logos, and player chrome are masked across all screen widths and aspect ratios.
- **No End-Screen / Recommendation Leaks**: Suggestion tiles, next-video cards, and pause-screen recommendation overlays are suppressed.

---

## 2. Platform Ergonomics & Screen Modes

### 2.1 Overview Screens vs. Study Sessions
- **Overview Screens (`/home`, `/settings`)**: Provide top status bar padding (`pt-7 sm:pt-9 px-6 pb-24`) to gracefully accommodate Android status bars, tablet bezels, and phone camera cutouts without visual collision.
- **Study Sessions (`/player`, `/reader`, `/frame`)**: Edge-to-edge immersion. Headers and tab bars auto-collapse on scroll down and slide back on tap or scroll up.

### 2.2 Form Factor Matrix
- **Mobile Phones (Portrait)**: One-handed ergonomics, bottom sheet interactions, and fast inline note capture without full-panel intrusion.
- **Tablets (Landscape 60/40 Split & S-Pen)**: Resizable persistent splitter for video and notes. Reader controls docked in an ergonomic vertical side rail. Direct S-Pen stylus highlighting.
- **Desktop (Windowed / Dual Pane)**: Keyboard navigation shortcuts, collapsible sidebar rail, hover states, and resizable dual-pane workspace.

---

## 3. Gestures & Interaction Engine

### 3.1 Pen vs. Touch Disambiguation (Zero Tool Toggling)
Eliminates the friction of manually switching between scroll and highlight modes:
1. **S-Pen / Stylus Hardware Mode (`pointerType === 'pen'`)**:
   - Touching the screen with an active stylus tip **immediately creates text highlights** across words with zero delay and zero long-press.
2. **Direct Touch / Finger Contact (`pointerType === 'touch'`)**:
   - Touching with fingers **always scrolls the page smoothly**.
3. **Touch Vector Disambiguation (Phones without Stylus)**:
   - **Vertical Vector ($> 40^\circ$ angle or $> 8\text{px}$ vertical movement within first 80ms)**: Locks to native page scroll.
   - **Horizontal Vector ($< 25^\circ$ angle along line of text)**: Engages text tracking and selection.

### 3.2 Floating Selection Swatch
Summoned immediately above the text selection on lift:
- **3 Color Swatches**: Yellow (`#d29600`), Red (`#dc3c5a`), Green (`#2da05f`).
- **Action Buttons**: Text Comment (`[💬]`), Voice Note (`[💬🎙️]`), Diagram / Canvas (`[📐]`).
- Clean, focused layout without tag pickers; tags live inside the comment composer.

### 3.3 Dynamic Aura Voice Flow
- Tapping `[💬🎙️]` smoothly morphs the floating pill into a 4-bar dynamic audio visualizer responding to live microphone amplitude via Web Audio API.
- Voice Activity Detection (VAD) detects 2.0s of silence to terminate recording automatically.
- Instant commit to SQLite upon completion with a 2-second non-blocking undo toast: `Saved: "[transcribed text]..." [ Undo ]`.

---

## 4. Cross-Reference to Feature Specs
For the concrete, testable Behavior Invariants and implementation tickets governing these systems:
- Lecture Player & Chrome: [`specs/tauri-lecture-player/`](../../specs/tauri-lecture-player/)
- Comment Composer & Rendering: [`specs/tauri-comment-system/`](../../specs/tauri-comment-system/)
- Reader Mode & S-Pen Engine: [`specs/tauri-reader-mode/`](../../specs/tauri-reader-mode/)
- Voice Notes & STT: [`specs/tauri-voice-notes/`](../../specs/tauri-voice-notes/)
- Frame Capture & Markup: [`specs/tauri-frame-markup/`](../../specs/tauri-frame-markup/)
- Android Adaptation: [`specs/tauri-android-adaptation/`](../../specs/tauri-android-adaptation/)
