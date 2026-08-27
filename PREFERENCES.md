# General Design Preferences & Principles

This document defines the core UX and design standards for this project. These principles are design-system agnostic and guide all current and future screens, interactions, and component implementations.

---

## 1. Space Efficiency & High Density
- **Zero wasted space**: Avoid bloated cards, giant empty boxes, and excessive padding (no `24px+` padding around single-line items).
- **Sleek, compact layouts**: Use minimal, purposeful padding (`py-1.5` to `py-2`, `px-2.5` to `px-3`). Content should feel tight, intentional, and clean.
- **Maximize visible information**: On both tablets and desktops, the viewport must show as many relevant notes, transcripts, or list items as possible without requiring unnecessary scrolling.
- **Subtle visual boundaries**: Prefer hairline borders (`1px border-hairline`) or slight background elevation shifts over bulky borders, heavy shadows, or nested boxes.

---

## 2. Iconography & Visual Restraint
- **No excessive or childish emojis**: Never use raw emojis (`📝`, `🎞`, `🖍`, etc.) as functional status indicators, type markers, or category badges. They look amateurish, render inconsistently across operating systems, and add visual noise.
- **Clean SVG icons only when necessary**: Use understated, geometric vector icons (e.g., Lucide / Material Symbols, line weight 1.5–2, sizing 16–20px) only where an icon clarifies meaning or saves space.
- **Typography over decoration**: If an item is self-explanatory text (like a written note), do not attach a redundant note icon to it. Rely on clear hierarchy and timestamps.

---

## 3. Fast Actions & Minimal Delay (Least Clicks / Lowest Friction)
- **Immediate action paths**: Common tasks (taking a note, recording voice, capturing a frame) must be reachable in 1 tap or zero taps.
- **Zero modal disruption**: Avoid opening heavy full-screen or modal dialogs for routine input. Creation and editing should happen inline or within natural bottom composers.
- **Motion restraint**: Never animate actions that occur dozens of times a day (typing, sending notes, quick edits). Transitions for daily actions must be instantaneous or subtle (`<150ms ease-out`). No slow bouncy springs for frequent productivity tasks.

---

## 4. Chat-Style Ergonomics (WhatsApp / Telegram / Instagram Paradigm)
- **Natural composer placement**: Input fields belong at the bottom of the relevant content pane (e.g., at the foot of the right-hand notes stream), not stretched awkwardly across the bottom of the entire screen.
- **Integrated controls**: Media attachment (camera / snapshot), voice dictation (mic), and text entry should coexist in a single sleek input pill or bar.
- **Visual proximity**: The creation bar must sit directly adjacent to where the resulting note appears, keeping hand movements and visual focus in the same zone.

---

## 5. Tablet & Touch-First Ergonomics
- **Opt-in software keyboard**: On tablet and touch devices, simply focusing an input field must **NOT** automatically summon the virtual keyboard and occlude half the screen.
- **STT/Voice first**: Dictation/speech-to-text is the primary fast input method.
- **Explicit keyboard toggle**: Provide a dedicated keyboard icon (`[⌨️]`) so the user can deliberately open the OS virtual keyboard when manual text typing or editing is specifically required.

---

## 6. Purposeful Navigation & Architectural Logic
- **Every screen and tab must have a reason to exist**: Do not provide a primary navigation tab that leads to an empty void or dead-end screen (e.g., a standalone "Player" tab when no video is loaded).
- **Viewers vs. Spaces**: Content viewers (Player, Reader) are destinations triggered by opening content from the library/home, not persistent top-level navigation tabs.
- **Zero dead ends**: If a user ever lands on a viewer without active content, it must provide immediate inline actions (recent history, paste link) rather than demanding navigation back to another screen.

---

## 7. Complete Chrome Suppression & Immersion
- **No third-party branding leaks**: YouTube watermarks, channel logos, and player chrome must be completely and reliably masked across all screen widths, DPRs, and aspect ratios.
- **No end-screen / recommended video leaks**: Third-party suggestion tiles, next-video cards, or pause-screen overlays must be suppressed or covered with a clean backdrop so the app remains an uninterrupted, focused study tool.

---

## 8. Anti-Nesting & Flat Hierarchy (Maximum 2 Layers of Cards)
- **No nested cards / "card inception"**: Never place a card inside another card inside another card (e.g. an outer section container box wrapping inner sub-cards that each wrap input boxes).
- **Maximum 2 layers of cards**:
  - **Layer 1**: Page / canvas background (`bg-base`).
  - **Layer 2**: The content card or list group (`bg-surface` or `bg-elevated`).
  - Inside a card or section, elements must be clean rows separated by hairline dividers (`border-b border-hairline`) or flat direct fields—never boxed into another layer of rounded bordered cards.
- **Flat section headers**: Section titles (e.g., `SPEECH`, `PROMPTS`, `APPEARANCE`) must be clean, standalone typographic headers sitting directly on the canvas above their grouped list or items, never enclosed inside giant parent framing boxes that wrap child cards.
