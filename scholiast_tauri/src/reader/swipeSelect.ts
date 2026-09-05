/**
 * Swipe-select intent classifier for the Reader's "Swipe" mode.
 *
 * While the mode is on, a finger drag on article text either extends the DOM
 * selection (mostly-horizontal swipe) or scrolls the page (steep swipe) —
 * no long-press needed. The article container runs with
 * `touch-action: pan-y`, so the browser natively owns vertical pans and only
 * horizontal movement reaches the touch handlers; this classifier is the
 * second line of defense for diagonal drags.
 *
 * Two rules keep finger selection reliable:
 * - Wide select cone: anything within ~63° of horizontal selects
 *   (|dx| * 2 >= |dy|). Finger drags across wrapped lines run steep; the
 *   old 45° cone murdered them.
 * - Sticky intent per gesture (see SwipeTracker): the first decisive
 *   select verdict locks selection for the rest of the touch, so sweeping
 *   down across lines can't flip the gesture to scroll halfway through.
 *   Scroll only locks on a committed steep drag, so one early wobble
 *   sample can't kill a selection either.
 */

export type SwipeIntent = "undecided" | "select" | "scroll";

/** Dead zone (px) around touchstart inside which no intent is declared. */
export const SWIPE_INTENT_SLOP_PX = 10;

/** Steep vertical px that commits a gesture to scroll on a single sample. */
export const SWIPE_SCROLL_COMMIT_PX = 24;

/**
 * Classify a drag vector (current touch minus touchstart, px).
 * Within ~63° of horizontal selects; steeper scrolls; sub-slop movement
 * stays undecided.
 */
export function classifySwipeIntent(dx: number, dy: number): SwipeIntent {
  if (Math.hypot(dx, dy) < SWIPE_INTENT_SLOP_PX) return "undecided";
  return Math.abs(dx) * 2 >= Math.abs(dy) ? "select" : "scroll";
}

export interface SwipeTracker {
  intent: SwipeIntent;
  steepVotes: number;
}

/** Fresh per-gesture tracker; the first decisive verdict locks. */
export function beginSwipeTrack(): SwipeTracker {
  return { intent: "undecided", steepVotes: 0 };
}

/**
 * Advance a gesture tracker with the TOTAL displacement from touchstart.
 * Select locks on first verdict and stays locked; scroll needs a committed
 * steep drag (deep single sample or two consecutive steep ones).
 */
export function updateSwipeTrack(
  tracker: SwipeTracker,
  dx: number,
  dy: number,
): SwipeIntent {
  if (tracker.intent !== "undecided") return tracker.intent;
  if (Math.hypot(dx, dy) < SWIPE_INTENT_SLOP_PX) return "undecided";
  if (Math.abs(dx) * 2 >= Math.abs(dy)) {
    tracker.intent = "select";
    return "select";
  }
  tracker.steepVotes += 1;
  if (Math.abs(dy) >= SWIPE_SCROLL_COMMIT_PX || tracker.steepVotes >= 2) {
    tracker.intent = "scroll";
    return "scroll";
  }
  return "undecided";
}
