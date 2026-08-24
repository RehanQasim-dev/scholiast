# Task 35: Mobile UI Adaptation

Status: NOT STARTED
Wave: A (Android)
Depends on: task-33

## Scope & Owned Files
Adapt the desktop shell for phone/tablet touch:
- **Navigation**: bottom tab bar (Home / Player / Reader / Settings) on narrow viewports (<900px), sidebar stays for desktop — implement `AppShell` responsive switch in `src/App.tsx` + `src/components/BottomTabs.tsx` (new). Touch targets ≥48px.
- **Safe areas**: env(safe-area-inset-*) padding for status/nav bars (tokens.css additions).
- **Player screen**: portrait = stacked (player top 16:9, panel below) — already exists from task-05; verify + fix touch scrolling inside transcript/notes panels; chrome buttons sized for thumb.
- **Reader**: rail collapses to a slide-over drawer on narrow; thread panel becomes bottom sheet on narrow.
- **Sheets/dialogs**: CommentEditorSheet already modal — full-width bottom sheet on narrow.
- **Viewport/keyboard**: `interactive-widget=resizes-content` viewport meta; test comment editor with soft keyboard in Waydroid.
- No desktop regressions: sidebar layout untouched ≥900px.

## Acceptance Criteria
- Component tests for the responsive switch; existing suites green
- Waydroid walkthrough screenshots in LOG: Home, Player (portrait), Reader drawer, Settings, comment editor with keyboard open

## Notes
This is CSS/layout work — no Rust. Keep the desktop pixel-identical.
