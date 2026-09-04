# Task 01: Settings Consolidation & Cleanup

## Objectives
1. Update API key Save buttons in `SpeechSection.tsx` to strictly use `.btn-emerald` / emerald tokens (`bg-accent text-[var(--sc-accent-text)]`).
2. Consolidate `DriveSection` and `SyncProgressCard` into a single, sleek, modern `DriveSyncCard` in `scholiast_tauri/src/components/DriveSyncCard.tsx` and integrate it into `Settings.tsx`.
3. Remove the "Default playback speed" option from `PlaybackSection.tsx`, retaining the seek step size setting.

## Acceptance Invariants
- Invariant 1: All API key save buttons use the unified emerald styling.
- Invariant 2: Drive sync is represented in one single card with top-right action button and real-time thin progress line.
- Invariant 3: Default playback speed dropdown is removed from Settings -> Playback.
