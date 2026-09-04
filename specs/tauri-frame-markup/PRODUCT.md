# Product Spec: Tauri Frame Capture & Excalidraw Markup

## Summary
Native platform snapshot frame extraction (bypassing canvas cross-origin security) and Excalidraw vector sketch markup saved as high-DPI composite images.

## Behavior

1. **Tapping "Capture Frame" pauses video playback** and extracts the player surface into a 1280px JPEG via native platform snapshot backends.
2. **Captured frames open in an embedded Excalidraw canvas**, allowing users to draw vector annotations, arrows, callout text, and mathematical formulas.
3. **Saving a marked-up frame exports a high-DPI composite PNG and scene JSON**, saving it into the note timeline and syncing as an independent image blob.
4. **Reopening a saved frame diagram reloads the original Excalidraw vector scene** for non-destructive, cumulative editing.
