/**
 * Swipe-select intent classifier for the Reader's "Swipe" mode.
 *
 * While the mode is on, a finger drag on article text either extends the DOM
 * selection (mostly-horizontal swipe) or scrolls the page (mostly-vertical
 * swipe) — no long-press needed. The article container runs with
 * `touch-action: pan-y`, so the browser natively owns vertical pans and only
 * horizontal movement reaches the touch handlers; this classifier is the
 * second line of defense for diagonal drags.
 */

export type SwipeIntent = "undecided" | "select" | "scroll";

/** Dead zone (px) around touchstart inside which no intent is declared. */
export const SWIPE_INTENT_SLOP_PX = 10;

/**
 * Classify a drag vector (current touch minus touchstart, px).
 * Horizontal-dominant (|dx| >= |dy|, i.e. within 45° of horizontal) selects;
 * vertical-dominant scrolls; sub-slop movement stays undecided.
 */
export function classifySwipeIntent(dx: number, dy: number): SwipeIntent {
  if (Math.hypot(dx, dy) < SWIPE_INTENT_SLOP_PX) return "undecided";
  return Math.abs(dx) >= Math.abs(dy) ? "select" : "scroll";
}
