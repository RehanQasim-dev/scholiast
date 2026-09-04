# Task 05: Mobile Reader Gesture Comments Sheet

## Objectives
1. In `Reader.tsx`, replace the static bottom comments sheet with a 3-state gesture bottom sheet (`closed`, `peek: 20vh`, `expanded: 70vh`).
2. Default state is `closed` (0% height, full screen for reading).
3. Swipe up from bottom edge opens `peek` (20% height).
4. Swipe up from top handle/edge of `peek` opens `expanded` (70% height).
5. Swipe down from top handle/edge dismisses to `closed`.
6. Double-tap/click on article content dismisses the sheet to `closed`.
7. Creating or tapping comments opens the sheet directly.

## Acceptance Invariants
- Invariants 11–16: 3-state sheet, gesture triggers, double-tap dismiss, and zero black bar by default.
