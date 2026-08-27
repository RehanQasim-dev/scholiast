import darkReaderCode from "darkreader/darkreader.js?raw";

export function getDarkReaderScript(initialTheme: string): string {
  return `
<style id="scholiast-highlight-styles">
::highlight(sc-hl-yellow), mark.sc-hl-yellow, .color-yellow {
  background-color: rgba(210, 150, 0, 0.5) !important;
}
::highlight(sc-hl-red), mark.sc-hl-red, .color-red {
  background-color: rgba(220, 60, 90, 0.5) !important;
}
::highlight(sc-hl-green), mark.sc-hl-green, .color-green {
  background-color: rgba(45, 160, 95, 0.5) !important;
}
::highlight(sc-hl-active-yellow) {
  background-color: transparent !important;
  text-decoration: underline !important;
  text-decoration-color: #d29600 !important;
  text-decoration-thickness: 2px !important;
}
::highlight(sc-hl-active-red) {
  background-color: transparent !important;
  text-decoration: underline !important;
  text-decoration-color: #dc3c5a !important;
  text-decoration-thickness: 2px !important;
}
::highlight(sc-hl-active-green) {
  background-color: transparent !important;
  text-decoration: underline !important;
  text-decoration-color: #2da05f !important;
  text-decoration-thickness: 2px !important;
}
</style>
<script>
${darkReaderCode}
</script>
<script>
(function() {
  function applyTheme(theme) {
    if (typeof DarkReader === 'undefined') return;
    if (theme === 'light') {
      DarkReader.disable();
      return;
    }
    var bg = theme === 'oled' ? '#000000' : theme === 'sepia' ? '#1c1815' : '#0f172a';
    var text = theme === 'oled' ? '#d4d4d8' : theme === 'sepia' ? '#e6dfd5' : '#cbd5e1';
    var sepia = theme === 'sepia' ? 25 : 0;
    DarkReader.enable({
      brightness: 100,
      contrast: 100,
      sepia: sepia,
      darkSchemeBackgroundColor: bg,
      darkSchemeTextColor: text,
    });
  }

  window.addEventListener('message', function(e) {
    if (!e.data) return;
    if (e.data.type === 'SET_THEME') {
      applyTheme(e.data.theme);
    }
  });

  document.addEventListener('selectionchange', function() {
    var sel = window.getSelection();
    var text = sel ? sel.toString().trim() : '';
    if (!text) {
      window.parent.postMessage({ type: 'SELECTION_CLEARED' }, '*');
      return;
    }
    if (sel.rangeCount > 0) {
      var range = sel.getRangeAt(0);
      var rect = range.getBoundingClientRect();
      window.parent.postMessage({
        type: 'TEXT_SELECTED',
        text: text,
        rect: {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height
        }
      }, '*');
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      applyTheme('${initialTheme}');
    });
  } else {
    applyTheme('${initialTheme}');
  }
})();
</script>
`;
}
