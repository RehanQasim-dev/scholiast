# Product Spec: Tauri Distraction-Free Reader Mode

## Summary
Distraction-free article reader mode using Mozilla Readability parsing, 4 display themes, hardware S-Pen stylus direct highlighting, and portable text-quote anchoring.

## Behavior

1. **Article URLs are fetched and parsed into clean HTML** using Mozilla Readability algorithms, stripping ads, popups, and nested tables.
2. **Reading mode offers 4 reader display themes**: OLED Pitch Black (`#000000`), Warm Sepia Paper (`#1c1815`), Soft Slate Navy (`#0f172a`), and Clean Light Paper (`#fbfbfa`).
3. **On tablets (Galaxy Tab S7+), touching the screen with an S-Pen stylus tip (`pointerType === 'pen'`)** immediately creates text highlights, while finger contact (`pointerType === 'touch'`) scrolls smoothly.
4. **Text highlights are rendered using the CSS Custom Highlight API** and anchored via portable text-quote anchors, ensuring 100% byte-compatibility with the browser extension.
5. **Scrolling down hides the top header** across all viewports to maximize vertical reading immersion; scrolling up or tapping reveals it.
6. **Reader layout table sanitizer** transforms complex multi-column infoboxes and cladograms to prevent vertical letter wrapping.
7. **Comment card colors render with muted tones** compatible across mobile WebKit and Android WebView without radioactive solid color blowouts.
8. **Reader typography controls** allow users to adjust font size steps, serif vs. sans font families, and column width (narrow, standard, wide).
9. **Highlight range selection** cleanly snaps to word and text boundaries without truncating leading or trailing characters.
