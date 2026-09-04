# Task 04: Suppress Native WebView Action Mode & Add In-Popup Copy

## Objectives
1. In `MainActivity.kt`, override `onWindowStartingActionMode` to return `null`, preventing the OS floating text selection menu from obscuring web content.
2. In `SwatchPopup.tsx`, add a clean "Copy" action to allow fast text copying to the clipboard.

## Acceptance Invariants
- Invariant 8: Native Android copy/share toolbar is suppressed.
- Invariant 9: `SwatchPopup` is completely visible and unobstructed.
- Invariant 10: In-popup Copy button copies selected text to clipboard.
