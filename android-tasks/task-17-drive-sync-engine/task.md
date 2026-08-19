# Task 17 — Drive sync engine (per-page merge)

Status: DONE

## Objective
The sync engine: port the desktop's per-page 3-way merge and the Drive reconcile loop so the app reads/writes the same `pages/page-<urlhash>.json` files the desktop extension and Obsidian plugin use — byte-compatible.

## Scope — files you OWN (in `../android/app/src/main/java/com/scholiast/android/`)
- `domain/sync/merge/PageRecord.kt` — the PageRecord DTO (or reuse Task 02's — define here if Task 02 didn't)
- `domain/sync/merge/MergePageRecord.kt` — the pure 3-way merge port (newest-wins per item, tombstones, comment merge)
- `domain/sync/merge/PageFileName.kt` — uses Task 03's `pageFileName`
- `domain/sync/SyncEngine.kt` — the per-page reconcile: assemble local PageRecord from Room → push (upload frames lacking driveId → PUT page JSON with CAS) → pull (list pages, detect changes via headRevisionId/snap, merge, write back, pull missing blobs)
- `domain/sync/merge/MergePageRecordTest.kt` — **golden tests** ported from `../shared/merge.test.ts` (the Kotlin output must equal the TS output)
- `domain/sync/SyncEngineTest.kt` — reconcile tests with a fake DriveApi (Task 16's interface)

## References (read first)
- `../scholiast_mobile_app_plan.md`: §4.5 (Drive layout), §5.8.2 (sync engine port list + algorithm), §5.8.3 (golden-test target), §2 (byte-compatible, per-page never whole-dataset), §9 M5
- Desktop sources to port: `../shared/merge.ts` (mergePageRecord, pageFileName), `../src/utils/sync-engine.ts` (reconcile loop), `../src/utils/google-drive.ts` (REST + CAS), `../src/utils/page-store.ts` (local shard read/write semantics), `../shared/merge.test.ts` (golden fixtures)

## Requirements
- `mergePageRecord(base, local, remote): PageRecord` — identical algorithm to TS: per-item newest-`updatedAt` wins; comments merged by ID (timestamps embedded in note strings); deletions tracked as per-page tombstones (`tombstones.{highlights,drawings,comments,videoItems,diagrams}`) so they don't resurrect; unrenderable foreign items preserved verbatim (the plugin's `foreign` bucket concept).
- Reconcile: for a page URL — build local `PageRecord` (videoItems + diagrams pointers + tombstones) from Room + Task 14's FrameStore metadata; upload any frame JPEGs without `driveId` (create blob → store id); PUT the JSON with `If-Match: headRevisionId`; on 412 (CAS conflict) → pull remote, merge, re-PUT. Pull side: list `pages/`, compare each remote `headRevisionId` vs local `pagemeta.headRevisionId` (and local vs `snap`), download changed, merge, write back + re-upload if we made changes, pull missing frame blobs into FrameStore.
- Skip unchanged pages with zero network (the `isPageInSync` fingerprint optimization — compare entity fingerprints excluding tombstones).
- Update local bookkeeping: `snap` (last-reconciled base) and `pagemeta{fileId, headRevisionId}` in Room.
- Concurrency: one reconcile per page at a time; global queue from Task 18.

## Acceptance criteria
- **Golden tests**: port each `shared/merge.test.ts` case verbatim; Kotlin merge output byte-equals the TS output for the same input fixtures.
- Reconcile test with a fake DriveApi: push creates/updates files with correct CAS; pull merges remote changes; conflict → merged write-back; blob upload/pull paths.
- `isPageInSync` test: unchanged page → no network calls.

## Agent notes
- This is the correctness-critical task — the golden tests are the gate. Take the time to port every test case from `shared/merge.test.ts`.
- The `snap` semantics: it's the merge *base*, stored locally — mirror the TS bookkeeping names.
- Write your log to `LOG.md` as you work.