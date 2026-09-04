# Product Spec: Freehand Pencil & Excalidraw Diagrams

## Summary
Freehand SVG vector drawing directly over web pages with smooth stroke capture, alongside Excalidraw diagram editing integrated into element highlights and comment notes.

## Behavior

1. **Freehand pencil mode** captures pointer strokes into smooth SVG paths rendered in an overlay layer and persisted to `dr:<normalizedUrl>`.
2. **Element highlights on images** provide an "Edit / Redraw" action that opens an Excalidraw canvas initialized with the selected image.
3. **Excalidraw scenes are saved to storage** and can be reopened cumulatively for continuous diagram editing.
