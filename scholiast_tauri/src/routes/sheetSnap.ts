/*
 * Bottom-sheet snap points (live-drag sheets guideline).
 *
 * Pure helpers so the gesture math is unit-tested: the sheet follows the
 * thumb live while dragging and settles to the nearest snap on release,
 * biased one step by fling velocity.
 */

export type SheetSnap = "closed" | "peek" | "half" | "expanded";

export const SHEET_SHARES = {
  peek: 0.2,
  half: 0.5,
  expanded: 0.7,
} as const;

/** Largest live height while dragging (share of viewport height). */
export const SHEET_DRAG_MAX_SHARE = 0.75;

/** px/ms beyond which release velocity shifts the snap one step. */
export const SHEET_FLING_PX_PER_MS = 0.4;

const ORDER: SheetSnap[] = ["closed", "peek", "half", "expanded"];
export function sheetHeights(viewportHeight: number): Record<SheetSnap, number> {  return {
    closed: 0,
    peek: viewportHeight * SHEET_SHARES.peek,
    half: viewportHeight * SHEET_SHARES.half,
    expanded: viewportHeight * SHEET_SHARES.expanded,
  };
}

/**
 * Settle a live drag height to a snap state.
 *
 * @param heightPx  sheet height at release.
 * @param viewportHeight window.innerHeight the gesture ran in.
 * @param velocityY px/ms at release; negative = moving up. Flings shift the
 *   nearest snap one step in the fling direction.
 */
export function snapSheet(
  heightPx: number,
  viewportHeight: number,
  velocityY = 0,
): SheetSnap {
  const points = sheetHeights(viewportHeight);
  if (heightPx < points.peek * 0.6) return "closed";
  let nearest: SheetSnap = "peek";
  let best = Number.POSITIVE_INFINITY;
  for (const snap of ORDER.slice(1) as SheetSnap[]) {
    const distance = Math.abs(heightPx - points[snap]);
    if (distance < best) {
      best = distance;
      nearest = snap;
    }
  }
  const index = ORDER.indexOf(nearest);
  if (velocityY < -SHEET_FLING_PX_PER_MS) {
    return ORDER[Math.min(ORDER.length - 1, index + 1)];
  }
  if (velocityY > SHEET_FLING_PX_PER_MS) {
    return ORDER[Math.max(0, index - 1)];
  }
  return nearest;
}

export interface SheetDrag {
  startY: number;
  prevY: number;
  prevT: number;
  moved: boolean;
  /** px/ms of the last segment; negative = moving up. */
  velocityY: number;
}

export function beginSheetDrag(y: number, now: number = Date.now()): SheetDrag {
  return { startY: y, prevY: y, prevT: now, moved: false, velocityY: 0 };
}

function clampSheetHeight(y: number, viewportHeight: number): number {
  return Math.min(
    viewportHeight * SHEET_DRAG_MAX_SHARE,
    Math.max(0, viewportHeight - y),
  );
}

/**
 * Advance a drag to a new thumb Y; marks moved and records segment
 * velocity. Returns the live sheet height the UI should render this frame.
 */
export function moveSheetDrag(
  track: SheetDrag,
  y: number,
  viewportHeight: number,
  now: number = Date.now(),
): number {
  track.velocityY = (y - track.prevY) / Math.max(1, now - track.prevT);
  track.prevY = y;
  track.prevT = now;
  track.moved = true;
  return clampSheetHeight(y, viewportHeight);
}

/** Height to settle from a release clientY. */
export function releaseSheetHeight(y: number, viewportHeight: number): number {
  return clampSheetHeight(y, viewportHeight);
}
