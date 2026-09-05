import darkReaderCode from "darkreader/darkreader.js?raw";

/**
 * postMessage type the parent uses to toggle swipe-select inside the live
 * page. Exported (instead of a raw literal on each side) so the
 * parent↔iframe contract can't drift silently.
 */
export const SWIPE_SELECT_MESSAGE = "SET_SWIPE_SELECT";

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
    } else if (e.data.type === '${SWIPE_SELECT_MESSAGE}') {
      swipeSelectOn = !!e.data.enabled;
      try {
        document.documentElement.style.touchAction = swipeSelectOn ? 'pan-y' : '';
      } catch (_) {}
      if (!swipeSelectOn) {
        swipeAnchor = null;
        swipeFocus = null;
        swipeActive = false;
        swipeScrolling = false;
      }
    }
  });

  var swipeSelectOn = false;
  var swipeAnchor = null;
  var swipeFocus = null;
  var swipeStartX = 0;
  var swipeStartY = 0;
  var swipeActive = false;
  var swipeScrolling = false;
  var swipeResume = null;
  var swipeCommit = null;
  var SWIPE_SLOP = 10;
  var SWIPE_RESUME_MS = 600;
  var SWIPE_RESUME_PX = 28;
  var SWIPE_COMMIT_MS = 350;

  function swipeReportEditable() {
    try {
      var sel = window.getSelection();
      var node = sel ? sel.anchorNode : null;
      var el = node ? (node.nodeType === 1 ? node : node.parentElement) : null;
      var editable = !!(el && el.closest &&
        el.closest('input, textarea, [contenteditable="true"], [contenteditable=""]'));
      if (window.AndroidSelection && window.AndroidSelection.setSelectionEditable) {
        window.AndroidSelection.setSelectionEditable(editable);
      }
    } catch (_) {}
  }

  function swipeCaret(x, y) {
    try {
      if (document.caretPositionFromPoint) {
        var p = document.caretPositionFromPoint(x, y);
        if (p) return { node: p.offsetNode, offset: p.offset };
      } else if (document.caretRangeFromPoint) {
        var r = document.caretRangeFromPoint(x, y);
        if (r) return { node: r.startContainer, offset: r.startOffset };
      }
    } catch (_) {}
    return null;
  }

  function swipePostSelected() {
    var sel = window.getSelection();
    var text = sel ? sel.toString().trim() : '';
    if (!text || !sel || sel.rangeCount === 0) return false;
    var rect = sel.getRangeAt(0).getBoundingClientRect();
    var payload = {
      type: 'TEXT_SELECTED',
      text: text,
      rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height }
    };
    swipeCommit = { text: text, rect: payload.rect, t: Date.now() };
    window.parent.postMessage(payload, '*');
    return true;
  }

  document.addEventListener('touchstart', function(e) {
    swipeCommit = null;
    swipeActive = false;
    swipeScrolling = false;
    if (!swipeSelectOn || e.touches.length !== 1) {
      swipeAnchor = null;
      swipeFocus = null;
      return;
    }
    var t = e.touches[0];
    var r = swipeResume;
    if (r && (Date.now() - r.t) < SWIPE_RESUME_MS &&
        Math.hypot(t.clientX - r.x, t.clientY - r.y) < SWIPE_RESUME_PX &&
        r.node.isConnected && document.documentElement.contains(r.node)) {
      swipeAnchor = { node: r.node, offset: r.offset };
    } else {
      swipeResume = null;
      var pos = swipeCaret(t.clientX, t.clientY);
      swipeAnchor = (pos && document.documentElement.contains(pos.node)) ? pos : null;
    }
    swipeFocus = null;
    swipeStartX = t.clientX;
    swipeStartY = t.clientY;
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    var t = e.touches[0];
    if (!swipeSelectOn || !t || !swipeAnchor || swipeScrolling) return;
    var dx = t.clientX - swipeStartX;
    var dy = t.clientY - swipeStartY;
    if (Math.hypot(dx, dy) < SWIPE_SLOP) return;
    if (Math.abs(dx) < Math.abs(dy)) {
      swipeScrolling = true;
      swipeAnchor = null;
      swipeFocus = null;
      swipeActive = false;
      return;
    }
    var pos = swipeCaret(t.clientX, t.clientY);
    if (!pos || !document.documentElement.contains(pos.node)) return;
    var sel = window.getSelection();
    if (!sel) return;
    try {
      sel.setBaseAndExtent(swipeAnchor.node, swipeAnchor.offset, pos.node, pos.offset);
    } catch (_) {
      return;
    }
    swipeFocus = pos;
    swipeActive = true;
  }, { passive: true });

  function swipeFinish(e) {
    var anchor = swipeAnchor;
    var focus = swipeFocus;
    var wasActive = swipeActive;
    var t = (e.changedTouches && e.changedTouches[0]) || null;
    swipeAnchor = null;
    swipeFocus = null;
    swipeActive = false;
    swipeScrolling = false;
    if (!swipeSelectOn || !wasActive || !anchor || !focus) return;
    try {
      if (!anchor.node.isConnected || !focus.node.isConnected) return;
      var sel = window.getSelection();
      if (sel) sel.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
    } catch (_) {}
    swipeResume = {
      node: anchor.node, offset: anchor.offset,
      x: t ? t.clientX : swipeStartX, y: t ? t.clientY : swipeStartY,
      t: Date.now()
    };
    swipePostSelected();
  }
  document.addEventListener('touchend', swipeFinish, { passive: true });
  document.addEventListener('touchcancel', swipeFinish, { passive: true });

  document.addEventListener('selectionchange', function() {
    swipeReportEditable();
    var sel = window.getSelection();
    var text = sel ? sel.toString().trim() : '';
    if (!text) {
      if (swipeCommit && (Date.now() - swipeCommit.t) < SWIPE_COMMIT_MS) {
        window.parent.postMessage({ type: 'TEXT_SELECTED', text: swipeCommit.text, rect: swipeCommit.rect }, '*');
        return;
      }
      window.parent.postMessage({ type: 'SELECTION_CLEARED' }, '*');
      return;
    }
    if (swipeActive) return;
    swipeCommit = null;
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
