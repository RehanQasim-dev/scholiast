# IndexedDB blob store for frames and diagrams

Video frame captures (JPEGs) and Excalidraw comment diagrams (PNGs) are stored as raw binary blobs in a dedicated background-owned IndexedDB database (`clipper`, object stores `frames` and `diagrams`), keyed by item ID.

They are strictly excluded from `storage.local` and `PageRecord` JSON records to keep metadata payloads lightweight and avoid JSON base64 string bloat during state synchronization and comment rendering.

