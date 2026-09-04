# Per-page storage sharding

To avoid O(total-dataset) serialization and cross-tab race conditions in `browser.storage.local`, annotation data is strictly sharded under per-page keys (`hl:<url>`, `dr:<url>`, `va:<url>`, `src:<url>`).

`storage.local` treats top-level keys as atomic blobs, meaning writing a single comment edit would otherwise re-serialize the entire library of annotations. `utils/page-store.ts` serves as the single access layer for sharded reads and writes.

