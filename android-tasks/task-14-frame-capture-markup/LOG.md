# 14-frame-capture-markup — Agent log

Log entries appended while working on this task (see README.md, "Agent logging protocol").


## [2026-08-19 21:15] task-14 agent (session 1 — recon)
- **What I learned:**
  - Build env: `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64`, SDK `~/.bubblewrap/android_sdk`. `:app:assembleDebug` currently **RED due to Task 07's in-flight `ui/notes/editor/EditorViewModel.kt`** (unresolved `clampRange` at lines 230/272). Dependency chain for verification: `EditorViewModel.kt` ← `CommentEditorSheet.kt` ← `NotesTab.kt` (Task 06's file). `EditorField.kt` is standalone (doesn't import the broken VM). I will move the 3 dependent files aside for my verification run and restore byte-identical.
  - Task 05 contract: `PlayerViewModel` is synchronous + JVM-testable; `captureFrame()` → `CaptureState` (CAPTURING → SUCCESS(dataUrl,w,h)/FAILED(error)); error codes `black`/`tainted`/`capture-unavailable`/`canvas-unavailable`. JS already downscales ≤1280px wide, JPEG 0.8. Commands are not optimistic.
  - Task 02: `VideoItem(id, kind:"frame", videoTime, frame=FrameImage(w,h,driveId?), markup=VideoMarkup?, notes[], updatedAt)` — `markup` present only when non-empty (TS `undefined`); `dataUrl` never persisted. `ScholiastJson` (encodeDefaults=true, explicitNulls=false) gives byte-identical TS output. `JsDoubleSerializer` on all doubles.
  - Task 06: `FrameFileDeleteHook { fun deleteFrameFile(itemId) }` in `ui/notes/NotesViewModel.kt`, wired via `NotesViewModel.frameFileDeleteHook`. `FrameThumb(itemId, modifier)` placeholder in `NoteItemCard.kt` explicitly says "Task 14 owns the implementation" — so replacing that placeholder + adding an import IS the sanctioned cross-task edit (same precedent as Task 05's ScholiastApp.kt edit).
  - Task 07's `CommentEditorSheet` exists (IN PROGRESS, currently uncompilable). **Decision:** FrameDrawScreen does NOT import it (would make my verification impossible while Task 07 is red). It gets a minimal built-in comment field for the frame-comment path; LOG notes swapping in Task 07's sheet at integration.
  - Desktop refs: `video-markup.ts` — stroke weight = `max(2, W*0.004)` × {thin 0.5, medium 1, thick 2}; path = Q-curves through midpoints; `VIDEO_COLOR_HEX` = yellow `#facc15`, red `#fb7185`, green `#4ac582`, black `#000000` (NOT the text-highlight theme hues — data colors for frame markup). `video-storage.ts` — `genVideoId` = base36-ms + 5 base36 rand (Task 06's port). `frame-store.ts` — image bytes keyed by item id, never inline.
  - Icon availability (material-icons-extended 1.7.8 jar): `Highlight`, `Undo`, `Redo`, `DeleteSweep`, `Comment`, `PhotoCamera`, `Save` exist; no eraser icon → `Backspace` + label; pencil via core `Icons.Filled.Edit`.
- **Decisions made:**
  - **Eraser is vector, not raster**: plan §5.7.2 says PorterDuff.CLEAR on the overlay; task.md requires "eraser hit-testing" in MarkupMath + snapshot undo (cap 50). Raster CLEAR would need bitmap snapshots (~3.7MB × 50). Resolved: the live eraser drag paints with CLEAR on the overlay (raster feedback), but on lift it hit-tests the markup stroke list (MarkupMath.eraserHits, tol 8dp) and removes hit strokes; undo = cheap markup-list snapshots. Same visual result, testable math, cheap undo.
  - Frame palette: frame-markup colors use the desktop `VIDEO_COLOR_HEX` values (data colors, must match across devices), not the theme's text-highlight hues.
  - MarkupView renders via a view-size ARGB overlay bitmap (committed strokes repainted from the list on undo/redo/erase-commit; live stroke painted incrementally). renderComposite() bakes frame + markup at the bitmap's natural pixel size (frame.w/h = bitmap dims, so item dims always match the JPEG).
  - FrameCaptureViewModel holds `PlayerViewModel` directly (it's pure JVM) and the screen observes `player.capture` → calls `onFrameReady/onFrameFailed`. No second listener slot on the bridge (Task 05's design), so this is the wiring seam.
  - `FrameThumb(itemId, modifier, markup: VideoMarkup? = null)` — superset of the contract signature; NoteItemCard call updated to pass `item.markup`. Renders via one shared android.graphics renderer (`drawMarkupTo`, port of `renderMarkupSvg` incl. lines/texts/rects/arrows for desktop-drawn frames).
  - No navigation edit: Routes.FRAME still shows Task 05's placeholder — wiring needs the SHARED PlayerViewModel instance (route-scoped viewModel() would have no bridge), so capture entry belongs in the panel (Task 06/13 territory). Integration contract documented in the final log entry.
- **Open questions:** none blocking. Task 07's editor sheet to swap into the frame-comment path at integration. OcrHook signature: `fun interface OcrHook { suspend fun run(itemId: String, imageFile: File): String? }` + `NoopOcrHook` — Task 15 implements/persists the text.
- **Progress:** recon complete; task claimed. Writing files next.


## [2026-08-19 23:10] task-14 agent (session 2 — completion)
- **What I learned:**
  - Task 07's `EditorViewModel.kt` is FIXED since session 1 (no more `clampRange`) — `:app:assembleDebug` now fails only on MY files. The remaining red file is **Task 11's** `test/.../domain/transcribe/FutoTranscriberTest.kt` (`Cannot infer type for type parameter 'T'` :265, `Unresolved reference 'cancel'` :285 — all references are `domain/voice/local/*` + `ui/voice/WavWriter`, its own territory).
  - Kotlin backticked test names cannot contain `.` — `fun \`... 0.004 ...\`` is a compile error ("Name contains illegal characters").
  - `0xFFFACC15` is a Long literal in Kotlin — `FrameColor.argb` needed `.toInt()`.
  - Desktop undo cap semantics: `pushUndoSnapshot` `shift()`s the OLDEST past 50, so after 60 commits only 50 undos work and strokes 0..9 are un-undoable. My MarkupSession matches; the first test expectation ([s10]) was wrong, not the code.
  - `commitStroke` pushes a snapshot even for the first stroke — `canUndo` is true after one commit; "no-op erase doesn't snapshot" must be asserted via undo-stack depth, not `canUndo`.
- **Decisions made:**
  - **MarkupView coordinates are FRAME-relative, not view-relative** (corrected in this session): committed strokes are normalized against `frame{w,h}` and repainted through the letterbox transform (`translate/scale` in `repaintOverlay`), eraser hit-testing happens in frame px with `tol/scale`, and `renderComposite` bakes at natural size. A letterboxed view now produces a JPEG that matches what was drawn on screen. Session 1's LOG said view-normalized — superseded by this entry. The desktop's `renderMarkupSvg` denormalizes against W×H, so this is the compatible choice.
  - **FrameDrawScreen is the capture entry point, not `Routes.FRAME`** (per session 1): composable `FrameDrawScreen(viewModel, player, onExit)` — self-starting (`LaunchedEffect` → `startCapture` when Idle), observes `player.capture` (SUCCESS → `onFrameReady` + `clearCapture()`, FAILED → `onFrameFailed` + `clearCapture()`), exits via `onExit()` on Save/Discard/failure-toast. Wiring into the player screen is Task 05/06/13 integration; the VM instance must be the player's shared one.
  - `FrameThumb(itemId, modifier, markup: VideoMarkup?, store: FrameStore?)` — store optional, consumed from new `LocalFrameStore` CompositionLocal (null → placeholder icon), so Task 06's call site needs no store. Sanctioned cross-task edit applied: placeholder REMOVED from `NoteItemCard.kt`, import added, call passes `item.markup`.
  - Comment path in `FrameDrawScreen` uses a minimal inline `OutlinedTextField` (Task 07's sheet still red-free to import — avoided by design); swap at integration per session 1.
- **Open questions:** none. Task 15 implements `OcrHook`; Task 06/13 wire `FrameDrawScreen` into the player panel and provide `LocalFrameStore`.
- **Progress (files written this session):**
  - `ui/frame/FrameDrawScreen.kt` — full-bleed draw screen: self-starting capture, Decode-JPEG (`decodeJpeg`), `MarkupView` in `AndroidView` (aspect-fit), toolbar (pencil/highlighter/eraser `Backspace` icon, 4 colors with active ring, undo/redo/clear with enabled states), bottom bar (Discard / Comment toggle + field / Save). Failure toasts: capture errors → "This video can't be captured", save → "Couldn't save the frame".
  - `ui/frame/FrameThumb.kt` — real thumbnail: JPEG via `FrameStore.loadBitmap` + markup baked via shared `drawMarkupTo`, `LocalFrameStore` CompositionLocal.
  - `ui/frame/FrameCaptureTest.kt` — **39 tests, all passing**.
  - Fixed (my files): `FrameColor.argb` `.toInt()`; `MarkupSession.replace()` (private-setter compile error); MarkupView frame-space normalization + eraser + repaint transform; `MarkupMath.normalizeFlattened` added.
  - Cross-task (sanctioned): `NoteItemCard.kt` placeholder removed + import + `markup = item.markup`.
- **Build/test results:**
  - `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ANDROID_HOME=~/.bubblewrap/android_sdk ./gradlew :app:assembleDebug` → **BUILD SUCCESSFUL** (main sources green, incl. NoteItemCard + all 5 owned files).
  - `./gradlew :app:testDevDebugUnitTest` with Task 11's `FutoTranscriberTest.kt` moved to `/tmp/opencode/` (restored byte-identical, sha256 `e903ef62…` verified): **263 tests, 0 failures** — 39 in `FrameCaptureTest` (normalization round-trip, eraser hit-test, weights, undo cap-50, palm rejection hover sequences, FrameStore save/load/delete + delete hook, VM capture→draw→save→discard/fail states, resume-if-playing, note-only path, OCR invocation, 3 golden JSON fixtures pinned to `video-storage.ts`/`video-markup.ts` output incl. `emptyMarkup()` and `frame{w,h}`-only bytes).
  - With Task 11's test file restored, `testDevDebugUnitTest` does not compile (their file) — logged, not mine to fix.
- **API surface (for integration):**
  - `FrameCaptureViewModel(player: PlayerViewModel, repository: VideoItemRepository, store: FrameStore, ocr: OcrHook = NoopOcrHook, clock: () -> Long)` — `state: StateFlow<FrameUiState>` (Idle/Capturing/Drawing(frame)/Saving/Saved/Failed(error)); `startCapture()`, `onFrameReady(dataUrl,w,h)`, `onFrameFailed(error)`, `suspend save(markup, jpeg, w, h, comment?) : VideoItem?`, `suspend discard()`, `suspend saveNoteOnly(comment, videoTime)`, `wasPlayingBefore()`, `resumePlayback()`, `clear()`, `url`.
  - `FrameStore(dir)` — `fileFor/has/save/load/delete/loadBitmap/asDeleteHook`, `FrameStore.inFilesDir(filesDir)`.
  - `MarkupView(context, frame: Bitmap)` — `tool`, `color`, `currentMarkup()`, `setMarkup()`, `undo/redo/clearMarkup/canUndo/canRedo/hasMarkup`, `renderComposite(quality=80)`, `onMarkupChanged` callback.
  - `MarkupMath` + `MarkupSession` + `PalmRejection` + `PenProximityTracker` — pure JVM.
  - `OcrHook`/`NoopOcrHook` — Task 15 implements.
  - Frame JPEG delete hook: `FrameStore.asDeleteHook()` plugs into `NotesViewModel.frameFileDeleteHook` (Task 06).
  - Task 06 display contract: `FrameThumb(itemId, modifier, markup, store)`; Task 13's transcript path untouched (routed in the four-path table only, per task.md).
