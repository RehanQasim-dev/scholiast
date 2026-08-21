# LOG — task-21-player-experience-overhaul

## [2026-08-21 12:10] task-21 agent
- **What I learned:** Read all four owned files + theme. `AccentPurple` lives in PlayerChrome (spinner, slider thumb, active track, CC chip) and PlayerScreen (divider drag accent). `androidx.core:core-ktx` is an explicit dep in app/build.gradle.kts, so `WindowCompat`/`WindowInsetsControllerCompat` resolve. player.html's cleaner template is a JS template literal (no `$` hazards); PlayerWebView's `cssToInject` is a Kotlin raw string — my injected JS must avoid `$`/backticks entirely.
- **Decisions made:** The MutationObserver script will build its denylist rule from one JS selector array (single source inside the script) so the "re-add style if removed" path regenerates identical CSS without duplicating the stylesheet text. Extra justified selectors beyond the spec list: `.html5-endscreen`, `.ytp-flyout-cta`, `.ytp-suggested-action-badge`, `.ytp-youtube-button`, `.ytp-fullscreen-grid-percentage`.
- **Open questions:** none yet.
- **Progress:** Spec read; starting edits with PlayerChrome.kt.
## [2026-08-21 12:16] task-21 agent
- **What I learned:** (continuation session) PlayerChrome.kt was already complete from the earlier pass — verified: 0 AccentPurple, thumb 16dp, themed spinner/track/CC chip, widthIn time labels, Popup speed grid present.
- **Decisions made:** Immersive-bars DisposableEffect keys on `state.isFullscreen` only and resolves the controller via `activity?.window` + `LocalView`; onDispose always `show(...)` so navigating away can't strand hidden bars. Fullscreen landscape branch renders only PlayerStage(fillMaxSize); split Row kept byte-identical for the non-fullscreen case.
- **Open questions:** none.
- **Progress:** PlayerScreen.kt done — AccentPurple import removed, divider accent themed, §3.3 fullscreen collapse, §3.4 immersive bars, §3.5 chrome moved to pane level. Next: player.html + PlayerWebView.kt.
