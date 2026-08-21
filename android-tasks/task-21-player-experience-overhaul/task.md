# Task 21 — Player experience overhaul

**Status:** IN PROGRESS
**Owner:** this task only. Do NOT edit any file not listed under "Files you own".
**Depends on:** nothing blocking. Other tasks (21/22) run in PARALLEL — stay in your lane.

---

## 1. Context

Scholiast Android (`android/`) is a Kotlin + Jetpack Compose tablet app for YouTube
lecture annotation. Read `android/AGENTS.md` (operating manual) before starting.
The user reviewed screenshots of the player and demanded fixes. Decisions below are
FINAL — agreed with the user; do not relitigate them.

### Theme rule (critical, repo-wide)

The app theme uses `dynamicDarkColorScheme` on Android 12+ (`ui/theme/Theme.kt`), so
`MaterialTheme.colorScheme.primary` follows the device wallpaper (teal on the user's
tablet). A refactor is underway to kill every hardcoded accent:

- **NEVER write `AccentPurple` (or any hardcoded accent) in UI code.** Use
  `MaterialTheme.colorScheme.primary` (and `.copy(alpha = …)` where needed;
  `colorScheme.onPrimary` for content on filled accents).
- The fixed highlight colors (`HighlightYellow/Red/Green`) are semantic and stay
  hardcoded everywhere.
- Most other files are already migrated; yours still contain `AccentPurple` — remove
  those usages as specified below.

### Work already done by the orchestrator (do not redo, do not touch)

Theme swaps landed in: HomeScreen, SyncStatusBar, NoteItemCard, FrameDrawScreen,
TranscriptPanel, EditorField, CommentRenderer, CommentEditorSheet. NotesTab was
restructured (header removed, Extended FAB added) and CommentEditorSheet was rewritten
from a modal bottom sheet into a docked card. None of that is your concern except as
context.

---

## 2. Files you own

| File | Role |
|------|------|
| `android/app/src/main/java/com/scholiast/android/ui/player/PlayerChrome.kt` | Compose overlay chrome (play/pause, seek bar, CC, speed, fullscreen) |
| `android/app/src/main/java/com/scholiast/android/ui/player/PlayerScreen.kt` | Screen shell: split pane, PlayerStage (WebView + chrome), fullscreen toggle |
| `android/app/src/main/assets/player.html` | The page loaded in the WebView; hosts the YT IFrame API + CSS cleaner |
| `android/app/src/main/java/com/scholiast/android/player/PlayerWebView.kt` | WebView host; intercepts the YouTube embed response and injects a cleaner `<style>` |

Everything else is off-limits. If you find a gap in another file, note it in your
LOG.md instead of editing.

---

## 3. What to build (exact spec)

### 3.1 PlayerChrome.kt — colors + polish

1. Replace every `AccentPurple` usage with `MaterialTheme.colorScheme.primary`:
   - loading spinner color (~line 122),
   - slider thumb background (~line 317),
   - slider active track color (~line 324),
   - CC chip enabled fill (~line 391).
   Delete the `AccentPurple` import.
2. Seek thumb: `12.dp` → **16.dp** (it's nearly invisible while dragging today).
3. Time labels: the current/total time `Text`s use a fixed `Modifier.width(48.dp)`
   which clips `H:MM:SS`. Replace both with `Modifier.widthIn(min = 48.dp, max = 80.dp)`
   (import `androidx.compose.foundation.layout.widthIn`). Keep tabular figures.

### 3.2 PlayerChrome.kt — speed picker → compact grid popup

Replace the `SpeedMenu` DropdownMenu (currently a huge stock menu floating over the
video) with a custom compact popup:

- Keep the existing trigger IconButton showing `formatRate(current)` (e.g. "1.25×").
- On tap open an `androidx.compose.ui.window.Popup` anchored **above** the button
  (`alignment = Alignment.TopEnd` relative to the small Box wrapping the button works —
  the popup's bottom edge lands at the button's top). `properties = PopupProperties(focusable = true)`
  so outside taps fire `onDismissRequest`.
- Content: a `Surface`, shape `RoundedCornerShape(14.dp)`, color `SurfaceElevated`
  (already imported from theme), border `1.dp Color.White.copy(alpha = 0.10f)`,
  shadowElevation ~8dp, inner padding 8dp.
- Lay the six `SPEED_OPTIONS` out as a **3×2 grid**: `SPEED_OPTIONS.chunked(3)` rows,
  each row a `Row` with 6dp spacing. Each chip: `Surface(onClick = …)`,
  size `64.dp × 40.dp`, shape `RoundedCornerShape(10.dp)`; selected rate filled with
  `MaterialTheme.colorScheme.primary` + `colorScheme.onPrimary` content + bold label;
  unselected chips `Color.White.copy(alpha = 0.08f)` fill with white label.
- Selecting calls `onSelect(rate)`, closes the popup, fires `onInteraction()`.

### 3.3 PlayerScreen.kt — real fullscreen

Today `toggleFullscreen()` only flips orientation; the layout never reads
`state.isFullscreen`, so "fullscreen" keeps the split pane. Fix:

- In the landscape branch, when `state.isFullscreen == true` render ONLY the
  `PlayerStage` filling the screen (`fillMaxSize()`) — no SplitPaneDivider, no panel.
  When false, keep the existing split layout exactly as-is.
- Portrait branch unchanged (fullscreen forces sensor-landscape anyway).

### 3.4 PlayerScreen.kt — immersive system bars (fullscreen only)

User decision: system bars hide **only in fullscreen**, swipe reveals temporarily.

- In `PlayerScreen`, get the window from the host Activity (`LocalContext.current as?
  Activity` → `window`) or `LocalView.current` + `WindowCompat.getInsetsController`.
- `DisposableEffect(state.isFullscreen)`: when true →
  `insetsController.systemBarsBehavior = BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE` and
  `hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())`;
  when false → `show(...)`. Use `androidx.core.view.WindowCompat` /
  `WindowInsetsControllerCompat` (androidx.core) so it works pre-30. Check
  `android/app/build.gradle.kts` deps — androidx.core is transitively present via
  activity-compose; if an explicit import doesn't resolve, note it in LOG.md.
- On dispose, always `show(...)` so leaving the screen never strands hidden bars.

### 3.5 PlayerScreen.kt — anchor chrome to the pane, not the video box

In `PlayerStage`, `PlayerChrome` currently sits inside the letterboxed 16:9 Box, so
with heavy letterboxing the back/title/controls float mid-screen. Move `PlayerChrome`
OUT one level so it fills the entire `BoxWithConstraints` pane (title/back at pane
top-left, controls at pane bottom-center); the WebView stays letterboxed beneath it.
Keep the tap-to-toggle behavior working over the whole pane. Mind that the chrome's
gradient background will now span the pane — that's intended.

While there: swap the divider drag-accent `AccentPurple` (~line 268) to
`MaterialTheme.colorScheme.primary` and drop the import.

### 3.6 player.html + PlayerWebView.kt — raise captions above our controls

YouTube paints captions at the iframe bottom; our bottom control row overlaps them.
Add to **BOTH** cleaner style blocks (the `injectIframeStyles` template in
`player.html` AND the `cssToInject` string in `PlayerWebView.shouldInterceptRequest`):

```css
.ytp-caption-window-container { transform: translateY(-56px) !important; }
```

(transform composes with YouTube's inline positioning, so it wins without fighting
inline styles.)

### 3.7 player.html + PlayerWebView.kt — permanent YouTube-chrome suppression

The user sees YouTube's own UI leak through in several states: paused title card +
channel avatar + share button, related-video thumbnails over captions, seek-hover
tooltip, autoplay/"next" wall, center play/pause bezel flash. Root causes: the
selector denylist is missing newer classes, and the outer-page 300ms polling injector
loses races against YouTube's dynamic DOM.

Do ALL of:

1. **Expand the denylist in BOTH style blocks** (keep every existing selector, add):
   `.ytp-tooltip`, `.ytp-videowall`, `.ytp-autonav-endscreen-upnext-container`,
   `.ytp-bezel`, `.ytp-bezel-text-wrapper`, `.ytp-fullscreen-grid`,
   `.ytp-featured-product`, `.ytp-merch-shelf`, `.ytp-popup`, `.ytp-menu-container`,
   `.ytp-skip-intro-button`, `.ytp-cards-button`, `.ytp-multicam-button`,
   `.ytp-remote-button`, `.ytp-size-button`, `.ytp-subtitles-button` (we render our own
   CC chip), `.ytp-player-content` — plus anything else you can justify from the
   YouTube embedded player DOM. All with the same
   `display:none !important; opacity:0 !important; visibility:hidden !important;
   pointer-events:none !important;` treatment.
2. **Inject a MutationObserver script into the intercepted embed document**
   (`PlayerWebView.shouldInterceptRequest` already rewrites the HTML head — append a
   `<script>` right after the injected `<style>`, so it runs before YouTube's player
   boots): the script keeps a JS array of the same selectors, defines a `sweep()` that
   hides matching nodes (set `style.display='none'` and a data flag so it's idempotent),
   installs a `MutationObserver` on `document.documentElement` (childList+subtree) that
   runs `sweep()` on mutations, plus a `setInterval(sweep, 500)` backstop, and re-adds
   its `<style id="scholiast-cleaner">` if YouTube removes it. Wrap everything in
   try/catch; it must never throw into YouTube's page.
3. **Keep the existing fallbacks**: the outer-page `setInterval(injectIframeStyles,
   300)` poll in player.html stays as-is (also add the new selectors to its template),
   and the interceptor keeps serving modified HTML.

### 3.8 Sanity checks for your own edits

- No `AccentPurple` remains in your four files (`grep -n AccentPurple <files>`).
- Every interactive target stays ≥44–48dp.
- Match the surrounding code's comment density and idioms — this codebase documents
  its "why"s; keep that up for new logic, don't reflow unrelated code.

---

## 4. Build & verify (compile only)

From `android/`:

```bash
./gradlew :app:compileDevDebugKotlin --console=plain
```

- This may take several minutes on first run (native whisper build hooks into preBuild);
  use a generous timeout (≥600s).
- Another agent may be building concurrently — Gradle queues on project locks; if it
  waits, retry once.
- Do NOT run `assembleDevDebug`, tests, or install to Waydroid — the orchestrator does
  that after both tasks land.
- JS/CSS changes aren't compile-checked: reread your injected strings carefully
  (balanced braces, escaped `$` in Kotlin raw strings — use `$` escapes or avoid
  template interpolation pitfalls).

## 5. Logging protocol (REQUIRED)

Append dated entries to `LOG.md` (this folder) WHILE working, format:

```
## [YYYY-MM-DD HH:MM] task-21 agent
- **What I learned:** …
- **Decisions made:** …
- **Open questions:** …
- **Progress:** …
```

Append-only. Finish with a final summary entry.
