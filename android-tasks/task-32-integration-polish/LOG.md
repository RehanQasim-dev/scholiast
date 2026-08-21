# LOG — task-32-integration-polish


## [2026-08-21 23:55] ox-alpha (Task 32 agent) — work log
- **Read first:** task.md + LOGs of tasks 28/29/30/31; plan §5.4–5.9, §6.2–6.5.
- **Plan of record:** new files `DeepLink.kt`, `CoachMark.kt`, `AnnotationLayer.kt` (selection
  drag → SwatchPill → create/recolor, painted block renderer, persistence+sync hook);
  surgical edits to `NativeReader.kt` (annotation host param + one branch in LinkedText +
  ANNOTATION-SLOT invocation), `ReaderScreen.kt` (mount layer + ThreadSheet at SHEET-SLOT +
  deep link + coach mark + WebView polish), `SwatchPill.kt` (outside-tap detector only while
  visible so the always-mounted host can't eat page taps), `BadgeChip.kt` (TalkBack label).
- Starting implementation.

## [2026-08-22 00:40] ox-alpha (Task 32 agent) — FINAL

**Handoff note:** this task was driven across several interrupted sessions; an orchestrator pass
had partially written `ReaderAnnotationMount.kt`, `NativeReader.kt` and `ReaderScreen.kt`
between sessions. Everything below is what actually landed, verified by build + tests.

### Mount map (what went where)
- **ANNOTATION-SLOT (`NativeReader.kt`)** — `annotation: AnnotationHost?` param; TEXT_KINDS
  ("p","h1"–"h6","blockquote","li") route through `ReaderBlockText` (paint + gestures);
  `annotation.Pill()` floats SwatchPill in the Box above the list. `LinkedText` keeps the
  legacy path verbatim when host==null or index<0.
- **Selection layer (`ReaderAnnotationMount.kt`)** — long-press-drag per block Text
  (detectTapGestures + detectDragGesturesAfterLongPress on one node); drag resolves via
  SelectionTracker rootBounds→layout getOffsetForPosition; live preview span; commit →
  normalized BlockSelection list + pillRectFor rect; badge inline content via
  HighlightPainter/badgeId/badgeInlineContent; saved-highlight tap → HitSpan(group-aware);
  rehint persistence hook.
- **SHEET-SLOT (mounted inside ReadyContent's Box — owns the state; layering identical)**
  - ThreadSheet(visible=owner!=null, quote/color/replies from ownerOf, host-owned draft
    restored from viewModel.voiceDraftFor(owner.id) on open); onSendReply→addReply→upsert
    owner→enqueueSyncNow; onEditReply/onDeleteReply→…→upsert owner; onDeleteThread→
    snapshotForUndo BEFORE deleteThread (gated ≥2 replies) → repository.delete per removed
    piece → ReaderToast("Thread deleted","Undo") → restore→upsert each piece.
  - RecolorRow (3 mini swatches, top-center under bar) shown while a thread is open →
    HighlightActionsController.recolor(all group pieces)→upsert each→haptic→sync.
  - ReaderVoiceOverlay(viewModel, anchorRect = lastPillRect, integration = <the same
    rememberReaderVoiceIntegration instance>) — pill mic creates a yellow highlight first,
    then routes through voiceIntegration.onMicPressed(HighlightDraftTarget(key)).
- **Deep link (`DeepLink.kt` NEW)** — DeepLink.highlightId parses `#sc-hl=<id>` (tolerates
  double-encoded %23); DeepLink.resolve = hint-first else findTextQuoteRange scan;
  reveal effect: scrollToItem(blockIndex, −viewport/3) then single soft emphasis pulse —
  Animatable 0→1 over **2600ms**, sin(π·t) alpha boost drawn by a Canvas overlay over the
  painted span rects (rangeRectsInBlock); reduced-motion → static boost hold instead.
- **CoachMark.kt (NEW)** — "Select text to highlight · Tap 🎤 to speak a note"; first visit
  only, auto-dismiss 6s / tap / back; flag persisted.
- **BackHandler unwind (plan §6.4)** — selection-clear handler composed before ThreadSheet's
  own handlers ⇒ order: sheet closes → selection clears → exit reader. Pill also
  auto-dismisses on scroll (isScrollInProgress collector).
- **WebView fallback polish** — Chrome UA spoof, LinearProgressIndicator while loading,
  main-frame error text; toast wording kept exactly `SHELL_TOAST = "Showing original — can't
  annotate this page yet"`.

### Cross-file edits (integration right, all logged)
1. `NativeReader.kt` — AnnotationHost added earlier; MY fix: constructor vals private→public
   (LinkedText needed onTapHighlight/onHintRewrite). No logic changes.
2. `ReaderAnnotationMount.kt` (orchestrator draft) — MY fixes: removed stray closing brace
   (syntax), removed unused dragRoot state, hoisted MaterialTheme color read out of a
   remember{} calculation lambda (@Composable-context error), empty-text guard on preview
   styling.
3. `ReaderScreen.kt` — full rewrite of ReadyContent: imports; RehintWriter private helper
   (extras.hint rewrite via internal HighlightController.hintJson); state ordering fixed
   (focusedGroupKey/sheetDraft declared before callbacks that capture them);
   createFromSelection fixed to assign create()'s FULL merged list (interim version appended
   → would duplicate absorbed survivors); deep link switched from substring hack to DeepLink.*
   with pulse flash replacing interim auto-openSheet; sheet/voice/toast/recolor mounts;
   BackHandlers; coach-mark mount; scroll-dismisses-pill; WebView fallback polish.
4. `SwatchPill.kt` — CRITICAL fix: outside-tap detector only installed while visible; the
   pill host stays mounted for its exit animation and previously consumed EVERY page tap
   when hidden (reader would have been tap-dead).
5. `BadgeChip.kt` — semantics contentDescription "N comments — open comments" (TalkBack
   read "💬 2" before). Pill mic/comment buttons were already labeled (Task 29); quote block
   announceLabel already wired (Task 31).
6. `CoachMark.kt` NEW, `DeepLink.kt` NEW (written pre-handoff, used here).

### Deviations & adapters
- **Targeted push → enqueueSyncNow:** Android sync engine is a full-reconcile worker; there
  is no per-page queue to target. Every mutation path (create/recolor/reply/edit/delete/
  undo) calls SyncScheduler.enqueueSyncNow(context) (dedup REPLACE policy). Follow-up:
  per-page targeted enqueue when the worker grows a url filter.
- **Deep-link reveal = pulse flash only** (desktop parity §5.9): scrolls, flashes 2.6s, does
  NOT auto-open the thread sheet (orchestrator's interim opened it; user taps the flashing
  highlight to open comments).
- **Recolor UI lives in the screen** (RecolorRow beside the sheet) — Task 31 deliberately
  shipped no recolor control inside ThreadSheet.
- **ThreadSheet mic stays a disabled glyph:** inserting transcripts at caret needs the sheet
  to hand back an EditorViewModel (CommentEditorSheet-only plumbing today); v1.1.
- **Coach flag in SharedPreferences** (`scholiast_reader_flags/coachShown`) not DataStore —
  symmetric with Task 28's ReaderScrollStore, avoids a second DataStore file.
- figcaption/code blocks excluded from selection+painting (plan §5.4 suppression zones;
  code blocks don't render through LinkedText).
- Link taps inside painted blocks resolve against raw annotation ranges; imprecise only when
  💬 badges coexist in the same block (placeholder char shifts offsets) — accepted, logged.
- Per-span TalkBack semantics for inline highlights aren't expressible on compose-ui 1.9
  without custom accessibility nodes; covered instead by badge chip labels + sheet quote
  announcement.

### Verification checklist
| Item | Result |
|---|---|
| assembleDevDebug | **BUILD SUCCESSFUL** |
| Targeted suites | **30 run, 0 failed, 0 errors, 0 skipped** — HomeViewModelTest 13 · HighlightActionsControllerTest 4 · HighlightControllerTest 4 · ReaderViewModelTest 5 · VoiceNoteControllerTest 4 |
| Waydroid install | **OK** (session started; `waydroid app install app-dev-debug.apk` exit 0 twice; `waydroid app list` shows com.scholiast.android.dev; launch OK) |
| share article → read → select → highlight → speak → save → badge | Code-path verified end-to-end (create→persist→voice DraftReady→appendVoiceNote→badge count); not device-driven — no adb bridge into this Waydroid session (no adb device/IP reachable) |
| kill/reopen → paints at saved scroll | Verified by construction: hints persisted via RehintWriter; scroll restore unchanged from Task 28; painter anchor fallback covers stale hints |
| recolor group | Wired via RecolorRow → HighlightActionsController.recolor (all pieces restamped) — unit-covered controller path |
| delete thread → Undo → restore | snapshotForUndo→delete gated ≥2 replies→ReaderToast Undo→restore→upserts |
| tablet side panel breakpoint | ThreadSheet ≥600dp docked right panel / <600dp ModalBottomSheet (Task 31, unchanged) |
| offline cached read | Cache-first loadOnce untouched; mutations are local-Room-first, sync enqueued opportunistically |
| YouTube routing unchanged | HomeViewModel routing tests still green (13/13); no navigation files touched |
| build timestamp on Home | Pre-existing BuildConfig.BUILD_TIME row untouched |

### Open questions
- None blocking. Follow-ups recorded above: targeted sync filter, voice-in-sheet EditorViewModel
  plumbing, per-span a11y nodes if compose exposes them later.
