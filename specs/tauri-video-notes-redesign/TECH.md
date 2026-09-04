# Technical Architecture: Surface-Adaptive Video Notes & Player

## 1. Architecture Overview

```mermaid
graph TD
    subgraph Desktop View
        PlayerRoute[src/routes/Player.tsx] --> DirectHost[PlayerHost.tsx videoId prop]
        DirectHost --> LoopbackServer[src-tauri/src/player_server.rs]
        PlayerRoute --> KeyboardRouter[Global Keyboard Dispatch: N, S, V, Space, T, Esc]
        PlayerRoute --> NotesPane[src/components/NotesTab.tsx]
        NotesPane --> InSituComposer[InSituCard: 100% width, 5-line auto-expand]
        InSituComposer --> DynamicSaveBtn[Inline Line 1 -> Shift below text on multi-line]
    end

    subgraph Mobile View (isNarrow)
        MobileLayout[Top 40% Video / Bottom 60% Notes]
        MobileLayout --> BottomActionBar[3-Action Bar: Voice STT, Frame, Type]
        BottomActionBar --> LiveAudioWave[Morphs to Audio Wave visualizer & Timer]
        LiveAudioWave --> STTConfirm[Review Card with 'Done' / 'Cancel']
    end

    subgraph Tablet View (isTablet)
        TabletLayout[Video Left / Notes Right]
        TabletLayout --> RightEdgeDock[src/components/player/TabletVideoDock.tsx]
        RightEdgeDock --> InDockMic[Audio Wave within rail icon]
        InDockMic --> RightPopover[Floating Right Popover with Edit & Save]
    end
```

---

## 2. Component Seams & Data Contracts

### 2.1 YouTube Player Integration
- **`PlayerHost.tsx`**:
  ```typescript
  interface PlayerHostProps {
    videoId?: string | null;
  }
  export default function PlayerHost({ videoId }: PlayerHostProps);
  ```
  - Initializes `ensurePlayer(videoId)` synchronously during component creation.
  - Constructs iframe URL: `${serverUrl}?v=${encodeURIComponent(videoId)}`.
  - In `player_server.rs`, `PLAYER_HTML` specifies `playerVars.autoplay = 0`.

### 2.2 In-Situ Note Composer (`InSituCard`)
- Rendered chronologically inside `NotesTab.tsx`:
  ```typescript
  interface ActiveComposerState {
    timestamp: number;
    draft: string;
    wasPlaying: boolean;
    capturedFrame?: CapturedFrameMeta | null;
  }
  ```
- **Line Count Detection & Dynamic Save Button**:
  - Ref to `textarea`.
  - Calculate `lineCount` via `Math.round(textarea.scrollHeight / lineHeight)`.
  - When `lineCount <= 1 && draft.length < 35`: Render Save button inline at the end of the text input.
  - When `lineCount > 1 || draft.length >= 35`: Render Save button below the textarea aligned right (`flex justify-end mt-1.5`).

### 2.3 Tablet Vertical Dock (`TabletVideoDock.tsx`)
- Fixed to right edge (`fixed top-0 right-0 bottom-0 w-12 z-30 flex flex-col items-center py-4 bg-surface/90 border-l border-hairline backdrop-blur`).
- State hooks:
  - `activeTab`: `'notes' | 'transcript' | null` (toggling null hides the panel for edge-to-edge video).
  - `recordingVoice`: boolean (switches mic icon into live audio pulsing bars).
  - `sttResult`: `{ text: string; timestamp: number } | null` (renders right-anchored floating modal).

---

## 3. Test Plan

1. **Unit Tests (`vitest`)**:
   - `PlayerHost.test.tsx`:
     - Test mounting with `videoId` prop immediately sets iframe `src` with `?v=...`.
     - Test that `autoplay: 0` is set in configuration.
   - `NotesTab.test.tsx`:
     - Test pressing `N` opens the in-situ composer card with captured timestamp.
     - Test typing text and pressing `Enter` inserts newline.
     - Test pressing `Shift+Enter` commits note to database and invokes resume if `wasPlaying === true`.
     - Test pressing `Esc` cancels draft and invokes resume if `wasPlaying === true`.
     - Test single-line note has save button inline; multi-line note shifts save button below.
2. **Integration Verification**:
   - Run in Tauri dev and compile `.deb` package to verify Error 5 is gone and note-taking flow is seamless.
