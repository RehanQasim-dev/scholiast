import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import SwatchPopup from "../components/SwatchPopup";
import type { HighlightColor } from "../components/SwatchPopup";
import {
  dispose,
  findHighlightRange,
  paintedHighlightIds,
  schedulePaint,
} from "./highlightPaint";
import type { HighlightForPaint, PaintStats } from "./highlightPaint";
import { useHighlights } from "./useHighlights";
import { saveComment } from "../lib/readerIpc";
import "./reader-typography.css";
import "./highlight-overlays.css";

const CAPTURE_PENDING_COPY =
  "Capture pending — extraction lands in the next wave";
const NOT_READABLE_COPY = "This page couldn't be extracted as readable text.";
const IMAGE_FALLBACK_LABEL = "Image unavailable";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export interface ArticleViewProps {
  title: string | null;
  byline?: string | null;
  /** Sanitized article HTML from `get_page`. Trust boundary: sanitization is
   * Rust-side (task-25 allowlist pipeline); this component renders it as-is
   * and must never grow a second sanitizer. */
  body: string | null;
  notReadable?: boolean;
  fontStep?: number;
  serif?: boolean;
  columnWidth?: number;
  footerAction?: ReactNode;
  /** Library key of this page; enables selection → highlight annotation. */
  urlHash?: string;
  /** Click on a painted highlight (task-31 thread surface wires this). */
  onHighlightClick?: (highlightId: string) => void;
  /** 💬 on a fresh selection: highlight created, panel should open it. */
  onHighlightCreated?: (highlightId: string) => void;
  /** Opens diagram editor for a highlight. */
  onOpenDiagram?: (highlightId: string) => void;
}

/**
 * Renders one captured article as a measured single reading column.
 *
 * The body is injected raw because it is already sanitized upstream. As pure
 * defense-in-depth against a sanitizer regression (not a re-sanitization of
 * legitimate content), a post-mount sweep drops any `script` node / inline
 * event handler / `javascript:` URL that slipped through and warns in dev —
 * the invariant is "no script node in the output DOM".
 */
export default function ArticleView({
  title,
  byline,
  body,
  notReadable = false,
  fontStep = 0,
  serif = false,
  columnWidth = 736,
  footerAction,
  urlHash,
  onHighlightClick,
  onHighlightCreated,
  onOpenDiagram,
}: ArticleViewProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!body) return;
    if (import.meta.env.DEV && /<script/i.test(body)) {
      console.warn(
        "ArticleView: stored body contains <script — sanitizer may have regressed.",
      );
    }
    const root = bodyRef.current;
    if (!root) return;

    root.querySelectorAll("script").forEach((node) => node.remove());
    root.querySelectorAll<HTMLElement>("*").forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
        else if (
          (attr.name === "href" || attr.name === "src") &&
          /^\s*javascript:/i.test(attr.value)
        ) {
          el.removeAttribute(attr.name);
        }
      }
    });

    const cleanups: (() => void)[] = [];
    const swapToChip = (img: HTMLImageElement) => {
      if (!img.isConnected) return;
      const alt = (img.alt || IMAGE_FALLBACK_LABEL).trim().slice(0, 80);
      const wrap = document.createElement("div");
      wrap.className = "sc-article-imgchip";
      wrap.setAttribute("data-testid", "broken-image-chip");
      wrap.setAttribute("role", "img");
      wrap.setAttribute("aria-label", alt);
      wrap.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="sc-article-imgchip-icon"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m9 9 6 6"/><path d="M15 9 9 15"/></svg>' +
        `<span class="sc-article-imgchip-text">${escapeHtml(alt)}</span>`;
      if (img.parentElement?.tagName === "FIGURE") {
        const fig = img.parentElement as HTMLElement;
        if (fig.querySelectorAll("img").length === 1) {
          img.replaceWith(wrap);
          return;
        }
      }
      img.replaceWith(wrap);
    };
    root.querySelectorAll("img").forEach((img) => {
      if (!img.getAttribute("loading")) img.setAttribute("loading", "lazy");
      img.setAttribute("decoding", "async");
      img.setAttribute("referrerpolicy", "no-referrer");
      const onError = () => swapToChip(img);
      img.addEventListener("error", onError);
      cleanups.push(() => img.removeEventListener("error", onError));
    });
    return () => cleanups.forEach((fn) => fn());
  }, [body]);

  const columnStyle = {
    "--reader-font-step": String(fontStep),
    "--sc-article-width": `${columnWidth}px`,
  } as CSSProperties;

  if (!body) {
    return (
      <section className="sc-article" style={columnStyle}>
        {title ? (
          <header className="sc-article-header">
            <h1 className="sc-article-title">{title}</h1>
          </header>
        ) : null}
        <div className="sc-article-state">
          <p>{notReadable ? NOT_READABLE_COPY : CAPTURE_PENDING_COPY}</p>
          {footerAction}
        </div>
      </section>
    );
  }

  return (
    <article
      className={`sc-article${serif ? " sc-article--serif" : ""}`}
      style={columnStyle}
    >
      <header className="sc-article-header">
        <h1 className="sc-article-title">{title}</h1>
        {byline ? <p className="sc-article-byline">{byline}</p> : null}
      </header>
      <div
        ref={bodyRef}
        className="sc-article-body"
        dangerouslySetInnerHTML={{ __html: body }}
      />
      {urlHash ? (
        <HighlightsLayer
          urlHash={urlHash}
          body={body}
          containerRef={bodyRef}
          onHighlightClick={onHighlightClick}
          onHighlightCreated={onHighlightCreated}
          onOpenDiagram={onOpenDiagram}
        />
      ) : null}
    </article>
  );
}

interface HighlightsLayerProps {
  urlHash: string;
  /** Body HTML; a swap means fresh DOM, so paints re-run against it. */
  body: string;
  containerRef: RefObject<HTMLDivElement>;
  onHighlightClick?: (highlightId: string) => void;
  onHighlightCreated?: (highlightId: string) => void;
  onOpenDiagram?: (highlightId: string) => void;
}

/**
 * Everything annotation-shaped for one rendered article: repaint lifecycle,
 * selection → SwatchPopup → persisted highlight, painted-range click
 * hit-testing and the unplaced-count notice. Mounted only when `urlHash` is
 * provided so plain rendering needs no query client.
 */
function HighlightsLayer({
  urlHash,
  body,
  containerRef,
  onHighlightClick,
  onHighlightCreated,
  onOpenDiagram,
}: HighlightsLayerProps) {
  const { highlights, paintRootRef, createFromSelection } = useHighlights(urlHash);
  const [popupAnchor, setPopupAnchor] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [unplacedCount, setUnplacedCount] = useState(0);
  const [chipDismissed, setChipDismissed] = useState(false);
  const pendingRange = useRef<Range | null>(null);
  const showTimer = useRef<number | undefined>(undefined);

  const highlightsRef = useRef(highlights);
  highlightsRef.current = highlights;

  useEffect(() => {
    paintRootRef.current = containerRef.current;
  }, [containerRef, paintRootRef, body]);

  const getRoot = useCallback(
    (): HTMLElement | null => {
      paintRootRef.current = containerRef.current;
      return paintRootRef.current;
    },
    [containerRef, paintRootRef],
  );
  const getHighlights = useCallback(
    (): readonly HighlightForPaint[] => highlightsRef.current,
    [],
  );
  const handleStats = useCallback((stats: PaintStats) => {
    setUnplacedCount(stats.unplaced.length);
  }, []);

  // Repaint whenever the query settles (or an optimistic mutation lands),
  // coalesced into one animation frame.
  useEffect(
    () => schedulePaint(getRoot, getHighlights, handleStats),
    [body, highlights, getRoot, getHighlights, handleStats],
  );

  // Lifecycle repaints: window resizes and external "reader:repaint" requests
  // (e.g. a sync pull landing mid-session). dispose() drops module state.
  useEffect(() => {
    const repaint = () => {
      schedulePaint(getRoot, getHighlights, handleStats);
    };
    window.addEventListener("resize", repaint);
    window.addEventListener("reader:repaint", repaint);
    return () => {
      window.removeEventListener("resize", repaint);
      window.removeEventListener("reader:repaint", repaint);
      dispose();
    };
  }, [getRoot, getHighlights, handleStats]);

  useEffect(() => {
    if (unplacedCount === 0) setChipDismissed(false);
  }, [unplacedCount]);

  const selectionInRange = useCallback((): Range | null => {
    const root = containerRef.current;
    if (!root) return null;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return null;
    return range;
  }, [containerRef]);

  const showPopupForSelection = useCallback(() => {
    const range = selectionInRange();
    if (!range) return;
    pendingRange.current = range.cloneRange();
    const rect =
      typeof range.getBoundingClientRect === "function"
        ? range.getBoundingClientRect()
        : null;
    setPopupAnchor(
      rect
        ? { top: rect.top, left: rect.left + rect.width / 2 }
        : { top: 0, left: window.innerWidth / 2 },
    );
  }, [selectionInRange]);

  // Selection flow: collapse hides the popup; while a selection is moving the
  // popup stays hidden and re-opens once the selection has settled briefly
  // (keyboard selections included); mouseup opens it immediately.
  useEffect(() => {
    const clearShowTimer = () => window.clearTimeout(showTimer.current);
    let lastPointerType = "mouse";
    let touchMoved = false;

    const onPointerDown = (e: PointerEvent) => {
      lastPointerType = e.pointerType;
      touchMoved = false;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") {
        touchMoved = true;
      }
    };

    const onSelectionChange = () => {
      clearShowTimer();
      if (window.getSelection()?.isCollapsed !== false) {
        pendingRange.current = null;
        setPopupAnchor(null);
        return;
      }
      setPopupAnchor(null);
      // S-Pen / Stylus: instant precision selection (50ms)
      // Mouse/Touch: standard settled delay (300ms)
      const delay = lastPointerType === "pen" ? 50 : 300;
      showTimer.current = window.setTimeout(showPopupForSelection, delay);
    };

    const onMouseUp = () => {
      clearShowTimer();
      // If finger was scrolling the page, avoid popping up swatch accidentally
      if (lastPointerType === "touch" && touchMoved) {
        return;
      }
      if (selectionInRange()) showPopupForSelection();
    };

    const dismiss = () => setPopupAnchor(null);

    document.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("touchend", onMouseUp);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);

    return () => {
      clearShowTimer();
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("touchend", onMouseUp);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [selectionInRange, showPopupForSelection]);

  const handlePickColor = useCallback(
    (color: HighlightColor) => {
      setPopupAnchor(null);
      const range = pendingRange.current;
      pendingRange.current = null;
      if (!range) return;
      void createFromSelection(range, color).then((created) => {
        if (created) window.getSelection()?.removeAllRanges();
      });
    },
    [createFromSelection],
  );

  const handleClosePopup = useCallback(() => {
    pendingRange.current = null;
    setPopupAnchor(null);
  }, []);

  const handleSaveComment = useCallback(
    (color: HighlightColor, commentText: string) => {
      setPopupAnchor(null);
      const range = pendingRange.current;
      pendingRange.current = null;
      if (!range) return;
      void createFromSelection(range, color).then(async (id) => {
        if (!id) return;
        window.getSelection()?.removeAllRanges();
        if (commentText.trim()) {
          const note = `${commentText.trim()}<!--timestamp:${Date.now()}-->`;
          try {
            await saveComment({ highlightId: id, note });
          } catch {
            /* ignore */
          }
        }
        onHighlightCreated?.(id);
      });
    },
    [createFromSelection, onHighlightCreated],
  );

  // 💬 on a selection: create the highlight (yellow default) and hand the
  // representative id up so Reader opens its thread with the reply focused.
  const handleComment = useCallback(() => {
    setPopupAnchor(null);
    const range = pendingRange.current;
    pendingRange.current = null;
    if (!range) return;
    void createFromSelection(range, "yellow").then((id) => {
      if (!id) return;
      window.getSelection()?.removeAllRanges();
      onHighlightCreated?.(id);
    });
  }, [createFromSelection, onHighlightCreated]);

  const handleOpenDiagram = useCallback(
    (color: HighlightColor) => {
      setPopupAnchor(null);
      const range = pendingRange.current;
      pendingRange.current = null;
      if (!range) return;
      void createFromSelection(range, color).then((id) => {
        if (!id) return;
        window.getSelection()?.removeAllRanges();
        onOpenDiagram?.(id);
      });
    },
    [createFromSelection, onOpenDiagram],
  );

  // Click on a painted range → onHighlightClick. Fallback marks answer
  // directly; native registries are hit-tested through static ranges using
  // the caret position under the pointer.
  useEffect(() => {
    if (!onHighlightClick) return;
    const onClick = (e: MouseEvent) => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      const target = e.target as HTMLElement | null;
      const root = containerRef.current;
      if (!target || !root || !root.contains(target)) return;

      const markId = target.closest("mark[data-sc-hl]")?.getAttribute("data-sc-hl");
      if (markId) {
        onHighlightClick(markId);
        return;
      }
      const pos = caretPointAt(e.clientX, e.clientY);
      if (!pos) return;
      for (const id of paintedHighlightIds()) {
        const range = findHighlightRange(id);
        if (!range) continue;
        try {
          if (range.isPointInRange(pos.node, pos.offset)) {
            onHighlightClick(id);
            return;
          }
        } catch {
          /* stale position — skip */
        }
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [containerRef, onHighlightClick]);

  const chip =
    unplacedCount > 0 && !chipDismissed ? (
      <div
        className="sc-unplaced-chip"
        data-testid="unplaced-chip"
        role="status"
        aria-label={`${unplacedCount} saved ${unplacedCount === 1 ? "highlight" : "highlights"} could not be placed on this page`}
      >
        <span aria-hidden="true">{unplacedCount} unplaced</span>
        <button
          type="button"
          aria-label="Dismiss unplaced-highlights notice"
          onClick={() => setChipDismissed(true)}
        >
          ×
        </button>
      </div>
    ) : null;

  return (
    <>
      {chip}
      {popupAnchor ? (
        <SwatchPopup
          anchor={popupAnchor}
          onPickColor={handlePickColor}
          onSaveComment={handleSaveComment}
          onOpenDiagram={handleOpenDiagram}
          onComment={handleComment}
          onClose={handleClosePopup}
        />
      ) : null}
    </>
  );
}

interface CaretPosition {
  node: Node;
  offset: number;
}

function caretPointAt(x: number, y: number): CaretPosition | null {
  const fromPosition = document.caretPositionFromPoint?.(x, y);
  if (fromPosition) return { node: fromPosition.offsetNode, offset: fromPosition.offset };
  const fromRange = document.caretRangeFromPoint?.(x, y);
  if (fromRange) return { node: fromRange.startContainer, offset: fromRange.startOffset };
  return null;
}
