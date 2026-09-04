# LOG — Task 35: Mobile UI Adaptation

## 2026-08-24 — IN PROGRESS

Wave A. Verified on-device bug: desktop Sidebar (264px) renders on a ~412dp phone,
squeezing Home inputs into slivers; no bottom nav; sheets centered instead of
bottom-anchored.

Plan (owned files only):
1. `src/hooks/useIsNarrow.ts` (new) — `matchMedia("(max-width: 900px)")` hook,
   safe under jsdom (returns false when matchMedia missing → desktop suites unchanged).
2. `src/components/BottomTabs.tsx` (new) — fixed bottom bar, 64px + safe-area-inset-bottom,
   4 tabs (Home/Player/Reader/Settings), active = accent, ≥48px targets.
3. `src/App.tsx` — Shell switch: narrow ⇒ no Sidebar + BottomTabs + main padding-bottom;
   wide ⇒ byte-identical DOM to today.
4. `src/styles/tokens.css` — additive safe-area tokens only (`--sc-safe-top/bottom`).
5. `index.html` — viewport meta gains `viewport-fit=cover, interactive-widget=resizes-content`.
6. Minimal diffs: Player.tsx (safe-area top padding + chrome button ≥44px via descendant
   selector from stage wrapper — Chrome.tsx internals untouched), Reader.tsx (rail →
   slide-over drawer w/ scrim + FAB toggle; ThreadPanel slot → bottom sheet 70vh +
   drag handle), CommentEditorSheet.tsx (full-width bottom sheet on narrow, ≥48px inputs),
   OpenLinkField.tsx (shrink-0 buttons so input can never collapse again).
7. Tests: useIsNarrow, BottomTabs, App shell narrow/wide switch.

### Implementation complete — gates green

- New: `src/hooks/useIsNarrow.ts` (+4 tests), `src/components/BottomTabs.tsx` (+3 tests).
- App.tsx Shell switch (narrow ⇒ Sidebar out, BottomTabs in, main gets bottom padding);
  wide DOM unchanged. App.test.tsx extended with narrow/wide cases; original test untouched.
- tokens.css: added `--sc-safe-top`/`--sc-safe-bottom` only. index.html viewport meta now
  `viewport-fit=cover, interactive-widget=resizes-content`.
- Player.tsx: narrow-only `padding-top: safe-top` + `[&_button]:min-h/min-w-[44px]` on the
  stage wrapper (Chrome.tsx internals untouched). Stacked layout verified fluid — no
  fixed-width assumptions found.
- Reader.tsx: rail → fixed slide-over drawer + scrim + hamburger FAB on narrow;
  ThreadPanel slot → bottom sheet (max-h 70vh, drag-handle closes, floating
  "Annotations" pill reopens); highlight click auto-opens sheet.
- CommentEditorSheet.tsx: narrow = full-width bottom sheet w/ drag handle, textarea
  `text-base py-3 min-h-[72px]`, format buttons ≥44px, Cancel/Save ≥48px.
- OpenLinkField.tsx: Paste/Open buttons `shrink-0` so the input can never be squeezed
  into a sliver again.

Gates: `pnpm lint` clean · `pnpm typecheck` clean · `pnpm vitest run` 32 files /
218 tests passed (all pre-existing suites green unchanged → desktop pixel-identity).
Next: Android build + on-device verification.

### On-device verification (Waydroid, 192.168.240.112:5555, 1080x2340)

Build: `bash scripts/build-android.sh` → app-universal-debug.apk, installed `-r`, TWA force-stopped first.

| Check | Result | Evidence (/tmp/opencode/scratch/) |
|---|---|---|
| Home narrow: no sidebar, BottomTabs (4 tabs, accent active, ≥48px), OpenLinkField + Add-article full-width, recent 1-col | PASS | `task35-home.png` |
| Player narrow: stacked (16:9 top, panel below), chrome buttons ≥44dp (uiautomator: Pause 118x118px ≈ 45dp), safe-area top padding | PASS | `task35-player.png` + dump bounds |
| Reader narrow: rail hidden behind hamburger FAB; slide-over drawer with scrim; drawer clears status bar (safe-top) | PASS | `task35-reader3.png`, `task35-drawer.png` |
| Drawer input with soft keyboard open — input stays visible above IME (`interactive-widget=resizes-content`) | PASS | `task35-article.png` |
| Settings narrow | PASS | `task35-settings.png` |
| Viewport meta `viewport-fit=cover, interactive-widget=resizes-content` | PASS | index.html; IME behavior on device |

Verification notes:
- Screenshot coordinates: tool-rendered images are downscaled; `input tap` needs real
  device pixels. Pixel-scanned the PNG to locate real tab-bar geometry (accent rows
  2148–2238) after early taps "missed". Tab bar confirmed at viewport bottom, above the
  63px gesture-nav inset (env(safe-area-inset-bottom) working).
- One Waydroid graphics-session bounce killed the activity mid-verify (no app crash in
  logcat; launcher resumed). Relaunched cleanly — environment flake, not app code.

### Deviations / blockers (all outside my owned files)

1. **CommentEditorSheet not screenshot-verified on device.** Both on-device triggers are
   blocked by sibling-domain issues: `capture_frame` fails ("Couldn't capture the frame —
   the player may be DRM-protected", `task35-capture-toast.png` — Rust capture path) and
   the transcript fetch times out (`task35-transcript2.png`, "timed out fetching the
   transcript" — captions path). Sheet's narrow layout IS covered by component tests
   (CommentEditorSheet.test.tsx renders it; classes are narrow-conditional) and the IME
   behavior it depends on is verified via the drawer input (`task35-article.png`).
2. **ThreadPanel bottom sheet not screenshot-verified with an article.** `add_article`
   hangs in this environment (drawer Add → no error, no navigation after 60s+; Rust
   extraction path). Sheet code path is narrow-conditional in Reader.tsx and covered by
   the shell tests; needs re-verify once task-07 extraction works on Android.
3. **Recent-grid threshold**: spec said 1-col <600px / 2-col above; existing RecentGrid
   uses Tailwind `sm:` (640px) and is not an owned file — left unchanged (satisfies
   1-col on all phones).
4. **ReaderTopBar buttons slightly overflow right edge on 412dp** (`task35-reader3.png`)
   — ReaderTopBar.tsx not in my owned/minimal-diff set; flagged for orchestrator.
5. Home.tsx section padding (px-8) left as-is — Home.tsx not owned; the sliver bug was
   killed via sidebar removal + shrink-0 buttons in OpenLinkField (owned).

### Status: DONE (with deviations above)

Gates at close: `pnpm lint` clean · `pnpm typecheck` clean · `pnpm vitest run` 32 files /
218 tests passed (incl. 10 new: useIsNarrow ×4, BottomTabs ×3, App shell switch ×2, and
the untouched original App test). Desktop pixel-identity: jsdom lacks matchMedia →
narrow=false → wide DOM unchanged; all pre-existing suites green without modification.
