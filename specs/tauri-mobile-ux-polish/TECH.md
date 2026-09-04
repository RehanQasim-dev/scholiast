# TECH.md — Mobile UX Hardening & Feature Polish Technical Spec

## Architecture & Seams

### 1. Settings Consolidation & Cleanup
- **`SpeechSection.tsx`**: Update the Save buttons in `KeyRow` to use `.btn-emerald` / `h-11 rounded-lg bg-accent px-4 text-sm font-medium text-[var(--sc-accent-text)]`, matching global button styling.
- **`DriveSyncCard.tsx`**: Consolidate `DriveSection` and `SyncProgressCard` into a single, cohesive component.
  - State: Combines `useQuery(["drive", "status"])` with `useSyncStatus()`.
  - Header: Drive brand icon, connection status indicator (`Connected • Synced` or `Not Connected`), and a top-right action button ("Authorize" / "Disconnect").
  - Content: Sync status line, relative timestamp ("last synced X min ago"), and when active: a thin `h-1.5` rounded emerald progress bar with `(done/total)` count and truncated `status.url ?? status.title` below.
  - Action: Clean "Sync Now" button powered by `sync_now` IPC command.
- **`PlaybackSection.tsx`**: Drop `PREF_KEYS.defaultSpeed` input row; retain seek step size selection.

### 2. Android Share Target Intent Pipeline
- **`AndroidManifest.xml`**:
  Add an `ACTION_SEND` intent filter to `MainActivity`:
  ```xml
  <intent-filter>
      <action android:name="android.intent.action.SEND" />
      <category android:name="android.intent.category.DEFAULT" />
      <data android:mimeType="text/plain" />
  </intent-filter>
  ```
- **`MainActivity.kt`**:
  - In `forwardShareIntent(incoming: Intent?)`:
    Extract URL from `Intent.EXTRA_TEXT`, format as `scholiast://share?url=${Uri.encode(url)}`.
    Set `intent = view` on cold start and call `startActivity(view)` so deep link plugin delivers the payload to `useDeepLinks()`.
  - In `deepLink.ts`:
    `routeForSharedText` parses `scholiast://share?url=...`. If it's a YouTube URL, routes to `/player?url=...`. Otherwise routes to `/reader?url=...`.

### 3. Status Bar Insets & Safe Area
- **`MainActivity.kt`**:
  Apply window insets listener to `android.R.id.content`:
  ```kotlin
  ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content)) { v, insets ->
      val statusBars = insets.getInsets(WindowInsetsCompat.Type.statusBars())
      v.setPadding(0, statusBars.top, 0, 0)
      insets
  }
  ```
  Guarantees the WebView begins immediately below the status bar on any Android device without obscuring top controls or wasting space.

### 4. Suppression of Native Action Mode
- **`MainActivity.kt`**:
  Override `onWindowStartingActionMode` in `MainActivity`:
  ```kotlin
  override fun onWindowStartingActionMode(callback: ActionMode.Callback?): ActionMode? = null
  override fun onWindowStartingActionMode(callback: ActionMode.Callback?, type: Int): ActionMode? = null
  ```
  Prevents Android OS from inflating the floating native `Copy | Share | Select all` menu, allowing `SwatchPopup` to be displayed unobstructed.
- **`SwatchPopup.tsx`**:
  Add a compact "Copy" action to the swatch popup that copies the selected range text to the system clipboard via `navigator.clipboard.writeText`, providing a frictionless copy experience without OS occlusion.

### 5. Reader Mobile Gesture Comments Sheet
- **`Reader.tsx`**:
  - Replace static `threadSheetOpen` boolean with 3 discrete states:
    ```typescript
    type SheetState = "closed" | "peek" | "expanded";
    ```
    - `"closed"`: Height `0vh`, completely offscreen / unrendered.
    - `"peek"`: Height `20vh`, compact preview above safe bottom.
    - `"expanded"`: Height `70vh`, full reading/reply surface.
  - Touch gesture handlers:
    - `onTouchStart` / `onTouchMove` / `onTouchEnd` on the bottom screen edge (`clientY > window.innerHeight - 50`) triggers transition from `"closed"` to `"peek"`.
    - Handle drag on sheet top edge / grab bar:
      - Dragging up ($\Delta y < -30$) transitions `"peek"` $\to$ `"expanded"`.
      - Dragging down ($\Delta y > 30$) transitions to `"closed"`.
    - Double-tap detection on article container transitions sheet to `"closed"`.
    - Highlighting or tapping a comment opens the sheet to `"peek"` (or `"expanded"` if composing).

---

## Test Plan
- Unit tests:
  - Settings: Verify `DriveSyncCard` renders unified status, handles connect/disconnect, and displays progress during active sync.
  - Playback: Verify `PlaybackSection` only exposes seek step size.
  - DeepLink: Verify `routeForSharedText` correctly routes YouTube URLs to `/player` and web URLs to `/reader`.
  - SwatchPopup: Verify Copy button copies text to clipboard.
  - Reader: Verify sheet states (`closed`, `peek`, `expanded`) and double-tap dismiss behavior.
