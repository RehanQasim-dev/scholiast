# 02: Drive 3-Way Merge Engine

**What to build:** Drive 3-Way Merge Engine

**Blocked by:** 01

**Status:** completed

- [x] core::merge passes golden tests for 3-way reconcile (Invariant 3)
- [x] Per-page reconcile writes to appDataFolder without touching Drive root (Invariants 1, 2)

## Scope & Implementation Notes
# Task 17: Drive Sync Engine

Status: DONE
Wave: 4
Depends on: task-16, task-02

## Scope & Owned Files
- `crates/core/src/merge.rs` — port of `shared/merge.ts::mergePageRecord`: newest-wins per item, per-page tombstones (+GC), comment merge preserving inline-timestamp IDs, `pageFileName`. **Golden tests** must reproduce TS outputs from committed fixtures (reuse `scholiast_flutter/test/fixtures/merge_page_record_*` vectors).
- `src-tauri/src/sync/engine.rs`:
  - `assemble_local_page(urlHash)` from store tables (videos/items/drawings/diagram pointers/highlights-ready)
  - push: upload missing blobs (`frames/frame-<id>.jpg`, `diagrams/diagram-<id>.png|.scene.json`) → PUT `pages/page-<hash>.json` CAS on `headRevisionId` → update `sync_meta`+`sync_snapshots`
  - pull/full reconcile: list `pages/*` as manifest; skip unchanged (revision match AND local fingerprint == snapshot fingerprint, tombstones-excluded like extension); else download → merge → write-back + re-upload if changed → pull missing blobs
  - offline-safe errors leave queue intact
- `src-tauri/src/drive/rest.rs` — Drive REST client (list/upload/update/download, appdata params)
- Commands: `sync_now()`, `is_page_in_sync(urlHash)`
- Integration tests with wiremock covering push/pull/conflict paths

## Acceptance Criteria
- Golden merge tests byte-equal to fixtures (CI-blocking)
- Engine test: two-device conflict scenario resolves per merge rules

## Notes
Image bytes never enter JSON payloads (pointers only). Emit `db://changed:*` after merged writes.


## Execution History & Log
# Task 17 — Drive Sync Engine (LOG)

## [2026-08-24 00:00] agent/task-17 session 1
- **What I learned:** task-02 models already pin every serde name incl. `PageTombstones`/`TombstoneMap` (BTreeMap); fixtures already copied to `crates/core/tests/fixtures/` (diff-clean vs flutter source); `golden_models.rs` already round-trips fixture sides value-identically. `drive::access_token()` + `auth::refresh_access` were left ready for task-17 (dead_code-allowed). Store has `SyncMetaRepo`/`SnapshotsRepo`/`SyncQueueRepo` implemented. TWO `DiagramsRepo` traits exist (`store::diagrams` upsert-row vs `store::highlights` save/get/delete) — must alias imports. `diagrams.png_path` is stored ABSOLUTE by capture::persist while `highlights.rs png_path_for` implies relative — engine treats it as "use as-is if absolute, else resolve under data_dir".
- **Decisions made:** (1) Golden comparison is serde_json `Value` equality (key-order-proof, matches task wording "Value-identical"); tombstone-map key order therefore cannot break goldens. (2) `pageFileName` ported as wrapper over task-03's `normalize::url_hash` (same SHA-256-16-byte-hex scheme) — avoids adding sha2 to core. (3) `fingerprint()` = canonical JSON string of the record with the `tombstones` key removed (serde_json default BTreeMap ⇒ sorted keys ⇒ canonical), compared by string equality. (4) After pull-apply, snapshot/pushed record = RE-ASSEMBLED-from-DB projection of the merged record (not raw merged) — DB can't hold arbitrary `extra` fields, so snapshotting raw merged would make fingerprints unstable forever after.
- **Open questions:** none blocking.
- **Progress:** recon done; status → IN PROGRESS; writing core::merge next.

## [2026-08-24 00:20] agent/task-17 session 1
- **What I learned:** fixtures keep `now` at document level (not per case). TS Map insertion order = first-seen across base→local→remote→tombston es; replicated via an order Vec + retain. Comment sort is numeric by timestamp id with unparseable→0 (V8 stable-sort NaN≈0 equivalent).
- **Decisions made:** `merge_keyed` generic takes `T: Clone` + FnMut combine (comment merge mutates shared tombstone map inside combine, like TS). Fingerprint = tombstones-stripped canonical JSON string.
- **Open questions:** none.
- **Progress:** crates/core/src/merge.rs DONE; merge_test.rs 3/3 green incl. ALL 11 golden fixture cases Value-identical. Next: drive/rest.rs.

## [2026-08-24 00:45] agent/task-17 session 1
- **What I learned:** reqwest 0.13 with the workspace's feature set (charset/multipart/rustls, no default) has NO `.query()`/`.json()` — built URLs manually + parse from `.text()`. wiremock 0.6: last-mounted matching mock wins (priority by recency); `up_to_n_times(1)` consumes the stale-401 so the retry hits the success mock. Drive v3 has no If-Match — CAS = pre-check GET headRevisionId then PATCH (conflict surfaced as DriveError::Http).
- **Decisions made:** TokenProvider = Arc<dyn Fn(force_refresh: bool) -> BoxFuture<Result<String,DriveError>>>; production adapter ignores force because drive::access_token()'s cache is module-private (revoked-but-unexpired tokens recover at natural expiry only — noted limitation). Multipart/related built by hand (reqwest's multipart is form-data, which Drive rejects).
- **Open questions:** none.
- **Progress:** drive/rest.rs DONE, 8/8 tests green. Registered via one appended line in drive/mod.rs (`pub mod rest;`). Next: store/assembly.rs.

## [2026-08-24 01:30] agent/task-17 session 1
- **What I learned:** wiremock last-mounted-wins priority bit twice (401-consumption order; a query-less meta mock shadowing an alt-media download mock → "missing field id"). CAS pre-check GET was redundant post-listing (we hold the exact revision we merged against) — dropped from pull-repush, kept on push_page. Re-push rule corrected to extension semantics: compare merged vs REMOTE record (fp-stripped), never vs local — local-vs-merged can only differ by tombstones, which fingerprints strip.
- **Decisions made:** SyncEngine is non-generic with `Box<dyn FnMut(SyncProgress) + Send + Sync>` sink (`sync://progress` payload `{phase,done,total,title,url}` camelCase). Push composes via merge(snapshot-as-base-and-remote): local deletions become tombstones and prior tombstones survive every push. Snapshot = full composed record (tombstones incl.) — fingerprint strips tombstones so comparisons stay stable. Queue drains silently after reconcile (not counted as pushes). `DriveRest::delete_file` allow(dead_code) pending task-18 wiring.
- **Open questions:** (1) tombstone-map key ORDER in JSON: Rust BTreeMap sorts lexicographically; TS object integer-like keys group first numerically — Value-equal goldens unaffected, but byte-diff purists may care for pure-numeric ids (none exist today; ids carry prefixes). (2) production token provider ignores force-refresh (drive cache is module-private) — revoked-but-unexpired tokens recover at natural expiry.
- **Progress:** ALL DELIVERABLES DONE. core::merge port + golden tests = ALL 11 fixture cases Value-identical; fingerprint stability test green; page_file_name SHA vector green. drive/rest.rs 8/8 wiremock tests. store/assembly.rs 2/2 (+ page_url_of/list_page_hashes/diagrams_for_page read-side). sync/engine.rs 5/5 (assembly round-trip fixpoint, push blob-order+id stamping, two-device conflict per merge rules w/ re-push+queue drain, unchanged-skip with zero network work, offline-safe queue intact). Commands sync_now/is_page_in_sync registered append-only in generate_handler. GATES: clippy --workspace --all-targets -D warnings CLEAN; cargo test --workspace 112 passed / 0 failed.

