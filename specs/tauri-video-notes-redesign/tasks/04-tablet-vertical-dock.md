# Task 04: Tablet Right-Side Vertical Edge Dock & Popover [COMPLETED]

## Status: Completed & Verified
- `useIsTablet.ts` hook detects tablet touch screen viewports (768px-1280px with touch).
- `TabletVideoDock.tsx` implemented along the right edge (~48px) with Notes/Transcript toggles, `+` type note, frame capture, and voice note.
- Voice note displays animated audio wave bars inside the dock button during recording.
- Stopping voice note opens right-anchored floating popover with editable transcribed text, unfocused to prevent virtual keyboard pop-up.
- Notes and Transcript buttons toggle the respective split-panels.
- Verified with unit tests in `TabletVideoDock.test.tsx` and `useIsTablet.test.ts`.
Implement a right-side vertical edge dock for tablets (~48px wide) housing Notes/Transcript toggles, in-dock audio wave recording, and a floating edge popover for quick review and editing.

## Owned Files
- `scholiast_tauri/src/components/player/TabletVideoDock.tsx`
- `scholiast_tauri/src/routes/Player.tsx`
- `scholiast_tauri/src/hooks/useIsTablet.ts`

## Steps
1. Create `useIsTablet.ts` hook detecting tablet touch screens ($\ge 768\text{px}$ width with touch pointer).
2. Create `TabletVideoDock.tsx`:
   - Fixed along the right edge of the screen.
   - Buttons: `[📝 Notes]`, `[📜 Transcript]`, Divider, `[+ Type Note]`, `[📸 Frame Capture]`, `[🎙️ Voice Note]`.
   - When Voice Note is recording: mic icon inside the rail animates with pulsing audio wave bars.
   - When Voice Note stops: opens a floating glass popover anchored to the right rail showing editable transcribed text, Save, and Cancel.
   - Notes and Transcript buttons toggle the respective split-panels.
3. Integrate `TabletVideoDock` into `Player.tsx` conditionally when on tablet devices.
