# Task 02: Android Share Target Intent Pipeline

## Objectives
1. Add `<intent-filter>` for `android.intent.action.SEND` with MIME type `text/plain` to `MainActivity` in `AndroidManifest.xml`.
2. Enhance `MainActivity.kt` `forwardShareIntent` to handle cold-start and warm-start URL sharing.
3. Verify that shared YouTube URLs open `/player` and shared web URLs open `/reader`.

## Acceptance Invariants
- Invariant 4: Scholiast is registered in Android's system share menu.
- Invariant 5: YouTube links route to Player; web articles route to Reader on share.
