# Task 04 — Home screen

Status: DONE

## Objective
The app's landing screen: open a YouTube video by pasting a link (or sharing from another app), see recent videos, and see sync status.

## Scope — files you OWN (in `../android/app/src/main/java/com/scholiast/android/`)
- `ui/home/HomeScreen.kt` — the Compose screen
- `ui/home/HomeViewModel.kt` — state (recent pages, sync status, open-link input, errors)
- `ui/home/HomeViewModelTest.kt` — unit tests
- Share-intent handling: `MainActivity` intent plumbing (share → extract URL → open player) — coordinate: keep the *handler* in HomeViewModel, the *filter* is Task 01's manifest

## References (read first)
- `../scholiast_mobile_app_plan.md`: §5.1 (routes/entry points), §5.11 (settings window is separate — Home header has a settings gear), §6.3 Home design (grid, open-link field, sync status chip), §2 (Home = recent grid + open-link, confirmed)
- Types: `data/model/` + `data/db/` from Task 02 (use the `VideoItemRepository.listRecentPages()` interface — Task 02 provides it; if it's not built yet, code against the interface and note it)

## Requirements
- Top: **Open link** field (large, paste icon) — parses any YouTube URL form via Task 03's `extractVideoId`; invalid URL → dark toast "Not a YouTube link".
- Header row: app title, **sync status chip** (see Task 18 interface: `SyncStatusRepository` — stub the reading side with a plain state holder if absent), **settings gear** → `settings` route.
- Body: **Recent videos grid** (2 columns, adaptive): thumbnail (player thumbnail via Coil `https://img.youtube.com/vi/<id>/hqdefault.jpg`), title, note count, last-opened; tap → `player/{videoId}` route and resume position if stored.
- Share intent: `text/plain` → extract videoId → open player directly.
- Empty state: dark placeholder with instructions ("Paste a YouTube link, or share a video to Scholiast").
- Keyboard behavior: the Open-link field is the one place the OS keyboard opens on focus (Home is a typing surface) — do NOT add the keyboard-icon gate here.

## Acceptance criteria
- Paste URL → player opens with the right videoId (stub player navigation is fine).
- Share intent from another app lands on the player for a valid URL, and shows the toast for invalid text.
- Recent grid renders from the repository, newest first, with note counts.
- Unit tests: viewModel input validation, share-URL parsing, empty-state mapping.

## Agent notes
- The player route may be a stub until Task 05 lands — navigate to it anyway; log that the stub is expected.
- Coil is in the version catalog (Task 01) — if missing, add it there? NO — don't edit Task 01's files; note the missing dependency in LOG.md instead.
- Write your log to `LOG.md` as you work.