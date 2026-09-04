# Google Drive appData sync merge engine

Google Drive synchronization uses a hidden, app-scoped `appDataFolder` with a 3-way merge engine (`shared/merge.ts`) operating per normalized URL.

Each page writes an image-free `pages/page-<urlhash>.json` with Compare-And-Swap (CAS) optimistic concurrency based on `headRevisionId`. Binary frames and diagrams are synchronized as separate appData blobs referenced by `driveId`. Deleted items use explicit tombstones to prevent resurrection.

