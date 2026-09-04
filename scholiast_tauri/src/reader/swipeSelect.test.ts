import { describe, expect, test } from "vitest";
import { classifySwipeIntent, SWIPE_INTENT_SLOP_PX } from "./swipeSelect";

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
});
