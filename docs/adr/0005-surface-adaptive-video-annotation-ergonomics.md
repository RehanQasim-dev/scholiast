# 0005. Surface-Adaptive Video Annotation Ergonomics

## Context
Previous iterations implemented a uniform "social media chat-style" bottom dock across all form factors. On desktop, this squished the text input horizontally by over 50% between a redundant timestamp button and four action icons (`[Camera]`, `[Keyboard]`, `[Mic]`, `[Send]`), making note-taking slow, mouse-bound, and cluttered. On mobile phones, virtual keyboards consumed more than half the screen, rendering typical split views claustrophobic.

## Decision
We replace the universal chat bar with a **surface-adaptive ergonomics architecture**:

1. **Desktop (Keyboard-First Flow)**:
   - Completely eliminate the persistent bottom chat bar and any status helper banners.
   - **`N` (New Note)**: Pauses playback, captures current timestamp, and materializes a 100% full-width in-situ card directly in the notes stream with autofocus.
   - **`Enter`**: Inserts newline; textarea auto-expands up to 5 lines, then scrolls.
   - **`Shift+Enter` / `Ctrl+Enter`**: Commits note to SQLite and automatically resumes video playback if it was playing before.
   - **Save Button**: Sits inline on the right for single-line notes; as text wraps or approaches it, it smoothly shifts below the text to the bottom-right corner.
   - **`Esc`**: Discards draft, removes ghost card, and resumes video playback if it was playing before.
   - **`Space`**: Toggles Play/Pause when not focused in an input.
   - **`S`**: Captures video frame snapshot and opens Excalidraw vector markup.
   - **`V`**: Activates Dynamic Aura Pill for fast voice note.
   - **`T`**: Switches between Notes and Transcript panels.
   - **Mouse Fallback**: A single discrete `+` button in the notes panel header next to the tab title.

2. **Mobile Phones (STT-First Flow)**:
   - In portrait, the top 40% hosts the 16:9 video player and the bottom 60% hosts the notes stream.
   - The foot of the screen provides a sleek 3-action bar: `[Voice Note (STT)]`, `[Frame Capture]`, `[Type Note]`.
   - **STT-First Voice**: Tapping Voice Note pauses playback, captures timestamp, and morphs the bar into a live audio wave recording state. Tapping Stop runs Whisper transcription, displays text in the card, and provides a "Done" button to commit.
   - **Type Note**: Opens the full-width composer inside the bottom 60% note pane with 5-line auto-expand before scrolling.

3. **Tablet (Hybrid Flow)**:
   - Landscape hosts a 60/40 split with the full desktop in-situ card workflow and keyboard shortcut parity.
   - Touch users can trigger actions via a minimalist Floating Action Button (FAB) in the bottom-right corner that unfolds into Note, Frame, and Voice options.

4. **Smart Playback State Memory (`wasPlaying`)**:
   - Committing (`Enter`) or discarding (`Esc`) notes only resumes playback if the video was actively playing prior to note initiation. If the user was already paused, playback remains paused.

5. **Loopback Player Direct Prop Injection**:
   - Video IDs are passed directly as React props to `PlayerHost` to eradicate the child/parent mount race condition, with initial `autoplay: 0` to prevent WebKit2GTK media gesture rejection (Error 5).

## Consequences
- Desktop note-taking becomes frictionless and keyboard-driven, matching the browser extension's speed.
- Mobile phones leverage voice dictation as the primary input mode without keyboard obstruction.
- Redundant buttons (`Keyboard` on desktop, persistent timestamp inside textareas) are eliminated.
