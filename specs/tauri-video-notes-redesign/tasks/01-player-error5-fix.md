# Task 01: YouTube Player Error 5 Mitigation & Prop-Based Mounting

## Goal
Eliminate YouTube Error 5 in WebKit2GTK on Linux by passing `videoId` directly as a React prop to `PlayerHost` and configuring `autoplay: 0` on initial player construction.

## Owned Files
- `scholiast_tauri/src-tauri/src/player_server.rs`
- `scholiast_tauri/src/player/PlayerHost.tsx`
- `scholiast_tauri/src/player/PlayerHost.test.tsx`
- `scholiast_tauri/src/routes/Player.tsx`

## Steps
1. In `scholiast_tauri/src-tauri/src/player_server.rs`, change `playerVars.autoplay` to `0`.
2. In `scholiast_tauri/src/player/PlayerHost.tsx`, accept `videoId?: string | null` in `PlayerHostProps`.
3. Pass `videoId` directly into `ensurePlayer(videoId)` so `iframe.src = ${serverUrl}?v=...` is generated on initial mount.
4. In `scholiast_tauri/src/routes/Player.tsx`, pass `videoId={videoId}` to `<PlayerHost videoId={videoId} />`.
5. Update unit tests in `PlayerHost.test.tsx` to verify prop propagation and `autoplay: 0`.
