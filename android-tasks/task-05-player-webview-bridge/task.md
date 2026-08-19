# Task 05 — Player WebView + JS bridge + chrome

Status: DONE

## Objective
The YouTube player: a WebView hosting the IFrame API, with a Kotlin↔JS bridge for control/capture, and the Compose player chrome (play/pause, seek bar, time, −15s/+15s, speed menu, fullscreen).

## Scope — files you OWN (in `../android/app/src/main/java/com/scholiast/android/`)
- `player/PlayerWebView.kt` — WebView host, `JavascriptInterface`, `evaluateJavascript` wrapper, lifecycle
- `player/PlayerBridge.kt` — the bridge interface (events in, commands out)
- `player/assets/player.html` — the IFrame API page (bundled asset)
- `player/PlayerViewModel.kt` — playback state (`videoState`: playing, time, duration, title, rate, captionsAvailable), frame-capture flow state
- `ui/player/PlayerChrome.kt` — the Compose overlay controls
- `ui/player/PlayerScreen.kt` — the screen shell (player + panel slot that Tasks 06/13 fill; landscape/portrait layouts)

## References (read first)
- `../scholiast_mobile_app_plan.md`: §3.4 (bridge contract — implement the exact messages), §5.2 (loading a video), §5.3 (layout + chrome: −15/+15 + speed menu confirmed), §6.3 Player design, §9 M1
- Desktop reference: `../src/utils/video/video-player-stage.ts` (behavior only — the CSS-transform approach is replaced by WebView+Compose)

## Requirements
- `player.html`: loads IFrame API (`https://www.youtube.com/iframe_api`), creates `YT.Player` with `origin` = the app's scheme/host, exposes `onReady/onStateChange/onError/onTimeUpdate(250ms)/onDuration/onTitle/onCaptionsAvailable/onCaptureResult` via a Kotlin-bridge object; accepts `loadVideo`, `seekTo`, `play`, `pause`, `setRate`, `setVolume`, `captureFrame`.
- `captureFrame()`: pause video (JS), `canvas.drawImage(video)` → `toDataURL('image/jpeg', 0.8)` → bridge; detect black/tainted canvas (all-black pixels or error) → error message for Task 14.
- Chrome (Compose overlay): tap video toggles chrome; centered play/pause; bottom seek bar with current/total time; **−15s / +15s** buttons; speed menu (0.75×/1×/1.25×/1.5×/2×); fullscreen toggle (orientation request). Everything ≥48dp.
- Landscape: player left (fills), panel slot right (fixed share, min 320dp). Portrait: player top 16:9, panel slot below. Panel slot = composable parameter (stub it; Tasks 06/13 fill it).
- Embedding disabled → onError → message "Video can't be played in this app" + open-in-YouTube button (still allow transcript later).
- Keep the player alive across videos: one WebView instance, `loadVideo` swaps.

## Acceptance criteria
- Play/pause/seek/rate work through the bridge; time updates flow to Compose state.
- captureFrame returns a JPEG data URL for a normal video and an error for a DRM/embed-blocked one (test with an embeddable video like a standard lecture).
- Landscape/portrait layouts render with the stub panel.
- Unit tests: `PlayerViewModel` state transitions (playing/paused/capturing/error) with a fake bridge.

## Agent notes
- `android:hardwareAccelerated="true"` is needed for canvas capture (manifest is Task 01's — if it's missing, log it and add it to your own module manifest if separate).
- You own `PlayerScreen`'s layout container but NOT the panel contents — expose a `@Composable panelSlot: @Composable () -> Unit` parameter.
- Write your log to `LOG.md` as you work.