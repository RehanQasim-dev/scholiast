# Task 02 — Web (authentic/iframe) margin column (batch 2)

Depends on 01. Do not start until batch 1 is verified in `tauri dev`.

## Owned files
- `scholiast_tauri/src/reader/AuthenticView.tsx`
- `scholiast_tauri/src/lib/darkReaderScript.ts` (injected bridge)
- `scholiast_tauri/src/reader/iframeHighlightPaint.ts` (new, injected)
- `scholiast_tauri/src/reader/MarginColumn.tsx` (overlay mode)
- `scholiast_tauri/src/routes/Reader.tsx` (retire `SplitterPane`/`ThreadPanel`)

## Steps
1. Capture a text-quote anchor at web-mode selection time and persist it on
   the stored highlight (Rust `reader.rs` + `readerIpc` shape change —
   needs the 3-Android-target `cargo check` gates).
2. Injected paint script renders stored highlights inside the same-origin
   `srcDoc` iframe (marks with `data-sc-hl`, mirroring `highlightPaint.ts`).
3. Measure anchors via `iframe.contentDocument` + iframe viewport offset;
   margin overlay column tracks iframe inner scroll (same-origin listener,
   rAF-throttled) — no nested scrollbar (PRODUCT 3).
4. `ThreadPanel`/`SplitterPane` retire from Reader; suites updated.
5. Gates: Pre-CI Local Gates (host + 3 Android `cargo check`, typecheck),
   targeted vitest, `tauri dev` smoke.

## LOG
- (append)
