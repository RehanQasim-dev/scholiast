# Task 03: Status Bar Insets & Safe Area Padding

## Objectives
1. In `MainActivity.kt`, apply an `OnApplyWindowInsetsListener` to `findViewById(android.R.id.content)` to set top padding equal to `statusBars.top`.
2. Ensure top navigation and options sit immediately below the status bar with zero overlap.

## Acceptance Invariants
- Invariant 6: Status bar does not overlap top bar buttons or text.
- Invariant 7: Padding matches exact system bar height with no wasted space.
