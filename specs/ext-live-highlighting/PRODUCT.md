# Product Spec: Live Web Highlighting & Selection

## Summary
In-browser live-webpage annotation allowing real-time text and element highlighting across modern web pages with zero DOM mutation using the CSS Custom Highlight API, floating color swatch selection, and undo/redo capabilities.

## Behavior

1. **Selecting text on any webpage** displays a floating circular color swatch popup anchored to the selection endpoint offering Yellow (`#d29600`), Red (`#dc3c5a`), and Green (`#2da05f`).
2. **Prior to highlight creation**, selection endpoints are automatically sanitized via `trimRange` to strip leading/trailing whitespace and prevent empty boundary highlights.
3. **Multi-block selections** spanning paragraphs, list items, or tables generate individual DOM highlight ranges bound together by a shared `groupId`.
4. **Hovering an existing highlight** summons an action bar above the selection providing recoloring, comment trigger, and delete buttons.
5. **Double-clicking an existing highlight** opens or focuses its attached comment card in the right-side margin.
6. **Element highlighting** permits users to target images, blockquotes, code blocks, or embedded containers with a distinct outline overlay.
7. **Modern rendering** utilizes the CSS Custom Highlight API (`::highlight(scholiast-*)`) where supported (Chromium 105+, Firefox 119+, Safari 17.2+), leaving the webpage DOM completely unmutated.
8. **Highlights survive dynamic webpage DOM changes** using a 3-tiered resolution ladder: exact text-quote -> whitespace-collapsed quote -> fuzzy edit-distance match.
9. **Highlights load automatically** on page load from `hl:<normalizedUrl>` and recalculate bounds upon viewport resize or layout shifts.
10. `Ctrl+Z` / `Cmd+Z` undoes the most recent highlight creation, recolor, or deletion.
