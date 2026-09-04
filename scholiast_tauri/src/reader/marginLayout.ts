/*
 * Margin-column stacking (specs/tauri-margin-comments, task 01).
 *
 * Pure port of the extension's no-overlap rule
 * (`src/utils/comment-overlays.ts`): cards order top-to-bottom by anchor and
 * never overlap. Unplaced anchors (`anchorTop = Infinity`) sink last.
 */

export interface MarginAnchorItem {
  key: string;
  /** Content-coords top of the source line; `Infinity` when unplaced. */
  anchorTop: number;
  height: number;
}

export interface MarginPlacement extends MarginAnchorItem {
  top: number;
}

export const MARGIN_CARD_GAP = 12;

/** Extension column constants, mirrored for the splitter clamp. */
export const MARGIN_WIDTH_DEFAULT = 340;
export const MARGIN_WIDTH_MIN = 220;
export const MARGIN_WIDTH_MAX_SHARE = 0.45;

export function clampMarginWidth(width: number, viewportWidth: number): number {
  const max = Math.max(
    MARGIN_WIDTH_MIN,
    Math.floor(viewportWidth * MARGIN_WIDTH_MAX_SHARE),
  );
  if (!Number.isFinite(width)) return MARGIN_WIDTH_DEFAULT;
  return Math.min(max, Math.max(MARGIN_WIDTH_MIN, Math.round(width)));
}

export function layoutMarginColumn(
  items: readonly MarginAnchorItem[],
  gap: number = MARGIN_CARD_GAP,
): MarginPlacement[] {
  const sorted = [...items].sort((a, b) => {
    if (a.anchorTop === b.anchorTop) return 0;
    return a.anchorTop < b.anchorTop ? -1 : 1;
  });
  let bottom = 0;
  let first = true;
  return sorted.map((item) => {
    const anchor = Number.isFinite(item.anchorTop)
      ? item.anchorTop
      : first
        ? 0
        : bottom + gap;
    const top = first ? Math.max(0, anchor) : Math.max(anchor, bottom + gap);
    first = false;
    bottom = top + Math.max(0, item.height);
    return { ...item, top };
  });
}
