# LOG — task-27-sync-spine

## [2026-08-21 21:40] ox-alpha (Task 27 agent)
- **What I learned:**
  - `mergeKeyed` tombstones a highlight only when it is in base AND remote but missing locally
    (`r != null && b != null && l == null`). So the "local delete" proof needs the highlight on BOTH
    the snapshot and the Drive file; a delete before any push just drops silently (ported TS semantics,
    golden-pinned — not touched).
  - The merge's `combine` always rewrites `notes` via `mergeNotes` (→ `[]` when empty), so
    "byte-identical pass-through" fixtures must carry `notes: []` explicitly (encodeDefaults=true makes
    that the serialized form anyway).
  - `VideoPageEntity` has parsed accessors only for `highlights`/`reader`; `items`/`snap` exist only on
    `LoadedVideoPage`. `RoomPageStore.load` therefore parses `itemsJson`/`snapJson` itself via
    `ScholiastJson` (same conversion as `JsonTypeConverters`) — needed anyway to see the RAW
    `highlightsJson` string.
  - THE trap this task exists for: if `saveReconciled` did not persist `merged.highlights` into
    `highlightsJson`, then after pulling desktop highlights the row would still read `'[]'`, and the NEXT
    reconcile would assemble `l = []` against `b = r = [desktop highlights]` → **tombstones every desktop
    highlight**. Seeding-on-empty in `assembleLocalPage` cannot fix this (a local add would equally hide
    the desktop list); the row must stay in lockstep with the snapshot, exactly like `itemsJson`.
- **Decisions made:**
  - EXACT `assembleLocalPage` diff (the ONE behavior change):
    ```diff
     private fun assembleLocalPage(page: PageSnapshot, snap: VideoPage?): VideoPage = VideoPage(
         version = 2,
         url = page.url,
         title = page.title ?: snap?.title,
         videoId = page.videoId ?: snap?.videoId,
    -    highlights = snap?.highlights ?: emptyList(),
    +    highlights = page.highlights,
         drawings = snap?.drawings ?: emptyList(),
         videoItems = page.items,
         diagrams = snap?.diagrams ?: emptyList(),
         tombstones = PageTombstones(),
     )
    ```
    (Kdoc updated to match; drawings/diagrams seeding, fingerprint, CAS, images untouched.)
  - Minimal extensions BEYOND the two owned files, all required for correctness (spec pre-authorizes
    PageStore/PageSnapshot extension "if required"):
    1. `PageSnapshot` gained `highlights: List<PageHighlight> = emptyList()` as a DEFAULTED last param —
       all existing positional call sites (SyncEngineTest fakes) compile unchanged.
    2. `RoomPageStore.load` populates it from the row, with a one-time legacy backfill: rows written
       before Task 27 carry the pristine schema default `'[]'` while their snapshot already holds desktop
       highlights; for exactly those rows (`highlightsJson == "[]"` + non-empty snap) the snapshot seeds
       the list once. Without it, the first post-update sync of an existing install tombstones all
       desktop highlights. Known accepted edge: a post-ship delete-to-empty is indistinguishable from the
       pristine default by string alone — mitigated by (4) below; fully fixing it needs a schema flag (v3), recommended follow-up.
    3. `RoomPageStore.saveReconciled` now also writes `highlightsJson = encode(merged.highlights)`
       (mirrors `itemsJson`; see "THE trap" above). `SyncHighlightsTest.an untouched desktop highlight…`
       fails without this line.
    4. `RoomPageHighlightRepository` writes its empty lists as `"[ ]"` (parses to `[]`, byte-distinct from
       the schema default) so the legacy backfill can never resurrect a deliberate delete-to-empty.
    5. `VideoPageDao.observePagesWithHighlights()`: additive `@Query` returning
       `Flow<List<VideoPageEntity>>` (`WHERE highlightsJson != '[]' OR readerJson IS NOT NULL`) — the
       spec's preferred "Room @Query-observable" for `pagesWithHighlights()`; room-ktx already present.
       The mapper drops sentinel rows with 0 highlights and no reader.
  - Repository semantics: upsert stamps `updatedAt = now` when absent and keeps the stored highlight when
    the stored `updatedAt` is strictly newer (newest-wins, merge parity); row `updatedAt` bumped on
    highlight mutations only; reader saves create the row but never bump recency of an existing one;
    corrupt JSON parses defensively to empty/null instead of throwing into callers.
- **Open questions:** none blocking. Follow-up candidate: schema v3 flag ("highlights locally owned") to
  remove the string-heuristic backfill edge.
- **Progress:** DONE. `RoomPageHighlightRepository.kt` implemented; SyncEngine switched to real local
  highlights; tests added: `RoomPageHighlightRepositoryTest` (4: newest-wins+stamping, delete, replaceAll,
  pagesWithHighlights mapping incl. title fallback/domain/count/recency/emptied-excluded) and
  `SyncHighlightsTest` (4: local create → assembled+uploaded; local delete → tombstoned when snap had it,
  no re-seed; untouched desktop highlight byte-identical across TWO reconciles with zero tombstones;
  newer desktop edit wins over stale local edit).
  Verification: `./gradlew assembleDevDebug` BUILD SUCCESSFUL; targeted run
  `testDevDebugUnitTest --tests "com.scholiast.android.domain.sync.*" --tests "*RoomPageHighlightRepositoryTest*" --tests "*MergePageRecordTest*"`
  → 75 tests, 0 failures, 0 errors, 0 skipped. **Golden `MergePageRecordTest` green, file unchanged.**
  `SyncEngineTest` 11/11 green (fakes unaffected by the defaulted PageSnapshot param). No Waydroid
  install per task instructions.
