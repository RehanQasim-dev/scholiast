/*
 * Highlights state for the reader (task 29). React holds no saved state of
 * its own: the list comes from `list_highlights` via TanStack Query and is
 * invalidated after every mutation (plan §3.2 domain ownership).
 *
 * Selection → highlight creation builds a portable anchor with the task-24
 * golden `createAnchor`, one anchor per block for grouped selections
 * (extension semantics: a selection spanning blocks yields one stored
 * highlight per block sharing `groupId` — each per-block quote anchor is
 * independent, so grouping is sound; no clamping needed).
 */

import { useCallback, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createAnchor } from "../lib/anchor/anchor";
import type { HighlightColor } from "../components/SwatchPopup";
import {
  deleteHighlight,
  listHighlights,
  saveHighlight,
  updateHighlightColor,
} from "../lib/readerIpc";
import type { HighlightPayload, HighlightView } from "../lib/readerIpc";

const BLOCK_SELECTOR =
  "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figcaption, td, th, dt, dd";

let idSeq = 0;
function newId(): string {
  idSeq += 1;
  return `${Date.now().toString(36)}-${idSeq}`;
}

/**
 * Split a selection into one sub-range per leafmost block element it covers.
 * A single-block selection comes back unchanged. Falls back to the whole
 * range when every clamp collapses to whitespace.
 */
export function splitRangeByBlocks(range: Range, root: HTMLElement): Range[] {
  const doc = root.ownerDocument;
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)).filter(
    (el) => !el.querySelector(BLOCK_SELECTOR) && range.intersectsNode(el),
  );
  if (blocks.length <= 1) return [range.cloneRange()];

  const pieces: Range[] = [];
  for (const el of blocks) {
    let sub: Range | null = null;
    try {
      sub = clampRangeToElement(range, el, doc);
    } catch {
      sub = null;
    }
    if (sub && sub.toString().trim().length > 0) pieces.push(sub);
  }
  return pieces.length > 0 ? pieces : [range.cloneRange()];
}

function clampRangeToElement(
  range: Range,
  el: Element,
  doc: Document,
): Range | null {
  const sub = doc.createRange();
  // (el, 0) before the range start ⇒ the range starts inside/at this element;
  // otherwise the element begins first, so clamp to the element's own start.
  const rangeStartsInside = range.comparePoint(el, 0) < 0;
  // (el, len) after the range end ⇒ the range ends inside this element.
  const rangeEndsInside =
    range.comparePoint(el, el.childNodes.length) > 0;
  if (rangeStartsInside) sub.setStart(range.startContainer, range.startOffset);
  else sub.setStart(el, 0);
  if (rangeEndsInside) sub.setEnd(range.endContainer, range.endOffset);
  else sub.setEnd(el, el.childNodes.length);
  return sub.collapsed ? null : sub;
}

export interface UseHighlightsResult {
  highlights: HighlightView[];
  /** Attach to the article body element; paint + creation measure against it. */
  paintRootRef: { current: HTMLElement | null };
  /**
   * Persists a selection as one highlight per block. Resolves to the
   * representative id (first piece — what ThreadPanel treats as the group's
   * anchor) or null when nothing was stored.
   */
  createFromSelection: (
    range: Range,
    color: HighlightColor,
  ) => Promise<string | null>;
  recolor: (id: string, color: HighlightColor) => void;
  remove: (id: string) => void;
}

export function useHighlights(urlHash: string): UseHighlightsResult {
  const qc = useQueryClient();
  const paintRootRef = useRef<HTMLElement | null>(null);

  const queryKey = useMemo(() => ["highlights", urlHash] as const, [urlHash]);
  const { data } = useQuery({
    queryKey,
    queryFn: () => listHighlights({ urlHash }),
    enabled: urlHash !== "",
  });

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey });
  }, [qc, queryKey]);

  const createFromSelection = useCallback(
    async (range: Range, color: HighlightColor): Promise<string | null> => {
      const root = paintRootRef.current;
      if (!root || urlHash === "") return null;

      const pieces = splitRangeByBlocks(range, root);
      const groupId = pieces.length > 1 ? newId() : null;
      const payloads: HighlightPayload[] = [];
      for (const piece of pieces) {
        const anchor = createAnchor(piece, root, "web");
        if (!anchor || !anchor.quote.quote) continue;
        const payload: HighlightPayload = {
          type: "text",
          id: newId(),
          content: anchor.quote.quote,
          notes: [],
          color,
          updatedAt: Date.now(),
          anchor,
        };
        if (anchor.structural) {
          payload.xpath = anchor.structural.xpath;
          payload.startOffset = anchor.structural.startOffset;
          payload.endOffset = anchor.structural.endOffset;
        }
        if (groupId) payload.groupId = groupId;
        payloads.push(payload);
      }
      if (payloads.length === 0) return null;

      // Optimistic insert so the repaint lands immediately; the invalidate
      // that follows reconciles against Rust-owned truth either way.
      qc.setQueryData<HighlightView[]>(queryKey, (old) => [
        ...(old ?? []),
        ...payloads.map((p): HighlightView => ({ ...p, id: p.id ?? "" })),
      ]);
      try {
        for (const payload of payloads) {
          await saveHighlight({ urlHash, highlight: payload });
        }
        return payloads[0]?.id ?? null;
      } finally {
        invalidate();
      }
    },
    [invalidate, qc, queryKey, urlHash],
  );

  const recolor = useCallback(
    (id: string, color: HighlightColor) => {
      qc.setQueryData<HighlightView[]>(queryKey, (old) =>
        old?.map((h) => (h.id === id ? { ...h, color } : h)),
      );
      updateHighlightColor({ highlightId: id, color })
        .then((updated) => {
          if (!updated) invalidate();
        })
        .catch(invalidate)
        .finally(invalidate);
    },
    [invalidate, qc, queryKey],
  );

  const remove = useCallback(
    (id: string) => {
      qc.setQueryData<HighlightView[]>(queryKey, (old) =>
        old?.filter((h) => h.id !== id),
      );
      deleteHighlight({ highlightId: id })
        .catch(invalidate)
        .finally(invalidate);
    },
    [invalidate, qc, queryKey],
  );

  return {
    highlights: data ?? [],
    paintRootRef,
    createFromSelection,
    recolor,
    remove,
  };
}
