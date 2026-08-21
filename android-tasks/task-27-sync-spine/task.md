# Task 27 — Sync spine: the app starts owning page highlights

Status: DONE

## Objective
THE delicate change. Today `SyncEngine.assembleLocalPage` (domain/sync/SyncEngine.kt:221) SEEDS
highlights from the sync snapshot — the app owns only videoItems, so any local highlight would
vanish or tombstone wrongly. You make highlights a real locally-owned category: repository impl
over the new `highlightsJson` column + the assembleLocalPage switch — with proof that desktop
data passes through untouched and deletions tombstone correctly.

Plan: `../scholiast_web_annot_app_plan.md` §4.3–4.4. Read `android/AGENTS.md` §3 + repo-root
AGENTS.md §2 (merge semantics) first.

## Scope — files you OWN (in `../android/`)
- `app/src/main/java/com/scholiast/android/data/notes/RoomPageHighlightRepository.kt` — implements
  Task 23's `PageHighlightRepository` over `VideoPageDao` (pattern-match `RoomPageStore.kt` /
  `RoomVideoItemRepository.kt`: constructor-injected DAO, JSON columns via `ScholiastJson`).
  - reads/writes ONLY `highlightsJson` + `readerJson`; never clobbers itemsJson/snap/meta columns
    (read-modify-write the entity).
  - `upsert`: if existing highlight has newer `updatedAt`, keep it (newest-wins, merge parity);
    stamp `updatedAt = now` when the caller didn't set one.
  - `pagesWithHighlights()`: query rows where highlightsJson != '[]' OR readerJson NOT NULL,
    map to `PageListItem` (title from row else reader title; domain from url host;
    count = highlights.size; lastOpenedAt = row.updatedAt). Cold Flow via Room
    `@Query`-observable or polling re-query is fine.
- `app/src/main/java/com/scholiast/android/domain/sync/SyncEngine.kt` — EXACTLY ONE behavioral
  change: `assembleLocalPage` reads `page.highlights` (real local list) instead of
  `snap?.highlights ?: emptyList()`. Everything else (drawings/diagrams seeding, fingerprint,
  CAS, images) untouched.
- Tests:
  - `RoomPageHighlightRepositoryTest` (in-memory Room): upsert/newest-wins/delete/list.
  - Extend sync tests (`SyncEngineTest` or new `SyncHighlightsTest`):
    1) create local highlight → assemble includes it; 2) delete local → merged record tombstones
    it (base had it); 3) desktop highlight in snap with NO local change → passes through
    byte-identical; 4) desktop edit (newer updatedAt) wins over stale local edit.

## Requirements
- Existing golden test `MergePageRecordTest` MUST stay green unchanged.
- Run targeted tests only:
  `./gradlew testDevDebugUnitTest --tests "com.scholiast.android.domain.sync.*" --tests "com.scholiast.android.data.notes.RoomPageHighlightRepositoryTest"`
- Do not modify MergePageRecord, DriveApi, workers, or any UI.

## Acceptance criteria
- All four sync scenarios proven by named tests; golden suite green.
- LOG.md documents the exact diff to assembleLocalPage (downstream reviewers rely on it).

## Agent notes
- This is the highest-risk change in the feature (wrong move = tombstones user data on desktop).
  When in doubt, reconcile against how videoItems already behave — mirror that code path.
