# Task 36: Android E2E Verification (Waydroid)

Status: NOT STARTED
Wave: A (Android)
Depends on: tasks 33, 34, 35

## Scope & Owned Files
Full on-device (Waydroid) verification pass of the Android build:
- Scripted checklist executed via `adb`/`waydroid` + `am start` intents + `screencap` after each step, evidence in LOG.md:
  1. Cold boot → Home renders, DB created
  2. Paste/open a real YouTube URL → player loads → chrome visible → seek/play/pause via touch (adb input tap coordinates)
  3. Add timestamped note (typed) → appears in timeline → tap chip seeks → restart app → note persists
  4. Transcript tab: loads for a captioned video → live-follow active → select text → swatch → highlight → comment
  5. Voice: record via mic button → transcribe (cloud or local) → draft inserted → save
  6. Frame capture: attempt on-device (if task-34 spike succeeded) else document desktop-only
  7. Reader: add article → read → highlight → comment
  8. Settings: keys set, prompts visible, local model download (Wi-Fi), wipe guards
  9. Sync: connect Drive (real OAuth in custom tab), sync now, verify page JSON on Drive matches desktop layout
  10. Share-intent + deep-link entries
- Bug list fixed or filed as new task rows; final `pnpm tauri android build --debug` + desktop gates green
- Update ../tauri-tasks/README.md with Android verification summary

## Acceptance Criteria
- Checklist executed with screenshot evidence; all found bugs fixed or logged as follow-ups
- Desktop + Android suites green at close

## Notes
Waydroid tips: `waydroid app launch`, `adb shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "<url>" -n app.scholiast.app/.MainActivity`, `adb exec-out screencap -p > shot.png`.
