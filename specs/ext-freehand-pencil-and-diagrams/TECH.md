# Technical Spec: Pencil and Excalidraw Architecture

## Context
Provides freeform annotation capabilities on top of text highlights. Integrates Excalidraw editor within an isolated frame for rich vector sketches.

Key files:
- `src/diagram.tsx` @ fed294b
- `src/utils/pencil-canvas.ts` @ fed294b
- `src/utils/video/frame-store.ts` @ fed294b

## Proposed Changes & Module Seams
- **Pencil Layer (`src/utils/pencil-canvas.ts`)**: SVG overlay listening for pointer events, smoothing points via Catmull-Rom or Bezier curves, and serializing strokes to `dr:<url>`.
- **Excalidraw Host (`src/diagram.tsx`)**: Standalone Excalidraw instance communicating via `postMessage` to pass initial scene/images and receive updated scene JSON and exported PNG.

## Testing and Validation
- **Test 1 (SVG stroke capture and curve smoothing)**: Validates Behavior Invariant 1.
- **Test 2 (Excalidraw bridge initialization with image)**: Validates Behavior Invariant 2.
- **Test 3 (Scene reload roundtrip)**: Validates Behavior Invariant 3.

## Execution Slicing (Batches)
- Batch 1: Task 01 (Pencil SVG overlay), Task 02 (Excalidraw editor bridge).
