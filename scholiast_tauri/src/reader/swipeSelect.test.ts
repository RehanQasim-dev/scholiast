import { describe, expect, test } from "vitest";
import {
  beginSwipeTrack,
  classifySwipeIntent,
  SWIPE_INTENT_SLOP_PX,
  updateSwipeTrack,
} from "./swipeSelect";

describe("classifySwipeIntent", () => {
  test("sub-slop movement stays undecided", () => {
    expect(classifySwipeIntent(0, 0)).toBe("undecided");
    expect(classifySwipeIntent(SWIPE_INTENT_SLOP_PX - 1, 0)).toBe("undecided");
    expect(classifySwipeIntent(3, 4)).toBe("undecided");
  });

  test("horizontal-dominant drags select, either direction", () => {
    expect(classifySwipeIntent(60, 5)).toBe("select");
    expect(classifySwipeIntent(-80, 10)).toBe("select");
    expect(classifySwipeIntent(40, -15)).toBe("select");
  });

  test("vertical-dominant drags scroll, either direction", () => {
    expect(classifySwipeIntent(5, 80)).toBe("scroll");
    expect(classifySwipeIntent(-8, -60)).toBe("scroll");
  });

  test("exact 45° diagonal resolves to select (boundary belongs to text)", () => {
    expect(classifySwipeIntent(30, 30)).toBe("select");
    expect(classifySwipeIntent(-30, 30)).toBe("select");
  });

  test("steep-but-readable drags select (cone reaches ~63° off horizontal)", () => {
    expect(classifySwipeIntent(20, 35)).toBe("select");
    expect(classifySwipeIntent(-25, 40)).toBe("select");
    expect(classifySwipeIntent(10, 40)).toBe("scroll");
  });

  test("select locks for the gesture even when the finger steepens", () => {
    const track = beginSwipeTrack();
    expect(updateSwipeTrack(track, 60, 5)).toBe("select");
    // Sweeping down across lines must keep extending, not flip to scroll.
    expect(updateSwipeTrack(track, 65, 120)).toBe("select");
    expect(updateSwipeTrack(track, 70, 200)).toBe("select");
  });

  test("one steep wobble stays undecided; sustained steep locks scroll", () => {
    const wobble = beginSwipeTrack();
    expect(updateSwipeTrack(wobble, 4, 16)).toBe("undecided");
    expect(updateSwipeTrack(wobble, 60, 20)).toBe("select");

    const sustained = beginSwipeTrack();
    expect(updateSwipeTrack(sustained, 4, 16)).toBe("undecided");
    expect(updateSwipeTrack(sustained, 6, 20)).toBe("scroll");

    const deep = beginSwipeTrack();
    expect(updateSwipeTrack(deep, 2, 50)).toBe("scroll");
  });
});
