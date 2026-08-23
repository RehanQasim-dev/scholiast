/**
 * Scholiast Reader WebView bridge — window.ReaderAndroid
 *
 * Dart -> JS: paintHighlights, revealHighlight, setReaderTheme, getArticleText, commitPending
 * JS  -> Dart: onReady, onHighlightCreated, onHighlightUpdated, onHighlightDeleted,
 *              onLinkTap, onScrollPct, onSelectionState  (via flutter_inappwebview handlers)
 */

(function () {
  'use strict';

  var HIGHLIGHT_CLASS = 'scholiast-highlight';
  var PENDING_CLASS = 'scholiast-pending';
  var ACTIVE_CLASS = 'scholiast-active';

  var pendingRange = null;
  var pendingText = '';
  var lastHighlights = [];

  function callHandler(name, args) {
    try {
      if (window.flutter_inappwebview && window.flutter_inappwebview.callHandler) {
        return window.flutter_inappwebview.callHandler(name, ...args);
      }
    } catch (e) {
      console.warn('[Scholiast] handler ' + name + ' failed', e);
    }
  }

  function colorToRgba(name, alpha) {
    switch ((name || 'yellow').toLowerCase()) {
      case 'yellow': return 'rgba(254,240,138,' + alpha + ')';
      case 'green': return 'rgba(187,247,208,' + alpha + ')';
      case 'red': return 'rgba(254,202,202,' + alpha + ')';
      default: return 'rgba(254,240,138,' + alpha + ')';
    }
  }

  function colorBorder(name) {
    switch ((name || 'yellow').toLowerCase()) {
      case 'yellow': return '#eab308';
      case 'green': return '#22c55e';
      case 'red': return '#ef4444';
      default: return '#eab308';
    }
  }

  function clearHighlights() {
    document.querySelectorAll('.' + HIGHLIGHT_CLASS).forEach(function (el) {
      var parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
      parent.normalize();
    });
  }

  function highlightRange(range, id, color, isActive) {
    if (!range || range.collapsed) return;
    var span = document.createElement('span');
    span.className = HIGHLIGHT_CLASS + (isActive ? ' ' + ACTIVE_CLASS : '');
    span.dataset.highlightId = id;
    span.style.backgroundColor = colorToRgba(color, isActive ? 0.95 : 0.75);
    span.style.borderBottom = '2px solid ' + colorBorder(color);
    span.style.borderRadius = '3px';
    span.style.cursor = 'pointer';
    span.addEventListener('click', function (e) {
      e.stopPropagation();
      callHandler('onHighlightUpdated', [id, { action: 'tap' }]);
    });
    try {
      range.surroundContents(span);
    } catch (e) {
      // Range splits across elements — wrap via extract
      var frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
    }
  }

  // Resolve anchor via simple text search (mirrors Dart anchor resolution).
  function findQuoteRange(text, quote) {
    var idx = text.indexOf(quote);
    if (idx === -1) return null;
    // Walk DOM to map offset -> range
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var offset = 0;
    var startNode = null, endNode = null, startOff = 0, endOff = 0;
    var nodes = [];
    while (walker.nextNode()) {
      var n = walker.currentNode;
      if (!n.nodeValue) continue;
      // Skip our own highlights
      if (n.parentElement && n.parentElement.classList.contains(HIGHLIGHT_CLASS)) continue;
      nodes.push(n);
    }
    var full = nodes.map(function (n) { return n.nodeValue; }).join('');
    var qIdx = full.indexOf(quote);
    if (qIdx === -1) return null;
    var qEnd = qIdx + quote.length;
    var cur = 0;
    for (var i = 0; i < nodes.length; i++) {
      var len = nodes[i].nodeValue.length;
      if (startNode === null && cur + len > qIdx) {
        startNode = nodes[i];
        startOff = qIdx - cur;
      }
      if (endNode === null && cur + len >= qEnd) {
        endNode = nodes[i];
        endOff = qEnd - cur;
        break;
      }
      cur += len;
    }
    if (!startNode || !endNode) return null;
    var range = document.createRange();
    range.setStart(startNode, startOff);
    range.setEnd(endNode, endOff);
    return range;
  }

  function paintHighlights(highlights) {
    clearHighlights();
    lastHighlights = Array.isArray(highlights) ? highlights : [];
    var bodyText = document.body ? document.body.innerText : '';
    lastHighlights.forEach(function (h) {
      var quote = (h.extras && h.extras.content) || '';
      // Prefer anchor.quote if present
      if (h.extras && h.extras.anchor && h.extras.anchor.quote) quote = h.extras.anchor.quote;
      if (!quote) return;
      var range = findQuoteRange(bodyText, quote);
      if (!range) return;
      var isActive = false;
      // active check is done Dart-side via revealHighlight; paint uses non-active style
      highlightRange(range, h.id, h.color || 'yellow', isActive);
    });
  }

  function revealHighlight(id) {
    var el = document.querySelector('[data-highlight-id="' + CSS.escape(id) + '"]');
    if (!el) return;
    el.classList.add(ACTIVE_CLASS);
    el.style.backgroundColor = colorToRgba(el.dataset.color || 'yellow', 0.95);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.02)' }, { transform: 'scale(1)' }],
      { duration: 420, easing: 'ease-out' }
    );
    setTimeout(function () { el.classList.remove(ACTIVE_CLASS); }, 1600);
  }

  function setReaderTheme(fontStep, isSerif) {
    var size = Math.min(28, Math.max(12, 16 + (fontStep || 0) * 2));
    document.documentElement.style.fontSize = size + 'px';
    document.body.classList.toggle('scholiast-serif', !!isSerif);
  }

  function getArticleText() {
    return document.body ? document.body.innerText : '';
  }

  function commitPending() {
    if (!pendingRange || !pendingText) return;
    var id = 'hl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    callHandler('onHighlightCreated', [{ id: id, text: pendingText, color: 'yellow' }]);
    // Clear pending visually
    clearPending();
  }

  function clearPending() {
    document.querySelectorAll('.' + PENDING_CLASS).forEach(function (el) {
      var parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
      parent.normalize();
    });
    pendingRange = null;
    pendingText = '';
  }

  function onSelectionChange() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      callHandler('onSelectionState', [false, '']);
      return;
    }
    var text = sel.toString();
    if (text.trim().length < 2) {
      callHandler('onSelectionState', [false, '']);
      return;
    }
    pendingRange = sel.getRangeAt(0).cloneRange();
    pendingText = text;
    callHandler('onSelectionState', [true, text]);
  }

  function onScroll() {
    var doc = document.documentElement;
    var max = doc.scrollHeight - doc.clientHeight;
    var pct = max > 0 ? doc.scrollTop / max : 0;
    callHandler('onScrollPct', [pct]);
  }

  // Public bridge
  window.ReaderAndroid = {
    paintHighlights: paintHighlights,
    revealHighlight: revealHighlight,
    setReaderTheme: setReaderTheme,
    getArticleText: getArticleText,
    commitPending: commitPending,
    _clearHighlights: clearHighlights,
  };

  // Wire events
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (a) {
      e.preventDefault();
      callHandler('onLinkTap', [a.getAttribute('href') || '']);
    }
  });
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('DOMContentLoaded', function () {
    callHandler('onReady', []);
  });
  // If already loaded
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(function () { callHandler('onReady', []); }, 50);
  }
})();
