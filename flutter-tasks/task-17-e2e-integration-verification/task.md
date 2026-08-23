# Task 17: E2E Integration & Verification

Status: DONE
Wave: 5 (final)
Depends on: all tasks 01–16

## Scope & Owned Files
- `scholiast_flutter/lib/main.dart` — exclusive integrator: final route wiring + cross-task fixes
- `scholiast_flutter/test/ui/e2e_test.dart` — end-to-end flow tests (home→reader, player transcript, frame save→addFrameCapture, settings renders)

## Acceptance Criteria
- `flutter analyze` ~0 errors project-wide
- `flutter test` full suite passing (this task is the final verifier)
- E2E tests cover: home→reader navigation, player transcript render, frame save→addFrameCapture persistence, settings renders
- If toolchain allows: `flutter build linux --debug` result reported either way

## Agent Notes
- Only this task may edit `lib/main.dart`.
- Fix cross-task integration errors only (imports/types) — do not rewrite other agents' screens.
