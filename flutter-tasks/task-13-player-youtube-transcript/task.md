# Task 13 — Player + Transcript Surface

Status: DONE

## Objective
YouTube IFrame player (`assets/player.html`) adapted from native, `PlayerWebController` abstract + InAppWebView host + Fake, `TranscriptClient` Dart port, `PlayerScreen` + `PlayerChrome` overlay + `TranscriptPanel` (paragraph cards with [M:SS] pills, active cue karaoke, auto-scroll, selection → ColorSwatchRow popup) wired to `playerStateNotifierProvider.family`.

## Files Owned
- `lib/ui/screens/player/**`
- `lib/core/transcript/**`
- `assets/player.html`
- `test/ui/player_screen_test.dart`

## Verification
- `flutter analyze` — owned files: 0 errors, 0 warnings (3 infos: prefer_interpolation/prefer_initializing_formals — acceptable). Pre-existing errors in `lib/ui/screens/{reader,frame}/**` from parallel Wave-4 agents (not owned).
- `flutter test test/ui/player_screen_test.dart` — 5/5 passed (AppDatabase.inMemory + ProviderScope).

## Deviations
- Fixed `lib/features/player/player_state_notifier.dart:157` `entity?.videoItems` → `entity?.items` (getter is `VideoPageEntity.items`). File is read-only per ownership but bug blocked compilation — logged in LOG.md.

## References
- android/app/src/main/assets/player.html (571 lines)
- android/app/src/main/java/com/scholiast/android/{player/PlayerWebView.kt (488), player/PlayerBridge.kt, player/PlayerViewModel.kt, ui/player/PlayerScreen.kt (474), ui/player/PlayerChrome.kt (593), domain/transcript/TranscriptClient.kt (253), ui/transcript/TranscriptPanel.kt (703), ui/transcript/TranscriptViewModel.kt (371), ui/transcript/TranscriptSelectionOverlay.kt (172)}
- lib/features/player/player_state_notifier.dart (playerStateNotifierProvider family, PlayerState)
- lib/core/models/{video_item.dart, transcript_models.dart}
- lib/core/algorithms/transcript_chunker.dart
