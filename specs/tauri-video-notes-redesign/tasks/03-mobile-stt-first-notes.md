# Task 03: Mobile Phone STT-First Bottom Bar & Note Flow [COMPLETED]

## Status: Completed & Verified
- Clean 3-action bottom bar (`[Voice Note]`, `[Frame Capture]`, `[Type Note]`) implemented for mobile phones in portrait.
- Tapping Voice Note morphs bar into live `AudioWave` animated visualizer with timer and Stop/Cancel buttons.
- Stopping recording performs STT transcription and renders preview card with Save/Cancel.
- Textarea is NOT focused automatically so virtual keyboard does not open right away.
- Tapping Save commits to SQLite and resumes playback if `wasPlaying === true`.
- Type note flow opens full-width in-situ card with 5-line auto-expand.
Implement a clean 3-button bottom bar on mobile phones in portrait mode with primary STT-first voice recording, live audio wave animation, and 5-line auto-expanding typed notes.

## Owned Files
- `scholiast_tauri/src/components/NotesTab.tsx`
- `scholiast_tauri/src/voice/useVoiceComment.ts`

## Steps
1. In `NotesTab.tsx`, when `isNarrow` is active:
   - Render a compact 3-action bar at the bottom:
     - `[🎙️ Voice Note]` (prominent emerald pill).
     - `[📸 Frame Capture]`.
     - `[⌨️ Type Note]`.
2. STT-First Recording:
   - Tapping `[🎙️]` pauses video (storing `wasPlaying`) and transforms the bottom bar into the live audio wave visualizer with timer and Stop button.
   - Tapping Stop triggers Whisper transcription, presents the editable note card preview with "Done" and "Cancel".
   - Tapping "Done" commits to SQLite and resumes playback if `wasPlaying === true`.
3. Type Note Flow:
   - Tapping `[⌨️]` pauses video and opens the in-situ composer card in the lower 60% note pane with full width and 5-line auto-expand before scrolling.
