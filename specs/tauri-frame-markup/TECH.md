# Technical Spec: Tauri Frame Capture Architecture

## Context
High-resolution video frame extraction and vector annotation layer.

Key files:
- `scholiast_tauri/src-tauri/src/commands/capture.rs` @ fed294b
- `scholiast_tauri/src/frame/` @ fed294b

## Proposed Changes & Module Seams
- **CaptureBackend Trait**: Native platform snapshot implementations (WebKitGTK Cairo surface on Linux, CoreWebView2 on Windows, WKWebView on macOS, Android View::draw).
- **Frame Store**: Disk persistence under `frames/<itemId>.jpg`.
- **Excalidraw Host**: Embedded canvas exporting composite PNG and vector scene JSON.

## Testing and Validation
- **Test 1 (Capture backend JPEG encoding)**: Validates Behavior Invariant 1.
- **Test 2 (Black-frame detection algorithm)**: Validates Behavior Invariant 1.
- **Test 3 (Excalidraw scene JSON and PNG serialization)**: Validates Behavior Invariants 3, 4.

## Execution Slicing (Batches)
- Batch 1: Task 01 (Frame capture & markup), Task 02 (OCR integration).
