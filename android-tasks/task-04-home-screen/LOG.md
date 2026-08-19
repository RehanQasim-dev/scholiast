# 04-home-screen — Agent log

Log entries appended while working on this task (see README.md, "Agent logging protocol").

## [2026-08-19 19:10] task-04 agent
- **What I learned:**
  - Task 02's `VideoItemRepository.listRecentPages(limit)` returns raw `VideoPageEntity` rows (not `LoadedVideoPage`), so note-count requires decoding `itemsJson` (`ScholiastJson.decode<List<VideoItem>>`) in the consumer — repository has no parsed-entity list API.
  - `VideoPageEntity.updatedAt` = last item mutation (per Task 02 doc, opening alone does NOT move it) — there is NO dedicated `lastOpenedAt` column. Home's "last-opened" display uses `updatedAt` as the only available proxy (DAO has an unused `touch()` if Task 05+ wants real last-opened).
  - `Normalize.extractVideoId` (Task 03) is strict single-URL (URI parse) — it rejects share text with surrounding words, so share parsing needs its own tolerant URL-token scan.
  - `viewModel()` inside a NavHost back-stack entry is scoped to the NavBackStackEntry, NOT the activity — so for MainActivity (Task 01 file, cannot edit) to call a HomeViewModel entry point, the VM must be activity-scoped (see Decisions).
  - Plain-JVM unit tests cannot construct-touch `viewModelScope` (Main dispatcher missing) → data load is `suspend fun reload()` (public, testable) + `fun refresh()` (viewModelScope, runtime only).
  - Coil 3.2.0 (coil3) in the catalog — `coil3.compose.AsyncImage` available; material-icons-extended present (`ContentPaste`, `OndemandVideo`, `Settings`).
  - `strings.xml` is Task 01-owned → reuse existing `home_title`/`home_empty_hint`, hardcode the new literals (placeholder, "Not a YouTube link", chip labels) in code; flagged below.
- **Decisions made:**
  - **HomeViewModel is ACTIVITY-scoped**: HomeScreen creates it via `viewModel(viewModelStoreOwner = LocalContext.current as ComponentActivity, factory = HomeViewModel.factory(application))`, so MainActivity's `by viewModels { HomeViewModel.factory(application) }` resolves the SAME instance. Integration note (exact wiring snippet) in the final log entry.
  - **Navigation via `pendingOpen: StateFlow<String?>`**, not a SharedFlow event: a share intent can fire before Home's composition subscribes (cold start), and SharedFlow(replay=0) drops it. The screen collects `pendingOpen`, consumes it, and calls `onOpenVideo`. `events` SharedFlow carries only toasts (replay 0 — a cold-start toast may be dropped, acceptable).
  - Sync status: `SyncStatusHolder` interface + `InMemorySyncStatusHolder` stub (Task 18's `SyncStatusRepository` can be adapted in later by passing a holder). States: Disconnected / Syncing / Synced(lastSyncedAt) / Error(message).
  - Grid = `GridCells.Adaptive(minSize = 340.dp)`: exactly 2 columns at typical Tab portrait widths (plan §6.3), expands on very wide/landscape screens (task spec says "2 columns, adaptive").
  - Paste icon pastes clipboard text AND submits (1-tap open); invalid clipboard → toast, text stays in field.
  - Note count = number of `VideoItem`s in the page (frames+notes+transcript); title fallback "Untitled video" when null/blank.
  - Card "last-opened" label shows `updatedAt` (proxy — see What I learned).
- **Open questions:**
  - Cold-start share with invalid text: toast may be lost (no subscriber yet). Could add a pendingToast later; minor.
  - Manifest has no `windowSoftInputMode` (Task 01's file) — default resize behavior on tablets is untested; keyboard on the Open-link field is default (typing surface, no gating per task spec).
- **Progress:** task claimed; recon complete (deps 02/03/01 read, conventions noted). Implementing next.

## [2026-08-19 20:52] task-04 agent — RESUME (verification session)
- **What I learned:**
  - The three owned files were complete and spec-compliant; no production-code changes were needed.
  - My test file had TWO real bugs, both found by the first test run:
    1. **Fake repo violated the repository contract** — `listRecentPages` returned input order, but the real DAO does `ORDER BY updatedAt DESC` (`VideoPageDao.kt:27`). Fixed the fake to `sortedByDescending { it.updatedAt }`. This was a test-harness bug, not a production bug.
    2. **StateFlow collector timing in tests** — collectors launched with `CoroutineStart.UNDISPATCHED` resume only at suspension points, so synchronous asserts after `submitOpenLink()`/`parseShareText()` ran before the emission was delivered (failure signature: `expected:[…] but was:[]`). Fixed by adding `yield()` after each triggering call. The one test that passed (`cold-start share…`) did so because the value pre-existed subscription — StateFlow replays the latest value, which is exactly the cold-start behavior the design relies on.
  - **Task 06 is actively mid-refactor** (its agent is editing `ui/notes/` right now): `render/CommentRenderer.kt` was deleted from the main tree while `NoteItemCard.kt` still references its `CommentBody` → the main tree does NOT compile at present (`NoteItemCard.kt:311 Unresolved reference 'CommentBody'`). This is Task 06's file to fix, not mine; logged per the README "move aside and verify" rule.
- **Decisions made:**
  - **Verification method:** moved the entire `ui/notes/` main-source + test set out of the source tree to `/tmp/opencode/task04-notes-aside/`, ran the build + my tests against the rest of the tree, then restored byte-identical (md5-verified all 5 files match the pre-move snapshot). No other task file was modified.
- **Build & test results:**
  - `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ./gradlew :app:assembleDebug` — **BUILD SUCCESSFUL** (with notes set aside; before/after restoring, the tree fails only on Task 06's `ui/notes` refactor).
  - `./gradlew :app:testDevDebugUnitTest --tests com.scholiast.android.ui.home.HomeViewModelTest` — **13 tests, 0 failures, 0 errors** (report: `app/build/test-results/testDevDebugUnitTest/TEST-…HomeViewModelTest.xml`).
  - Full-suite run: 142 tests, 13 failed — 8 were my (now-fixed) timing/fake-repo test bugs; 5 are Task 06's `NotesViewModelTest` (undo/reply/sort assertions against its own in-flight code) — unrelated to Home.
- **Share-intent wiring note for MainActivity (Task 01's file — NOT edited, per task scope):**
  The handler lives in `HomeViewModel.parseShareText(String?)` and the VM is **activity-scoped** (`HomeViewModel.factory(application)`). Task 01's MainActivity only needs to (a) resolve the same instance and (b) forward the SEND intent. Exact snippet:
  ```kotlin
  private val homeViewModel: HomeViewModel by viewModels { HomeViewModel.factory(application) }
  // in onCreate (cold start) and onNewIntent (warm):
  if (intent.action == Intent.ACTION_SEND && intent.type == "text/plain") {
      homeViewModel.parseShareText(intent.getStringExtra(Intent.EXTRA_TEXT))
  }
  ```
  The manifest SEND/text/plain filter already exists (`AndroidManifest.xml:25-29`, Task 01). Cold-start share is covered: `pendingOpen`/`pendingToast` are StateFlows, so the screen picks them up on first collect even if the intent fired before composition.
- **Open questions:**
  - None new. (Earlier open question about cold-start toast delivery is resolved by the StateFlow design; the toast may still be dropped only if the user navigates away before Home ever composes.)
- **Progress:** Task complete. All acceptance criteria covered by code + passing unit tests (paste→player, share→player/toast, recent grid newest-first with note counts, empty state, keyboard-on-focus for Open-link field). `task.md` set to DONE.

