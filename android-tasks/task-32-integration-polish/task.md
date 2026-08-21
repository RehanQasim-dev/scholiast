# Task 32 — Integration, motion pass, deep links, final verification

Status: DONE

## Objective
Mount everything into the Reader and make it feel like one feature: wire ThreadSheet +
HighlightActions + VoiceBubble into ReaderScreen, deep links (`#sc-hl=`), WebView read-only
fallback polish, coach-mark, a11y sweep, the §6.5 motion-spec audit, then full build + Waydroid
install + cross-surface verification checklist.

Plan: `../scholiast_web_annot_app_plan.md` §5.8–5.9, §6.4–6.5, §9 R5/R6, §10.

## Scope — files you OWN (in `../android/`)
- `ui/reader/ReaderScreen.kt` / `NativeReader.kt` — FINAL integration edits:
  mount Task 29's SelectionTracker+SwatchPill+Painter in the `/* ANNOTATION-SLOT */` region;
  mount Task 31's ThreadSheet in `/* SHEET-SLOT */` (highlight/badge tap → open thread at that
  group; actions → HighlightActionsController → repository → sync enqueue); Task 30's voice
  events already wired — verify and fill gaps.
- `ui/reader/DeepLink.kt` — parse `#sc-hl=<id>` from incoming urls (share/open-link): after
  render, resolve hint→else anchor, scroll block −⅓ viewport, emphasis flash 2.6s (single soft
  pulse), matching desktop reveal semantics.
- `ui/reader/WebViewFallback.kt` — finish the read-only fallback: Chrome UA spoof, progress,
  error state; toast "Original view — annotation coming here later" (annotation bundle is a
  documented v1.1 follow-up, NOT in scope).
- CoachMark (first Reader visit only, DataStore flag) per plan §6.2.
- Motion/a11y audit: walk every new component against plan §6.5 table + reduced-motion rule;
  TalkBack labels incl. highlight announce; back-gesture unwind order (sheet → selection → exit).
- Full verification: `./gradlew assembleDevDebug` clean; targeted suites for reader packages;
  **Waydroid install** of the APK (per android/AGENTS.md §5); smoke-test checklist executed via
  Waydroid inspect tooling where possible; LOG.md records results + any deviations.

## Requirements
- This is the ONLY task allowed to edit files owned by Tasks 28–31 (integration right), plus its
  own new files. Keep diffs surgical; log every cross-file edit.
- Enqueue targeted sync on every mutation path (create/recolor/reply/delete) — confirm existing
  SyncScheduler hook is invoked from repository writes or add it here.
- Exit checklist (record in LOG.md): share article→read→select→highlight→speak→save→badge;
  kill/reopen→paints at saved scroll; delete→undo→delete-keep; recolor group; tablet landscape
  side panel; offline cached read; YouTube routing unchanged; build timestamp visible on Home.

## Acceptance criteria
- Clean assembleDevDebug + all reader tests green; APK installed to Waydroid; checklist results
  logged with pass/fail per item.

## Agent notes
- Read ALL previous LOG.md files first (23–31) — they define every API you are gluing together.
- Any API mismatch you must paper over goes behind an adapter in YOUR files; note it for follow-up.
