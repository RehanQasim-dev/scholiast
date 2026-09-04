/*
 * Anchor measurement for the margin column (specs/tauri-margin-comments,
 * task 01).
 *
 * Maps each thread entry to the content-coords top of its source line:
 * `rangeRect.top - stackRect.top`. Differencing two viewport rects cancels
 * the scroll offset, so placements stay valid while the article scrolls.
 * Re-measures when content reflows (entries, layout prefs, resize, repaints,
 * images/fonts settling).
 */

import { useEffect, useState, type RefObject } from "react";
import { findHighlightRange } from "./highlightPaint";

export interface MarginAnchorSource {
  key: string;
  /** Candidate highlight ids, first placed range wins (group support). */
  highlightIds: string[];
}

/**
 * @param stackRef  positioned ancestor the cards are absolutely placed in
 *                  (must have no border/padding of its own).
 * @param sources   one per entry, in stable order.
 * @param layoutKey re-measure when this changes (font/column/theme/article).
 */
export function useMarginAnchors(
  stackRef: RefObject<HTMLDivElement | null>,
  sources: MarginAnchorSource[],
  layoutKey: string,
): Map<string, number> {
  const [anchors, setAnchors] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    const stack = stackRef.current;
    if (!stack) {
      setAnchors(new Map());
      return;
    }

    let raf = 0;
    let disposed = false;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (disposed) return;
        const root = stackRef.current;
        if (!root) return;
        const stackRect = root.getBoundingClientRect();
        const next = new Map<string, number>();
        for (const source of sources) {
          for (const id of source.highlightIds) {
            let top: number | null = null;
            try {
              const range = findHighlightRange(id);
              if (range) {
                const rect = range.getBoundingClientRect();
                if (rect.width > 0 || rect.height > 0) {
                  top = rect.top - stackRect.top;
                }
              }
            } catch {
              top = null;
            }
            if (top !== null && Number.isFinite(top)) {
              next.set(source.key, Math.max(0, top));
              break;
            }
          }
        }
        setAnchors((prev) => {
          if (prev.size === next.size) {
            let same = true;
            for (const [k, v] of next) {
              if (prev.get(k) !== v) {
                same = false;
                break;
              }
            }
            if (same) return prev;
          }
          return next;
        });
      });
    };

    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("reader:repaint", measure);
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(measure)
        : null;
    observer?.observe(stack);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("reader:repaint", measure);
      observer?.disconnect();
    };
    // sources identity changes with entries; layoutKey covers style reflows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stackRef, layoutKey, JSON.stringify(sources.map((s) => s.key + ":" + s.highlightIds.join(",")))]);

  return anchors;
}
