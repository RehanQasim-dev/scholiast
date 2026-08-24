# Task 14: Frame Capture + Excalidraw Markup

Status: DONE (code + automated gates; MANUAL GATE PENDING — see LOG.md final entry)
Wave: 3
Depends on: task-05, task-02

## Scope & Owned Files
Rust capture pipeline:
- `src-tauri/src/capture/mod.rs` — `trait CaptureBackend { fn snapshot(&self) -> Result<RgbaImage>; }`; command `capture_frame(urlHash, rect{x,y,w,h} device px)`:
  - pause handled by caller; backend snapshot → crop rect → black-frame detect (8px grid, thresholds like extension) → downscale ≤1280w → JPEG q80 → temp return `{path,w,h}` (item persisted only on Save)
- `src-tauri/src/capture/linux_webkit.rs` — `webview.with_webview` raw handle → `gtk_widget_draw` cairo ARGB32 (SW compositing already forced by task-01 env). Feature-gated `capture-linux`.
- Stub backends returning NotImplemented for win/mac (documented spikes)

Frontend markup surface:
- `scholiast_tauri/src/frame/FrameDraw.tsx` — full-screen overlay route hosting `@excalidraw/excalidraw` seeded with captured frame as image element; dark theme props
- Save path: `exportToBlob` baked composite PNG → command `save_frame_item` persists: frame JPEG bytes moved to `frames/<itemId>.jpg`, diagram row (`diagrams` table: scene_json + png_path), `kind:'frame'` item created with notes slot → opens comment editor (task-07) attached
- Reopen edit = same diagram id (cumulative scenes); Discard leaves nothing (no orphan item)
- Chrome Capture button wired: pause → capture → route to FrameDraw → resume-on-discard / resume-after-save
- Regenerate normalized `VideoMarkup` from simple freehand elements where feasible (dashboard compat); else baked-PNG fallback per plan §6.7.2

## Acceptance Criteria
- Rust test: crop+blackframe on synthetic images (all-black → error; pattern → jpeg bytes written)
- Component smoke: Excalidraw mounts, export produces blob (mocked canvas OK)
- Manual gate logged on Linux: real YouTube pause→capture→draw→save→reopen-edit round-trip

## Notes
This is the highest-risk task — timebox backend polish, log every WebKit quirk.
