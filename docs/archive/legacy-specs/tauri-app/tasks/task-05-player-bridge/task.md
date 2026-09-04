# Task 05: Player Bridge & Chrome

Status: DONE
Wave: 1
Depends on: task-01

## Scope & Owned Files
- `scholiast_tauri/src/player/PlayerHost.tsx` — mounts the YouTube IFrame-API player once per session; loads `https://www.youtube.com/iframe_api`; exposes the canonical contract:
  - Events out: `onPlayerReady, onStateChange, onError, onTimeUpdate(250ms poll), onDuration, onTitle, onCaptionsAvailable`
  - Commands in: `loadVideo, seekTo, play, pause, setRate, setVolume, setCaptions`
- `src/player/playerBridge.ts` — typed singleton bridge (event emitter + command fns); time lives in a ref-store with subscribe API, NOT global state (plan §3.3)
- `src/player/Chrome.tsx` — overlay chrome: tap-toggle, center play/pause, seek bar w/ −15s/+15s, time display, speed menu (0.25–2×), volume, fullscreen toggle, slot for Capture/＋note buttons (wired by later tasks)
- `src/routes/Player.tsx` shell — landscape split (player fills left, right panel slot 38%/min360px) + narrow stacked layout; reads `resume_at` and seeks once ready; persists position (debounced) via task-02 command
- Embedding-disabled / error states per plan §6.2

## Acceptance Criteria
- Vitest: bridge unit tests with a mocked YT.Player (event fan-out, command calls, 250ms poll timing via fake timers)
- Component test: Chrome renders controls, seek interactions dispatch correct commands
- Manual smoke logged: real video plays muted-autoplay-free with chrome visible

## Notes
Contract names are frozen — transcript/notes/frame tasks code against this file.
