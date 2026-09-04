# Product Spec: Google Drive Cloud Sync

## Summary
Private cloud synchronization via Google Drive sandboxed `appDataFolder`, 3-way merge conflict resolution, and offline change queueing across browser extension and companion app.

## Behavior

1. **Google Drive sync writes exclusively** to the sandboxed `appDataFolder` (`pages/page-<urlhash>.json` and media blobs) without touching the user's visible Drive root.
2. **Sync operates per-page**: modifying annotations on one URL never forces re-upload of the full library.
3. **Three-way merge engine** compares local state, base snapshot, and remote records: highlight metadata uses newest-wins, comment threads merge union-style, and deleted items record persistent tombstones.
4. **Media blobs** (captured video frames and Excalidraw composite PNGs) sync as individual binary records referenced by hash.
5. **Offline changes queue locally** and flush automatically when network connectivity is restored.
6. **Automatic push & pull scheduling**: Edits automatically push ~4 seconds after editing stops (debounced); remote updates pull automatically every 5 minutes and on application start/focus.
7. **Manual two-way reconcile**: The "Sync now" action runs an immediate bidirectional reconcile (pull, 3-way merge, local write, and push).
8. **Cross-browser OAuth compatibility**: Authentication supports Chromium-based browsers via the hosted redirect bridge and Firefox/Desktop via loopback listeners.
