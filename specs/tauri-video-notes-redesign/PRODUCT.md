# Product Spec: Surface-Adaptive Video Notes & Player Architecture

## 1. Summary
A unified redesign of video playback and annotation ergonomics across Desktop, Tablet, and Mobile.
Eliminates YouTube WebKit Error 5, removes cluttered social-media chat bars, delivers a blisteringly fast extension-parity keyboard workflow on Desktop (`N`, `S`, `V`, `Space`, `Enter` newline, `Shift+Enter` save), an STT-first 3-button bottom bar on Mobile phones, and an ergonomic right-side vertical dock on Tablets with in-dock wave animation and floating transcription popover.

---

## 2. Target Personas & Form-Factor Invariants

### Invariant 1: Desktop Keyboard-First Flow
1. **Zero Bottom Bar**: On desktop, the persistent bottom dock with its 4 icons (`[Camera]`, `[Keyboard]`, `[Mic]`, `[Send]`) and timestamp pill is completely removed.
2. **Zero Status Helper Banners**: No banner strips (`Press N to add note...`) are rendered at the top of the notes pane.
3. **Discrete Mouse Fallback**: A minimal, elegant `+` button in the notes panel header next to the tab title allows mouse users to create notes at the current timestamp.
4. **`N` (New Note)**: Pauses playback, captures current timestamp and `wasPlaying` state, and materializes a 100% full-width in-situ card inside the chronological notes feed with instant autofocus.
5. **`Enter` Key**: Inserts a newline. The textarea auto-expands smoothly up to 5 lines, then becomes scrollable.
6. **`Shift+Enter` / `Ctrl+Enter` / `Cmd+Enter`**: Commits the note to SQLite and automatically resumes video playback if it was playing before.
7. **Dynamic Save Button**: Sits inline at the right end of the text on line 1 for short single-line notes; as text approaches it or wraps into multi-line, it smoothly shifts below the text to the bottom-right corner.
8. **`Esc` Key**: Discards the note, closes the composer, and automatically resumes video playback if it was playing before.
9. **`Space` Key**: Toggles video Play/Pause when the user is not actively typing in an input.
10. **`S` (Frame Capture)**: Snapshots the current video frame and launches Excalidraw vector markup.
11. **`V` (Voice Note)**: Opens the Dynamic Aura Voice note.
12. **`T` (Transcript)**: Toggles between Notes and Transcript panels.

### Invariant 2: Mobile Phone STT-First Flow
1. **Screen Layout (Portrait)**: The top 40% hosts the 16:9 video player; the bottom 60% hosts the scrollable notes feed.
2. **Bottom Action Bar**: A clean 3-button bar at the bottom:
   - `[🎙️ Voice Note (STT)]`: Prominent emerald action pill.
   - `[📸 Frame Capture]`: Minimalist camera action.
   - `[⌨️ Type Note]`: Minimalist keyboard action.
3. **Voice Note Flow**:
   - Tapping `[🎙️]` pauses video (capturing timestamp & `wasPlaying`) and morphs the bottom bar into a live audio wave recording state with timer and Stop button.
   - Tapping Stop triggers Whisper transcription, presents the transcribed note card preview with "Done" and "Cancel".
   - Tapping "Done" commits to SQLite and resumes playback if `wasPlaying === true`.
4. **Type Note Flow**:
   - Tapping `[⌨️]` pauses video and opens the in-situ card in the bottom 60% viewport with full width, auto-expanding up to 5 lines before scrolling.
   - Carries the dynamic Save button and a Cancel action.

### Invariant 3: Tablet Right-Side Vertical Dock Flow
1. **Vertical Edge Dock**: A slim (~48px) right-side rail docked to the right edge of the screen, naturally placed under the user's right thumb:
   - `[📝 Notes]` toggle button.
   - `[📜 Transcript]` toggle button.
   - Divider.
   - `[+ Type Note]` button.
   - `[📸 Frame Capture]` button.
   - `[🎙️ Voice / Mic Note]` button.
2. **In-Dock Wave Animation**: Tapping `[🎙️]` pauses video, captures timestamp, and animates audio wave bars directly inside the dock button.
3. **Right-Side Popover**: Tapping the mic button again stops recording, runs transcription, and displays a floating popover anchored to the right edge (overlapping the edge of the video/notes) with editable transcribed text, Save, and Cancel.
4. **Panel Toggling**: Tapping Notes or Transcript smoothly toggles the respective panels open or closed.

### Invariant 4: YouTube Embed Error 5 Mitigation
1. **Direct Prop Injection**: `<PlayerHost videoId={videoId} />` receives `videoId` as a direct React prop, constructing `http://127.0.0.1:<port>/player?v=...` on the initial render without relying on deferred `useEffect` hooks.
2. **Autoplay Policy Compliance**: `playerVars` initializes with `autoplay: 0`, preventing Linux WebKit2GTK unmuted media gesture rejection.
3. **User Gesture Activation**: Playback begins cleanly upon explicit user gesture (Play button, `Space`, or `commands.play()`).
