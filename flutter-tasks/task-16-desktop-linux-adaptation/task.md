# Task 16: Linux Desktop Adaptation

Status: DONE
Wave: 5
Depends on: task-12-reader-webview-surface, task-13-player-youtube-transcript, task-14-frame-markup-canvas, task-15-home-settings-screens

## Scope & Owned Files
- `scholiast_flutter/lib/ui/layout/**` — responsive breakpoints, desktop scaffold, sidebar, wide-layout helpers, keyboard shortcuts
- `scholiast_flutter/lib/ui/screens/desktop/**` — desktop shell + route wiring (go_router)
- `scholiast_flutter/lib/core/platform/**` — Linux window manager hooks / window config
- `scholiast_flutter/test/ui/desktop_layout_test.dart` — widget tests for breakpoints, sidebar nav, shortcuts (no real window manager)

## Acceptance Criteria
- `flutter analyze` 0 errors on owned files
- `flutter test test/ui/desktop_layout_test.dart` passing (breakpoints, sidebar, shortcuts)
- Router wiring documented (main.dart still default template — do NOT edit)
